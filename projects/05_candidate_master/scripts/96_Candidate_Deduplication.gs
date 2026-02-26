/**
 * 96_Candidate_Deduplication.gs
 * Orchestrators for Gemini-powered candidate deduplication
 *
 * PURPOSE: Match LinkedIn-only candidates against Bullhorn candidates
 * WORKFLOW:
 *   1. Process 40 LinkedIn candidates at a time (batch processing)
 *   2. Auto-merge 95%+ confidence matches
 *   3. Write <95% matches to Candidate_Match_Review for manual review
 *
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00d_Name_Matching.gs, 96b_Dedup_Helpers.gs
 *
 * HELPER FUNCTIONS: All data retrieval, Gemini matching, merge logic, review tab management,
 * and UID-based lookups live in 96b_Dedup_Helpers.gs
 *
 * TRIGGER: runGeminiMatchingBatch() runs on a timed trigger (background)
 */

// normalizeName(), normalizeDiacritics(), levenshteinDistance() defined in 00d_Name_Matching.gs

/**
 * Batch deduplication — processes 40 LinkedIn candidates at a time
 * Safe to run multiple times — tracks progress via Match_Status column
 * USER-FACING: Runs from timed trigger or Apps Script editor
 */
function runGeminiMatchingBatch() {
  Logger.log("=== Starting Gemini Matching Batch ===");

  const BATCH_SIZE = 40;

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const masterSheet = ss.getSheetByName(TAB_CANDIDATE_MASTER);

    const bullhornCandidates = getBullhornCandidates(masterSheet);
    Logger.log(`Loaded ${bullhornCandidates.length} Bullhorn candidates for matching`);

    const linkedInBatch = getLinkedInCandidatesNeedingMatching(masterSheet, BATCH_SIZE);

    if (linkedInBatch.length === 0) {
      Logger.log("No LinkedIn candidates need matching. All done!");
      return { success: true, processed: 0, remaining: 0 };
    }

    Logger.log(`Processing ${linkedInBatch.length} LinkedIn candidates...`);

    let exactMatches = 0;
    let fuzzyMatches = 0;
    let noMatches = 0;
    let skipped = 0;

    for (const linkedInCandidate of linkedInBatch) {
      // Skip blank candidates (deleted LinkedIn accounts, privacy-restricted profiles)
      if (!linkedInCandidate.fullName || !linkedInCandidate.fullName.trim()) {
        Logger.log(`Skipping blank candidate at row ${linkedInCandidate.rowNum} (UID: ${linkedInCandidate.uid})`);
        markAsProcessed(masterSheet, linkedInCandidate.rowNum, 'NO_MATCH');
        skipped++;
        noMatches++;
        continue;
      }

      Logger.log(`Matching: ${linkedInCandidate.fullName} @ ${linkedInCandidate.currentCompany}`);

      const geminiMatches = findMatchesWithGemini(linkedInCandidate, bullhornCandidates);

      Logger.log(`  Found ${geminiMatches.length} potential matches`);
      if (geminiMatches.length > 0) {
        Logger.log(`  Best match: ${geminiMatches[0].bullhornCandidate.fullName} (${geminiMatches[0].confidence}%)`);
        Logger.log(`  Reason: ${geminiMatches[0].reason}`);
      }

      if (geminiMatches.length === 0) {
        Logger.log(`  → NO MATCH`);
        markAsProcessedByUID(masterSheet, linkedInCandidate.uid, 'NO_MATCH');
        noMatches++;
      } else if (geminiMatches[0].confidence >= 95) {
        Logger.log(`  → AUTO-MERGE (${geminiMatches[0].confidence}%)`);
        mergeLinkedInToBullhorn(masterSheet, linkedInCandidate, geminiMatches[0].bullhornCandidate);
        exactMatches++;
      } else {
        Logger.log(`  → REVIEW TAB (${geminiMatches[0].confidence}%)`);
        writeToReviewTab(ss, linkedInCandidate, geminiMatches.slice(0, 3));
        markAsProcessedByUID(masterSheet, linkedInCandidate.uid, 'REVIEW');
        fuzzyMatches++;
      }

      Utilities.sleep(500);
    }

    const remaining = countLinkedInCandidatesNeedingMatching(masterSheet);

    Logger.log("=== Gemini Matching Batch Complete ===");
    Logger.log(`Exact matches (auto-merged): ${exactMatches}`);
    Logger.log(`Fuzzy matches (review tab): ${fuzzyMatches}`);
    Logger.log(`No matches: ${noMatches}`);
    Logger.log(`Skipped (blank/deleted accounts): ${skipped}`);
    Logger.log(`Remaining: ${remaining}`);

    return { success: true, exactMatches, fuzzyMatches, noMatches, remaining };

  } catch (error) {
    Logger.log(`ERROR in runGeminiMatchingBatch: ${error.message}`);
    logError("GEMINI_MATCHING_ERROR", error.message, error.stack);
    throw error;
  }
}

/**
 * Reset all NO_MATCH candidates back to empty status for re-processing
 * USER-FACING: Run after improving matching logic to retry failed matches
 */
function resetNoMatchCandidates() {
  Logger.log("=== Resetting NO_MATCH Candidates ===");

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const masterSheet = ss.getSheetByName(TAB_CANDIDATE_MASTER);
    const data = masterSheet.getDataRange().getValues();
    const headers = data[0];

    const matchStatusCol = headers.indexOf('Match_Status');
    if (matchStatusCol === -1) {
      Logger.log("Match_Status column not found. Nothing to reset.");
      return { success: true, resetCount: 0 };
    }

    let resetCount = 0;

    for (let i = 1; i < data.length; i++) {
      if (data[i][matchStatusCol] === 'NO_MATCH') {
        masterSheet.getRange(i + 1, matchStatusCol + 1).clearContent();
        resetCount++;
      }
    }

    Logger.log(`Reset ${resetCount} NO_MATCH candidates to empty status`);
    Logger.log("=== Reset Complete ===");

    return { success: true, resetCount };

  } catch (error) {
    Logger.log(`ERROR in resetNoMatchCandidates: ${error.message}`);
    throw error;
  }
}

/**
 * Process manual review decisions from Candidate_Match_Review tab
 * USER-FACING: Run after making manual match decisions in review tab
 *
 * WORKFLOW:
 * 1. Read review tab for rows with decisions (Action != "Pending Review")
 * 2. If "NO MATCH" → Mark LinkedIn candidate as NO_MATCH
 * 3. If Bullhorn_UID → Merge LinkedIn candidate into that Bullhorn row
 * 4. Clear processed rows from review tab
 */
function processReviewDecisions() {
  Logger.log("=== Processing Review Decisions ===");

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const reviewSheet = ss.getSheetByName(TAB_CANDIDATE_MATCH_REVIEW);
    const masterSheet = ss.getSheetByName(TAB_CANDIDATE_MASTER);

    if (!reviewSheet) {
      Logger.log("No Candidate_Match_Review tab found. Nothing to process.");
      return { success: true, processed: 0 };
    }

    const data = reviewSheet.getDataRange().getValues();
    if (data.length <= 1) {
      Logger.log("No review items found.");
      return { success: true, processed: 0 };
    }

    const headers = data[0];
    const actionCol = headers.indexOf('Action');
    const uidCol = headers.indexOf('LinkedIn_UID');
    const nameCol = headers.indexOf('LinkedIn_Name');

    let merged = 0;
    let noMatch = 0;
    const rowsToDelete = [];

    // Process from bottom to avoid row number shifts
    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      const action = row[actionCol];

      if (!action || action === 'Pending Review') continue;

      const linkedInUID = row[uidCol];
      const linkedInName = row[nameCol];

      Logger.log(`Processing: ${linkedInName} (${linkedInUID}) → Action: ${action}`);

      let success = false;

      if (action === 'NO MATCH') {
        const linkedInRow = findCandidateRowByUID(masterSheet, linkedInUID);
        if (linkedInRow) {
          markAsProcessed(masterSheet, linkedInRow, 'NO_MATCH');
          Logger.log(`  Marked as NO_MATCH`);
          noMatch++;
          success = true;
        } else {
          Logger.log(`  WARNING: LinkedIn candidate ${linkedInUID} not found in Candidate_Master`);
        }
      } else {
        // Action is a Bullhorn UID → Merge
        const bullhornUID = action;
        const linkedInCandidate = findLinkedInCandidateByUID(masterSheet, linkedInUID);
        const bullhornCandidate = findBullhornCandidateByUID(masterSheet, bullhornUID);

        if (linkedInCandidate && bullhornCandidate) {
          mergeLinkedInToBullhorn(masterSheet, linkedInCandidate, bullhornCandidate);
          Logger.log(`  Merged into ${bullhornCandidate.fullName} (${bullhornUID})`);
          merged++;
          success = true;
        } else {
          Logger.log(`  WARNING: Could not find candidates for merge. LI: ${linkedInUID}, BH: ${bullhornUID}`);
        }
      }

      if (success) {
        rowsToDelete.push(i + 1);
      }
    }

    // Delete processed rows (already reversed)
    for (const rowNum of rowsToDelete) {
      reviewSheet.deleteRow(rowNum);
    }

    Logger.log("=== Review Processing Complete ===");
    Logger.log(`Merged: ${merged}, Marked NO_MATCH: ${noMatch}`);
    Logger.log(`Cleared ${rowsToDelete.length} rows from review tab`);

    return { success: true, merged, noMatch, processed: rowsToDelete.length };

  } catch (error) {
    Logger.log(`ERROR in processReviewDecisions: ${error.message}`);
    logError("PROCESS_REVIEW_ERROR", error.message, error.stack);
    throw error;
  }
}
