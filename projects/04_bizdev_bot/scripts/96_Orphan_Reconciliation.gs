/**
 * BD TRACKER - ORPHAN RECONCILIATION ASSISTANT
 * Version: 1.0.0
 *
 * CONTAINS:
 * - Find potential matches for orphaned records (no LinkedIn URL)
 * - Exact + Fuzzy name matching with confidence scoring
 * - Write match suggestions to HM_Orphaned_Records tab
 * - Mark reviewed records and move to archive
 *
 * WORKFLOW:
 * 1. User runs Bullhorn import (creates orphaned records)
 * 2. User clicks menu "🔍 Find Potential Matches for Orphans"
 * 3. Script analyzes orphans and writes top 3 suggestions per record
 * 4. User reviews suggestions in HM_Orphaned_Records tab
 * 5. User manually updates LinkedIn URL or composite key as needed
 * 6. User clicks "Mark as Reviewed" button to archive reviewed records
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 */

/** ==========================================================================
 *  MAIN USER-FACING FUNCTIONS
 *  ========================================================================== */

/**
 * TEST FUNCTION - Find potential matches without UI prompts
 * Run this from Apps Script editor for testing
 * Logs results to execution log instead of showing alerts
 */
function TEST_FindPotentialMatches() {
  try {
    Logger.log('=== ORPHAN RECONCILIATION TEST ===');
    Logger.log('Finding potential matches...');

    const ss = getSpreadsheet_();
    const orphanSheet = ss.getSheetByName('HM_Orphaned_Records');

    if (!orphanSheet) {
      Logger.log('❌ HM_Orphaned_Records tab does not exist');
      return;
    }

    // Count pending orphans
    const orphanData = orphanSheet.getDataRange().getValues();
    const pendingCount = orphanData.slice(1).filter(row => row[8] === 'Pending').length;

    Logger.log(`Found ${pendingCount} pending orphans to process`);

    if (pendingCount === 0) {
      Logger.log('No pending orphans to process');
      return;
    }

    // Execute match finding
    const result = findAndWriteMatchSuggestions_();

    // Log results
    Logger.log('=== MATCH SUGGESTIONS COMPLETE ===');
    Logger.log(`✅ Records Processed: ${result.processedCount}`);
    Logger.log(`✅ Exact Matches Found: ${result.exactMatchCount}`);
    Logger.log(`✅ Fuzzy Matches Found: ${result.fuzzyMatchCount}`);
    Logger.log(`✅ No Matches: ${result.noMatchCount}`);
    Logger.log('');
    Logger.log('Review suggestions in columns F-H of HM_Orphaned_Records tab.');
    Logger.log('EXACT matches = High confidence (same name)');
    Logger.log('FUZZY matches = Lower confidence (similar name)');

    return result;

  } catch (e) {
    Logger.log(`❌ ERROR: ${e.toString()}`);
    logError_('ORPHAN_RECONCILIATION', 'MATCH_ERROR', 'TEST_FindPotentialMatches', e.toString());
    throw e;
  }
}

/**
 * Find potential matches for all orphaned records
 * USER-FACING FUNCTION (triggered from menu)
 *
 * Process:
 * 1. Read all records from HM_Orphaned_Records (where Review_Status = "Pending")
 * 2. For each orphan, search for similar names in HM_Person_Master (with LinkedIn URLs)
 * 3. Use exact + fuzzy matching to find top 3 suggestions
 * 4. Write suggestions to columns F-H with confidence levels
 */
function RunOnce_FindPotentialMatches() {
  try {
    const ss = getSpreadsheet_();
    const ui = SpreadsheetApp.getUi();

    // Check if HM_Orphaned_Records exists
    const orphanSheet = ss.getSheetByName('HM_Orphaned_Records');
    if (!orphanSheet) {
      ui.alert(
        'No Orphaned Records Found',
        'HM_Orphaned_Records tab does not exist.\\n\\n' +
        'This tab is created automatically after Bullhorn import.\\n\\n' +
        'Please run Bullhorn import first.',
        ui.ButtonSet.OK
      );
      return;
    }

    // Count pending orphans
    const orphanData = orphanSheet.getDataRange().getValues();
    const pendingCount = orphanData.slice(1).filter(row => row[8] === 'Pending').length;

    if (pendingCount === 0) {
      ui.alert(
        'No Pending Orphans',
        'All orphaned records have been reviewed.\\n\\n' +
        'No new match suggestions needed.',
        ui.ButtonSet.OK
      );
      return;
    }

    // Confirmation dialog
    const response = ui.alert(
      'Find Potential Matches?',
      `This will search for potential matches for ${pendingCount} orphaned records.\\n\\n` +
      'The script will write up to 3 match suggestions per record with confidence levels.\\n\\n' +
      'This may take 1-2 minutes.\\n\\n' +
      'Proceed?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      ss.toast('Match search cancelled by user.', 'Cancelled');
      return;
    }

    // Execute match finding
    const result = findAndWriteMatchSuggestions_();

    // Show results
    ss.toast(
      `✅ Match Suggestions Complete:\\n` +
      `Records Processed: ${result.processedCount}\\n` +
      `Exact Matches Found: ${result.exactMatchCount}\\n` +
      `Fuzzy Matches Found: ${result.fuzzyMatchCount}\\n` +
      `No Matches: ${result.noMatchCount}`,
      'Suggestions Ready',
      10
    );

    ui.alert(
      'Match Suggestions Ready',
      `${result.processedCount} orphaned records have been analyzed.\\n\\n` +
      'Review the suggestions in columns F-H of HM_Orphaned_Records tab.\\n\\n' +
      'EXACT matches = High confidence (same name)\\n' +
      'FUZZY matches = Lower confidence (similar name)\\n\\n' +
      'Manually update records as needed, then use "Mark as Reviewed" button.',
      ui.ButtonSet.OK
    );

  } catch (e) {
    logError_('ORPHAN_RECONCILIATION', 'MATCH_ERROR', 'RunOnce_FindPotentialMatches', e.toString());
    SpreadsheetApp.getUi().alert(`Error finding matches: ${e.message}`);
  }
}

/**
 * Mark selected orphaned records as reviewed and move to archive
 * USER-FACING FUNCTION (triggered from menu)
 *
 * User should select rows in HM_Orphaned_Records to mark as reviewed
 * Selected rows will be moved to HM_Orphaned_Records_Archive
 */
function RunOnce_MarkOrphansAsReviewed() {
  try {
    const ss = getSpreadsheet_();
    const ui = SpreadsheetApp.getUi();
    const orphanSheet = ss.getSheetByName('HM_Orphaned_Records');

    if (!orphanSheet) {
      ui.alert('HM_Orphaned_Records tab not found.', ui.ButtonSet.OK);
      return;
    }

    // Get selected range
    const selection = orphanSheet.getActiveRange();
    if (!selection) {
      ui.alert(
        'No Selection',
        'Please select the rows you want to mark as reviewed.\\n\\n' +
        'Select entire rows (click row numbers on left).',
        ui.ButtonSet.OK
      );
      return;
    }

    const startRow = selection.getRow();
    const numRows = selection.getNumRows();

    // Don't allow marking header row
    if (startRow === 1) {
      ui.alert(
        'Invalid Selection',
        'Cannot mark header row as reviewed.\\n\\n' +
        'Please select data rows only (row 2 and below).',
        ui.ButtonSet.OK
      );
      return;
    }

    // Confirmation
    const response = ui.alert(
      'Mark as Reviewed?',
      `This will mark ${numRows} row(s) as reviewed and move them to archive.\\n\\n` +
      'Proceed?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      ss.toast('Cancelled by user.', 'Cancelled');
      return;
    }

    // Execute move to archive
    const result = moveToArchive_(startRow, numRows);

    ss.toast(
      `✅ ${result.movedCount} row(s) moved to archive.`,
      'Marked as Reviewed',
      5
    );

  } catch (e) {
    logError_('ORPHAN_RECONCILIATION', 'MARK_REVIEWED_ERROR', 'RunOnce_MarkOrphansAsReviewed', e.toString());
    SpreadsheetApp.getUi().alert(`Error marking as reviewed: ${e.message}`);
  }
}

// Core matching logic, archive management, and helpers moved to 96a_Orphan_Match_Logic.gs:
// findAndWriteMatchSuggestions_, findTopMatches_, formatSuggestion_,
// moveToArchive_, levenshteinDistance_, addOrphanReconciliationToMenu_
