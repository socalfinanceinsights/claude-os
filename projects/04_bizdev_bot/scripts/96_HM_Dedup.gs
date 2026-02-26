/**
 * 96_HM_Dedup.gs
 * Orchestrator for NO_LI → LinkedIn key deduplication in HM_Person_Master
 *
 * PURPOSE: Find NO_LI-* records that have matching real LinkedIn-keyed records,
 *          merge them (LinkedIn key wins), and cascade key updates to all downstream sheets.
 *
 * WORKFLOW:
 *   1. Scan HM_Person_Master for NO_LI-* composite keys
 *   2. Pre-filter by name similarity (Levenshtein) against real LinkedIn records
 *   3. Send top candidates to Gemini for identity matching
 *   4. Auto-merge 95%+ confidence matches
 *   5. Write <95% matches to HM_Dedup_Review for manual review
 *
 * DOWNSTREAM CASCADES: When merging, updates all sheets referencing the old NO_LI key:
 *   - HM_Signals_Master (Col A)
 *   - HM_Interaction_History (Col A)
 *   - HM_ContactInfo (Col A)
 *   - Placements_Log (Col D)
 *   - BD_Contacts (Col A)
 *
 * DEPENDENCIES: 00_Brain_Config.gs, 96_Orphan_Reconciliation.gs (normalizeName_, levenshteinDistance_)
 * HELPER FUNCTIONS: 96b_HM_Dedup_Helpers.gs
 *
 * TRIGGER: runHMDedupBatch() from menu or timed trigger
 */

/**
 * Batch dedup — processes up to BATCH_SIZE NO_LI records per run
 * Safe to run multiple times — tracks progress via Dedup_Status column
 * USER-FACING: Runs from menu or Apps Script editor
 */
function runHMDedupBatch() {
  Logger.log('=== Starting HM Person Master NO_LI Dedup ===');

  const BATCH_SIZE = 40;

  try {
    const ss = getSpreadsheet_();
    const hmSheet = ss.getSheetByName(CONFIG.sheetHM);

    if (!hmSheet) {
      Logger.log('HM_Person_Master not found');
      return { success: false, error: 'Sheet not found' };
    }

    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      Logger.log('GEMINI_API_KEY not set');
      return { success: false, error: 'API key missing' };
    }

    // Load all records
    const allRecords = loadHMPersonRecords_(hmSheet);
    const linkedInRecords = allRecords.filter(r => !r.key.startsWith('NO_LI-'));
    const noLiBatch = getNoLiRecordsNeedingDedup_(hmSheet, allRecords, BATCH_SIZE);

    Logger.log(`Loaded ${allRecords.length} total records`);
    Logger.log(`  LinkedIn-keyed: ${linkedInRecords.length}`);
    Logger.log(`  NO_LI batch to process: ${noLiBatch.length}`);

    if (noLiBatch.length === 0) {
      Logger.log('No NO_LI candidates need dedup. All done!');
      return { success: true, processed: 0, remaining: 0 };
    }

    let autoMerged = 0;
    let sentToReview = 0;
    let noMatches = 0;

    for (const noLiRecord of noLiBatch) {
      // Skip personal LinkedIn connections
      if (noLiRecord.liPersonal === 'YES') {
        Logger.log(`Skipping ${noLiRecord.name} (${noLiRecord.key}) — LI_Personal=YES`);
        markDedupStatus_(hmSheet, noLiRecord.rowNum, 'SKIPPED_PERSONAL');
        continue;
      }

      Logger.log(`Matching: ${noLiRecord.name} (${noLiRecord.key})`);

      // Pre-filter by name similarity
      const preFiltered = preFilterByName_(noLiRecord, linkedInRecords);

      if (preFiltered.length === 0) {
        Logger.log('  → NO MATCH (no similar names)');
        markDedupStatus_(hmSheet, noLiRecord.rowNum, 'NO_MATCH');
        noMatches++;
        continue;
      }

      // Send to Gemini for identity matching
      const geminiMatches = matchNoLiWithGemini_(noLiRecord, preFiltered, apiKey);

      if (geminiMatches.length === 0) {
        Logger.log('  → NO MATCH (Gemini found no matches)');
        markDedupStatus_(hmSheet, noLiRecord.rowNum, 'NO_MATCH');
        noMatches++;
      } else if (geminiMatches[0].confidence >= 95) {
        Logger.log(`  → AUTO-MERGE (${geminiMatches[0].confidence}%) → ${geminiMatches[0].record.key}`);
        mergeNoLiToLinkedIn_(ss, hmSheet, noLiRecord, geminiMatches[0].record);
        autoMerged++;
      } else {
        Logger.log(`  → REVIEW (${geminiMatches[0].confidence}%)`);
        writeToHMDedupReview_(ss, noLiRecord, geminiMatches.slice(0, 3));
        markDedupStatus_(hmSheet, noLiRecord.rowNum, 'REVIEW');
        sentToReview++;
      }

      Utilities.sleep(500);
    }

    const remaining = countNoLiNeedingDedup_(hmSheet);

    Logger.log('=== HM Dedup Batch Complete ===');
    Logger.log(`Auto-merged: ${autoMerged}`);
    Logger.log(`Sent to review: ${sentToReview}`);
    Logger.log(`No matches: ${noMatches}`);
    Logger.log(`Remaining: ${remaining}`);

    return { success: true, autoMerged, sentToReview, noMatches, remaining };

  } catch (error) {
    Logger.log(`ERROR in runHMDedupBatch: ${error.message}`);
    Logger.log(`Stack: ${error.stack}`);
    logError_('HM_DEDUP', 'BATCH_ERROR', 'HM Dedup Batch', error.message);
    throw error;
  }
}

/**
 * Process manual decisions from HM_Dedup_Review tab
 * USER-FACING: Run after making decisions in the review tab
 *
 * WORKFLOW:
 * 1. Read review tab for rows with decisions (Action != "Pending Review")
 * 2. If "NO MATCH" → Mark NO_LI record as NO_MATCH
 * 3. If LinkedIn key → Merge NO_LI into that LinkedIn record
 * 4. Clear processed rows from review tab
 */
function processHMDedupReviewDecisions() {
  Logger.log('=== Processing HM Dedup Review Decisions ===');

  try {
    const ss = getSpreadsheet_();
    const reviewSheet = ss.getSheetByName('HM_Dedup_Review');
    const hmSheet = ss.getSheetByName(CONFIG.sheetHM);

    if (!reviewSheet) {
      Logger.log('No HM_Dedup_Review tab found.');
      return { success: true, processed: 0 };
    }

    const data = reviewSheet.getDataRange().getValues();
    if (data.length <= 1) {
      Logger.log('No review items found.');
      return { success: true, processed: 0 };
    }

    const headers = data[0];
    const actionCol = headers.indexOf('Action');
    const noLiKeyCol = headers.indexOf('NO_LI_Key');

    let merged = 0;
    let noMatch = 0;
    const rowsToDelete = [];

    // Process bottom-up to avoid row shift issues
    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      const action = String(row[actionCol]).trim();

      if (!action || action === 'Pending Review') continue;

      const noLiKey = String(row[noLiKeyCol]).trim();
      Logger.log(`Processing: ${noLiKey} → Action: ${action}`);

      if (action === 'NO MATCH') {
        markDedupStatusByKey_(hmSheet, noLiKey, 'NO_MATCH');
        noMatch++;
      } else {
        // Action is a LinkedIn composite key → Merge
        const allRecords = loadHMPersonRecords_(hmSheet);
        const noLiRecord = allRecords.find(r => r.key === noLiKey);
        const liRecord = allRecords.find(r => r.key === action);

        if (noLiRecord && liRecord) {
          mergeNoLiToLinkedIn_(ss, hmSheet, noLiRecord, liRecord);
          Logger.log(`  Merged ${noLiKey} → ${action}`);
          merged++;
        } else {
          Logger.log(`  WARNING: Could not find records for merge. NO_LI: ${noLiKey}, LI: ${action}`);
        }
      }

      rowsToDelete.push(i + 1);
    }

    // Delete processed rows (already bottom-up)
    for (const rowNum of rowsToDelete) {
      reviewSheet.deleteRow(rowNum);
    }

    Logger.log('=== Review Processing Complete ===');
    Logger.log(`Merged: ${merged}, No Match: ${noMatch}, Cleared: ${rowsToDelete.length} rows`);

    return { success: true, merged, noMatch, processed: rowsToDelete.length };

  } catch (error) {
    Logger.log(`ERROR in processHMDedupReviewDecisions: ${error.message}`);
    logError_('HM_DEDUP', 'REVIEW_PROCESS_ERROR', 'HM Dedup Review', error.message);
    throw error;
  }
}

/**
 * Apply known matches from a pre-built list
 * USER-FACING: Run after pasting verified matches into the sheet
 *
 * @param {Array<Object>} matches - Array of {noLiKey, linkedInKey} pairs
 */
function applyKnownHMDedupMatches(matches) {
  Logger.log('=== Applying Known HM Dedup Matches ===');

  const ss = getSpreadsheet_();
  const hmSheet = ss.getSheetByName(CONFIG.sheetHM);

  let merged = 0;
  let failed = 0;

  for (const match of matches) {
    const allRecords = loadHMPersonRecords_(hmSheet);
    const noLiRecord = allRecords.find(r => r.key === match.noLiKey);
    const liRecord = allRecords.find(r => r.key === match.linkedInKey);

    if (noLiRecord && liRecord) {
      mergeNoLiToLinkedIn_(ss, hmSheet, noLiRecord, liRecord);
      Logger.log(`Merged: ${match.noLiKey} → ${match.linkedInKey}`);
      merged++;
    } else {
      Logger.log(`FAILED: ${match.noLiKey} → ${match.linkedInKey} (record not found)`);
      failed++;
    }
  }

  Logger.log(`=== Applied ${merged} merges, ${failed} failed ===`);
  return { merged, failed };
}

/**
 * Reset NO_MATCH candidates back to empty for re-processing
 * USER-FACING: Run after improving matching logic to retry
 */
function resetHMDedupNoMatches() {
  Logger.log('=== Resetting HM Dedup NO_MATCH Records ===');

  const ss = getSpreadsheet_();
  const hmSheet = ss.getSheetByName(CONFIG.sheetHM);
  const data = hmSheet.getDataRange().getValues();
  const headers = data[0];

  const dedupStatusCol = headers.indexOf('Dedup_Status');
  if (dedupStatusCol === -1) {
    Logger.log('No Dedup_Status column found.');
    return { success: true, resetCount: 0 };
  }

  let resetCount = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][dedupStatusCol] === 'NO_MATCH') {
      hmSheet.getRange(i + 1, dedupStatusCol + 1).clearContent();
      resetCount++;
    }
  }

  Logger.log(`Reset ${resetCount} NO_MATCH records`);
  return { success: true, resetCount };
}
