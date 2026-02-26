/**
 * 14_SDI_Engine.gs
 * SDI Scout - Core Orchestrator
 * Version: 1.0.0
 *
 * PURPOSE: Takes candidate profile → runs full pipeline → returns ranked results.
 *          Main entry point called by sidebar.
 * DEPENDENCIES: 13_SDI_Config.gs, 14_SDI_Search.gs, 14_SDI_Extract.gs,
 *               14_SDI_Persist.gs, 15_Behavioral_Rollup.gs, 15_Gemini_Reconciliation.gs
 */

// ============================================
// SIDEBAR ENTRY POINTS
// ============================================

/**
 * Open the SDI Scout sidebar.
 * Called from menu: SDI Scout → Run SDI Scout (Sidebar)
 */
function openSDIScoutSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('14_SDI_Sidebar')
    .setTitle('SDI Scout')
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Main SDI Scout run — called from sidebar via google.script.run
 *
 * @param {string} candidateProfile - Free-text candidate profile
 * @param {Object} options - { geo: string, timeWindowDays: number }
 * @returns {Object} - Full result object for sidebar display
 */
function sdiScoutRun(candidateProfile, options) {
  const startTime = new Date().getTime();

  try {
    if (!candidateProfile || candidateProfile.trim().length < 20) {
      return { success: false, error: 'Profile too short. Include title, skills, industry, and location.' };
    }

    const geo = (options && options.geo) || SDI_CONFIG.defaultGeo;
    const timeWindowDays = (options && options.timeWindowDays) || SDI_CONFIG.defaultTimeWindowDays;
    const runId = generateSDIRunId_();

    Logger.log('=== SDI SCOUT RUN ===');
    Logger.log(`Run ID: ${runId}`);
    Logger.log(`Profile: ${candidateProfile.substring(0, 100)}...`);
    Logger.log(`Geo: ${geo}, Window: ${timeWindowDays}d`);

    // Step 1: Generate search queries
    Logger.log('Step 1: Generating search queries...');
    const queries = generateSearchQueries_(candidateProfile, geo, timeWindowDays);
    Logger.log(`  ${queries.length} queries generated`);

    // Step 2: Execute Serper searches
    Logger.log('Step 2: Executing Serper searches...');
    const serperResults = executeSerperQueries_(queries);
    Logger.log(`  ${serperResults.length} unique results found`);

    if (serperResults.length === 0) {
      return buildResult_(runId, candidateProfile, queries, 0, 0, 0, 0, [], {}, startTime);
    }

    // Step 3: Extract + classify signals
    Logger.log('Step 3: Extracting company signals...');
    const extraction = extractCompanySignals_(serperResults);
    Logger.log(`  ${extraction.events.length} events extracted`);

    if (extraction.events.length === 0) {
      return buildResult_(runId, candidateProfile, queries, serperResults.length, 0, 0, 0, [], {}, startTime);
    }

    // Step 4: Persist to Company_Events
    Logger.log('Step 4: Persisting events...');
    const persistResult = persistEvents_(extraction.events, runId);
    Logger.log(`  Written: ${persistResult.written}, Dupes: ${persistResult.skippedDuplicates}, Unresolved: ${persistResult.unresolvedDomains}`);

    // Step 5: Behavioral rollup for affected domains
    const affectedDomains = getUniqueDomains_(extraction.events);
    Logger.log('Step 5: Running behavioral rollup...');
    const rollupResult = runBehavioralRollup_(affectedDomains);
    Logger.log(`  ${rollupResult.domainsUpdated} domains updated`);

    // Step 5b: Funding sweep for Capital events
    if (persistResult.capitalDomains.length > 0) {
      Logger.log('Step 5b: Running funding sweep...');
      const fundingResult = runFundingSweep_(persistResult.capitalDomains);
      Logger.log(`  ${fundingResult.upserted} funding records upserted`);
    }

    // Step 6: Build ranked output
    Logger.log('Step 6: Building ranked output...');
    const rankedResults = buildRankedOutput_(affectedDomains, extraction.approachAngles, extraction.events);

    // Step 7: Log run
    const elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);
    Logger.log(`=== SDI SCOUT COMPLETE (${elapsed}s) ===`);

    const result = buildResult_(
      runId, candidateProfile, queries, serperResults.length,
      persistResult.written, persistResult.skippedDuplicates, persistResult.unresolvedDomains,
      rankedResults, extraction.approachAngles, startTime
    );

    // Persist run log
    persistRunLog_('SDI_Scout_Run', {
      runId: runId,
      queriesExecuted: queries.length,
      serperResultsFound: serperResults.length,
      eventsExtracted: extraction.events.length,
      eventsWritten: persistResult.written,
      duplicatesSkipped: persistResult.skippedDuplicates,
      unresolvedDomains: persistResult.unresolvedDomains,
      domainsUpdated: rollupResult.domainsUpdated,
      capitalDomains: persistResult.capitalDomains.length,
      companiesFound: rankedResults.length,
      elapsedSeconds: elapsed
    });

    return result;

  } catch (error) {
    Logger.log(`ERROR in sdiScoutRun: ${error.message}`);
    Logger.log(`Stack: ${error.stack || 'none'}`);
    logError_('SDI_SCOUT', 'RUN_FAILED', 'sdiScoutRun', error.message);
    return { success: false, error: error.message };
  }
}

// Ranked output builder and helpers moved to 14a_SDI_Ranked.gs:
// buildRankedOutput_, getUniqueDomains_, findCompanyNameFromEvents_,
// getEvidenceUrls_, buildResult_
