/**
 * BD TRACKER - ORPHAN MERGE & CLEANUP
 * Version: 1.0.0
 *
 * CONTAINS:
 * - Automated merge of orphaned records after manual review
 * - Updates all interactions to point to merged composite key
 * - Cleans up orphan records from HM_Person_Master
 * - Marks as "Merged" in HM_Orphaned_Records
 *
 * WORKFLOW:
 * 1. Review orphans in HM_Orphaned_Records tab
 * 2. For each orphan to merge:
 *    - Set Review_Status = "Merge"
 *    - Set Merge_With_Key = target composite key
 * 3. Run this script (menu or TEST function)
 * 4. Script automatically:
 *    - Updates HM_Interaction_History (orphan key → target key)
 *    - Updates HM_Signals_Master (orphan key → target key)
 *    - Deletes orphan from HM_Person_Master
 *    - Marks as "Merged" in HM_Orphaned_Records
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 */

/** ==========================================================================
 *  MAIN FUNCTIONS
 *  ========================================================================== */

/**
 * TEST FUNCTION - Merge orphans without UI prompts
 * Run from Apps Script editor
 */
function TEST_MergeOrphans() {
  try {
    Logger.log('=== ORPHAN MERGE TEST ===');
    Logger.log('Starting merge process...');

    const result = processMerges_();

    Logger.log('=== MERGE COMPLETE ===');
    Logger.log(`✅ Orphans Merged: ${result.mergedCount}`);
    Logger.log(`✅ Interactions Updated: ${result.interactionsUpdated}`);
    Logger.log(`✅ Signals Updated: ${result.signalsUpdated}`);
    Logger.log(`✅ Errors: ${result.errors}`);

    if (result.mergedCount === 0) {
      Logger.log('\n⚠️ No orphans marked for merge.');
      Logger.log('Set Review_Status = "Merge" and fill Merge_With_Key column.');
    }

    return result;

  } catch (e) {
    Logger.log(`❌ ERROR: ${e.toString()}`);
    logError_('ORPHAN_MERGE', 'MERGE_ERROR', 'TEST_MergeOrphans', e.toString());
    throw e;
  }
}

/**
 * USER-FACING FUNCTION - Merge orphans with UI confirmation
 * Run from menu
 */
function RunOnce_MergeOrphans() {
  try {
    const ss = getSpreadsheet_();
    const ui = SpreadsheetApp.getUi();

    // Confirmation dialog
    const response = ui.alert(
      'Merge Orphaned Records?',
      'This will merge all orphaned records marked with Review_Status = "Merge".\\n\\n' +
      'The script will:\\n' +
      '- Update all interactions to use merged composite key\\n' +
      '- Delete orphan records from HM_Person_Master\\n' +
      '- Mark as "Merged" in HM_Orphaned_Records\\n\\n' +
      'Proceed?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      ss.toast('Merge cancelled by user.', 'Cancelled');
      return;
    }

    // Execute merge
    const result = processMerges_();

    // Show results
    ss.toast(
      `✅ Orphan Merge Complete:\\n` +
      `Merged: ${result.mergedCount}\\n` +
      `Interactions Updated: ${result.interactionsUpdated}\\n` +
      `Signals Updated: ${result.signalsUpdated}\\n` +
      `Errors: ${result.errors}`,
      'Merge Complete',
      10
    );

    if (result.mergedCount === 0) {
      ui.alert(
        'No Orphans to Merge',
        'No orphans found with Review_Status = "Merge".\\n\\n' +
        'To merge an orphan:\\n' +
        '1. Go to HM_Orphaned_Records tab\\n' +
        '2. Set Review_Status = "Merge"\\n' +
        '3. Fill Merge_With_Key with target composite key\\n' +
        '4. Run this function again',
        ui.ButtonSet.OK
      );
    }

  } catch (e) {
    logError_('ORPHAN_MERGE', 'MERGE_ERROR', 'RunOnce_MergeOrphans', e.toString());
    SpreadsheetApp.getUi().alert(`Error during orphan merge: ${e.message}`);
  }
}

/** ==========================================================================
 *  CORE MERGE LOGIC
 *  ========================================================================== */

/**
 * Process all orphan merges
 * Reads HM_Orphaned_Records, finds rows marked "Merge", processes them
 *
 * @returns {Object} - {mergedCount, interactionsUpdated, signalsUpdated, errors}
 */
function processMerges_() {
  const ss = getSpreadsheet_();

  // Get sheets
  const orphanSheet = ss.getSheetByName('HM_Orphaned_Records');
  if (!orphanSheet) {
    throw new Error('HM_Orphaned_Records sheet not found');
  }

  const hm = ss.getSheetByName(CONFIG.sheetHM);
  if (!hm) throw new Error(`Sheet "${CONFIG.sheetHM}" not found`);

  // Read orphan records
  const lastRow = orphanSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No orphan records found');
    return { mergedCount: 0, interactionsUpdated: 0, signalsUpdated: 0, errors: 0 };
  }

  const orphanData = orphanSheet.getRange(2, 1, lastRow - 1, 11).getValues();

  // Column mapping for HM_Orphaned_Records:
  // A: Composite_Key, B: HM_Name, C: HM_Title, D: Company, E: Source,
  // F: Suggested_Match_1, G: Suggested_Match_2, H: Suggested_Match_3,
  // I: Review_Status, J: Manual_Notes, K: Merge_With_Key

  // Find rows marked for merge
  const merges = [];
  for (let i = 0; i < orphanData.length; i++) {
    const row = orphanData[i];
    const reviewStatus = String(row[8] || '').trim(); // Column I
    const orphanKey = String(row[0] || '').trim();    // Column A
    const targetKey = String(row[10] || '').trim();   // Column K

    if (reviewStatus === 'Merge' && orphanKey && targetKey) {
      merges.push({
        rowIndex: i + 2, // Sheet row number (1-indexed, +1 for header)
        orphanKey: orphanKey,
        targetKey: targetKey,
        orphanName: row[1]
      });
    }
  }

  Logger.log(`Found ${merges.length} orphans marked for merge`);

  if (merges.length === 0) {
    return { mergedCount: 0, interactionsUpdated: 0, signalsUpdated: 0, errors: 0 };
  }

  // Process each merge
  let mergedCount = 0;
  let interactionsUpdated = 0;
  let signalsUpdated = 0;
  let errorCount = 0;

  for (const merge of merges) {
    try {
      Logger.log(`Merging ${merge.orphanName}: ${merge.orphanKey} → ${merge.targetKey}`);

      // 1. Update HM_Interaction_History
      const interactionCount = updateInteractionHistory_(merge.orphanKey, merge.targetKey);
      interactionsUpdated += interactionCount;
      Logger.log(`  ✓ Updated ${interactionCount} interactions`);

      // 2. Update HM_Signals_Master
      const signalCount = updateSignalsMaster_(merge.orphanKey, merge.targetKey);
      signalsUpdated += signalCount;
      Logger.log(`  ✓ Updated ${signalCount} signals`);

      // 3. Delete orphan from HM_Person_Master
      deleteOrphanFromHM_(hm, merge.orphanKey);
      Logger.log(`  ✓ Deleted orphan from HM_Person_Master`);

      // 4. Mark as merged in HM_Orphaned_Records
      orphanSheet.getRange(merge.rowIndex, 9).setValue('Merged'); // Review_Status
      orphanSheet.getRange(merge.rowIndex, 10).setValue(
        `Merged with ${merge.targetKey} on ${isoNow_()}`
      ); // Manual_Notes

      mergedCount++;
      Logger.log(`  ✅ Merge complete`);

    } catch (e) {
      errorCount++;
      Logger.log(`  ❌ Error merging ${merge.orphanKey}: ${e.toString()}`);
      orphanSheet.getRange(merge.rowIndex, 10).setValue(
        `ERROR: ${e.toString()}`
      );
    }
  }

  // Log summary
  persistRunLog_('OrphanMerge', {
    mergedCount: mergedCount,
    interactionsUpdated: interactionsUpdated,
    signalsUpdated: signalsUpdated,
    errors: errorCount,
    runId: isoNow_()
  });

  return {
    mergedCount: mergedCount,
    interactionsUpdated: interactionsUpdated,
    signalsUpdated: signalsUpdated,
    errors: errorCount
  };
}

// Update helpers and menu integration moved to 98b_Orphan_Update_Helpers.gs:
// updateInteractionHistory_, updateSignalsMaster_, deleteOrphanFromHM_,
// addOrphanMergeToMenu_
