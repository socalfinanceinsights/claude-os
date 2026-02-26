/**
 * 07_Enrichment_Chain.gs
 * @execution scheduled, pipeline
 *
 * Purpose: Orchestrates Gemini enrichment pipeline + ICP score refresh after imports
 * Runs headless (no UI dialogs) so it works from time-based triggers
 *
 * CHAIN ORDER:
 *   Import finishes → 1 min delay → Chain_Gemini_Enrichments()
 *     → Step 1: Industry (up to 50 per batch)
 *     → Step 2: Ownership (up to 50 per batch)
 *     → Step 3: Size/Revenue (up to 20 per batch)
 *     → Step 4: Region Tier 3 (up to 20 per batch)
 *     → Step 5: Company/Domain (up to 50 per batch) — NEW v2.0
 *     → Step 6: Title (up to 50 per batch) — NEW v2.0
 *     → Step 7: Company Description (up to 20 per batch) — NEW v2.0
 *     → If any enrichment had remaining rows → re-trigger self (2 min delay)
 *     → Circuit breaker: max 10 re-triggers per chain invocation
 *     → If all done → 5 min delay → Refresh_All_ICP()
 *
 * TRIGGER FUNCTIONS (add to end of import scripts):
 *   scheduleEnrichmentChain_()    — 1 min delay to start enrichments
 *   scheduleICPRefresh_()         — 5 min delay for ICP score refresh (called automatically)
 *
 * Version: 2.1.0 (Split: headless functions moved to 07a)
 * Last Updated: 2026-02-17
 * SEE ALSO: 07a_Enrichment_Headless.gs (headless enrichment functions + logging helpers)
 */

// ============================================================================
// TRIGGER SCHEDULERS (call from import scripts)
// ============================================================================

/**
 * Schedule the enrichment chain to run after a delay
 * Call this at the end of Crunchbase/Lusha Company imports
 *
 * @param {number} delayMinutes - Minutes to wait (default 1)
 */
function scheduleEnrichmentChain_(delayMinutes) {
  const delay = (delayMinutes || 1) * 60 * 1000;

  // Clean up any existing chain triggers first
  cleanupTriggers_('Chain_Gemini_Enrichments');

  ScriptApp.newTrigger('Chain_Gemini_Enrichments')
    .timeBased()
    .after(delay)
    .create();

  Logger.log(`Enrichment chain scheduled (${delayMinutes || 1} min delay)`);
}

/**
 * Schedule ICP refresh to run after enrichments complete
 * Called automatically by the chain when all enrichments are done
 *
 * @param {number} delayMinutes - Minutes to wait (default 5)
 */
function scheduleICPRefresh_(delayMinutes) {
  const delay = (delayMinutes || 5) * 60 * 1000;

  // Clean up any existing refresh triggers first
  cleanupTriggers_('Refresh_All_ICP');

  ScriptApp.newTrigger('Refresh_All_ICP')
    .timeBased()
    .after(delay)
    .create();

  Logger.log(`ICP refresh scheduled (${delayMinutes || 5} min delay)`);
}

// ============================================================================
// TRIGGER CLEANUP
// ============================================================================

/**
 * Remove all triggers for a specific function name
 * Prevents orphaned triggers from piling up
 *
 * @param {string} functionName - Function name to clean up
 */
function cleanupTriggers_(functionName) {
  const triggers = ScriptApp.getProjectTriggers();
  let cleaned = 0;
  for (const t of triggers) {
    if (t.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(t);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    Logger.log(`  Cleaned up ${cleaned} existing trigger(s) for ${functionName}`);
  }
}

// ============================================================================
// MASTER CHAIN ORCHESTRATOR
// ============================================================================

/**
 * Main enrichment chain - runs all 7 Gemini enrichments in sequence
 * Called by time-based trigger (headless - no UI)
 * Self-re-triggers if any enrichment has remaining rows
 * Circuit breaker: stops after 10 re-triggers to prevent runaway
 */
function Chain_Gemini_Enrichments() {
  const startTime = new Date();
  Logger.log('ENRICHMENT CHAIN STARTED (v2.0)');
  Logger.log(`Time: ${startTime.toISOString()}`);

  // Clean up our own trigger (we're running now)
  cleanupTriggers_('Chain_Gemini_Enrichments');

  // --- CIRCUIT BREAKER: prevent infinite re-triggers ---
  const props = PropertiesService.getScriptProperties();
  const retriggerCount = parseInt(props.getProperty('CHAIN_RETRIGGER_COUNT') || '0', 10);
  if (retriggerCount >= 10) {
    Logger.log('CIRCUIT BREAKER: Chain has re-triggered 10 times. Stopping.');
    Logger.log('  Check for stuck rows. Scheduling ICP refresh and halting.');
    props.setProperty('CHAIN_RETRIGGER_COUNT', '0');
    scheduleICPRefresh_(5);
    return;
  }

  const results = {
    industry: { processed: 0, remaining: 0, errors: 0, skipped: false },
    ownership: { processed: 0, remaining: 0, errors: 0, skipped: false },
    sizeRevenue: { processed: 0, remaining: 0, errors: 0, skipped: false },
    region: { processed: 0, remaining: 0, errors: 0, skipped: false },
    company: { processed: 0, remaining: 0, errors: 0, skipped: false },
    title: { processed: 0, remaining: 0, errors: 0, skipped: false },
    description: { processed: 0, remaining: 0, errors: 0, skipped: false }
  };

  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('FATAL: GEMINI_API_KEY not found in Script Properties');
    Logger.log('  Chain aborted. Add API key and re-run.');
    return;
  }

  // Helper: skip remaining steps on time budget exceeded
  function skipRemaining_(stepNames) {
    for (const name of stepNames) results[name].skipped = true;
    scheduleEnrichmentChain_(2);
    props.setProperty('CHAIN_RETRIGGER_COUNT', String(retriggerCount + 1));
    logChainSummary_(results, startTime);
  }

  // --- STEP 1/7: Industry Enrichment ---
  try {
    Logger.log('STEP 1/7: Industry Enrichment');
    results.industry = enrichIndustryHeadless_(apiKey);
    logStepResult_('Industry', results.industry, startTime);
  } catch (e) {
    Logger.log(`Industry enrichment FAILED: ${e.message}`);
    results.industry.errors = -1;
  }

  if (getElapsedMinutes_(startTime) > 3.5) {
    Logger.log('Time budget exceeded after Industry. Skipping remaining steps.');
    skipRemaining_(['ownership', 'sizeRevenue', 'region', 'company', 'title', 'description']);
    return;
  }

  // --- STEP 2/7: Ownership Enrichment ---
  try {
    Logger.log('STEP 2/7: Ownership Enrichment');
    results.ownership = enrichOwnershipHeadless_(apiKey);
    logStepResult_('Ownership', results.ownership, startTime);
  } catch (e) {
    Logger.log(`Ownership enrichment FAILED: ${e.message}`);
    results.ownership.errors = -1;
  }

  if (getElapsedMinutes_(startTime) > 3.5) {
    Logger.log('Time budget exceeded after Ownership. Skipping remaining steps.');
    skipRemaining_(['sizeRevenue', 'region', 'company', 'title', 'description']);
    return;
  }

  // --- STEP 3/7: Size/Revenue Enrichment ---
  try {
    Logger.log('STEP 3/7: Size/Revenue Enrichment');
    results.sizeRevenue = enrichSizeRevenueHeadless_(apiKey);
    logStepResult_('Size/Revenue', results.sizeRevenue, startTime);
  } catch (e) {
    Logger.log(`Size/Revenue enrichment FAILED: ${e.message}`);
    results.sizeRevenue.errors = -1;
  }

  if (getElapsedMinutes_(startTime) > 4) {
    Logger.log('Time budget exceeded after Size/Revenue.');
    skipRemaining_(['region', 'company', 'title', 'description']);
    return;
  }

  // --- STEP 4/7: Region Tier 3 Enrichment ---
  try {
    Logger.log('STEP 4/7: Region Tier 3 Enrichment');
    results.region = enrichRegionHeadless_(apiKey);
    logStepResult_('Region Tier 3', results.region, startTime);
  } catch (e) {
    Logger.log(`Region enrichment FAILED: ${e.message}`);
    results.region.errors = -1;
  }

  if (getElapsedMinutes_(startTime) > 4) {
    Logger.log('Time budget exceeded after Region.');
    skipRemaining_(['company', 'title', 'description']);
    return;
  }

  // --- STEP 5/7: Company/Domain Enrichment (HM_Person_Master) ---
  try {
    Logger.log('STEP 5/7: Company/Domain Enrichment');
    results.company = enrichCompanyHeadless_(apiKey);
    logStepResult_('Company/Domain', results.company, startTime);
  } catch (e) {
    Logger.log(`Company/Domain enrichment FAILED: ${e.message}`);
    results.company.errors = -1;
  }

  if (getElapsedMinutes_(startTime) > 4.5) {
    Logger.log('Time budget exceeded after Company/Domain.');
    skipRemaining_(['title', 'description']);
    return;
  }

  // --- STEP 6/7: Title Enrichment (HM_Person_Master) ---
  try {
    Logger.log('STEP 6/7: Title Enrichment');
    results.title = enrichTitleHeadless_(apiKey);
    logStepResult_('Title', results.title, startTime);
  } catch (e) {
    Logger.log(`Title enrichment FAILED: ${e.message}`);
    results.title.errors = -1;
  }

  if (getElapsedMinutes_(startTime) > 5) {
    Logger.log('Time budget exceeded after Title.');
    skipRemaining_(['description']);
    return;
  }

  // --- STEP 7/7: Company Description Enrichment (Company_Master) ---
  try {
    Logger.log('STEP 7/7: Company Description Enrichment');
    results.description = enrichCompanyDescriptionHeadless_(apiKey);
    logStepResult_('Description', results.description, startTime);
  } catch (e) {
    Logger.log(`Company Description enrichment FAILED: ${e.message}`);
    results.description.errors = -1;
  }

  // --- DECIDE: Re-trigger or schedule ICP refresh ---
  const totalRemaining = results.industry.remaining + results.ownership.remaining +
                         results.sizeRevenue.remaining + results.region.remaining +
                         results.company.remaining + results.title.remaining +
                         results.description.remaining;
  const anySkipped = results.industry.skipped === true || results.ownership.skipped === true ||
                     results.sizeRevenue.skipped === true || results.region.skipped === true ||
                     results.company.skipped === true || results.title.skipped === true ||
                     results.description.skipped === true;

  if (totalRemaining > 0 || anySkipped) {
    Logger.log(`${totalRemaining} rows still need enrichment. Re-triggering chain in 2 min.`);
    props.setProperty('CHAIN_RETRIGGER_COUNT', String(retriggerCount + 1));
    scheduleEnrichmentChain_(2);
  } else {
    Logger.log('All enrichments complete! Scheduling ICP refresh in 5 min.');
    props.setProperty('CHAIN_RETRIGGER_COUNT', '0');
    scheduleICPRefresh_(5);
  }

  logChainSummary_(results, startTime);
}

// ============================================================================
// ICP REFRESH (runs after all enrichments complete)
// ============================================================================

/**
 * Refresh both ICP_Ranked and BD_Contacts scores
 * Called by time-based trigger after enrichments settle
 */
function Refresh_All_ICP() {
  Logger.log('ICP REFRESH STARTED');
  Logger.log(`Time: ${new Date().toISOString()}`);

  // Clean up our own trigger
  cleanupTriggers_('Refresh_All_ICP');

  try {
    Logger.log('Step 1/2: Refresh ICP Ranked View');
    Refresh_ICP_Ranked();
    Logger.log('  ICP_Ranked refreshed');
  } catch (e) {
    Logger.log(`  ICP_Ranked refresh FAILED: ${e.message}`);
  }

  try {
    Logger.log('Step 2/2: Refresh BD Contacts (Full Flat)');
    refreshBDContactsFull();
    Logger.log('  BD_Contacts refreshed (full flat)');
  } catch (e) {
    Logger.log(`  BD_Contacts refresh FAILED: ${e.message}`);
  }

  // Log completion
  persistRunLog_('ICP_Refresh', {
    action: 'Refresh_All_ICP',
    status: 'complete',
    timestamp: isoNow_()
  });

  Logger.log('ICP REFRESH COMPLETE');
}

// Headless enrichment functions and logging helpers in 07a_Enrichment_Headless.gs
// getElapsedMinutes_, logStepResult_, logChainSummary_ defined there
// enrichIndustryHeadless_, enrichOwnershipHeadless_, enrichSizeRevenueHeadless_,
// enrichRegionHeadless_, enrichCompanyHeadless_, enrichTitleHeadless_,
// enrichCompanyDescriptionHeadless_ defined there
