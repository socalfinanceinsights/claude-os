/**
 * 98b_Orphan_Update_Helpers.gs
 * BD TRACKER - Orphan Merge Update Helpers & Menu Integration
 * @execution manual
 * Version: 1.0.0
 *
 * CONTAINS:
 * - updateInteractionHistory_: Replace orphan key in HM_Interaction_History
 * - updateSignalsMaster_: Replace orphan key in HM_Signals_Master
 * - deleteOrphanFromHM_: Delete orphan row from HM_Person_Master
 * - addOrphanMergeToMenu_: Menu integration
 *
 * SPLIT FROM: 98_Orphan_Merge_Cleanup.gs (lines 239-337)
 * CALLED BY: 98_Orphan_Merge_Cleanup.gs (processMerges_)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG)
 */

/** ==========================================================================
 *  UPDATE HELPERS
 *  ========================================================================== */

/**
 * Update HM_Interaction_History — replace orphan key with target key
 *
 * @param {string} orphanKey - Old composite key (orphan)
 * @param {string} targetKey - New composite key (merge target)
 * @returns {number} - Number of rows updated
 */
function updateInteractionHistory_(orphanKey, targetKey) {
  const ss = getSpreadsheet_();
  const historySheet = ss.getSheetByName('HM_Interaction_History');

  if (!historySheet) return 0;

  const lastRow = historySheet.getLastRow();
  if (lastRow < 2) return 0;

  const data = historySheet.getRange(2, 1, lastRow - 1, 1).getValues(); // Column A only
  let updateCount = 0;

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === orphanKey) {
      historySheet.getRange(i + 2, 1).setValue(targetKey);
      updateCount++;
    }
  }

  return updateCount;
}

/**
 * Update HM_Signals_Master — replace orphan key with target key
 *
 * @param {string} orphanKey - Old composite key (orphan)
 * @param {string} targetKey - New composite key (merge target)
 * @returns {number} - Number of rows updated
 */
function updateSignalsMaster_(orphanKey, targetKey) {
  const ss = getSpreadsheet_();
  const signalsSheet = ss.getSheetByName(CONFIG.sheetSignals || 'HM_Signals_Master');

  if (!signalsSheet) return 0;

  const lastRow = signalsSheet.getLastRow();
  if (lastRow < 2) return 0;

  const data = signalsSheet.getRange(2, 1, lastRow - 1, 1).getValues(); // Column A only
  let updateCount = 0;

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === orphanKey) {
      signalsSheet.getRange(i + 2, 1).setValue(targetKey);
      updateCount++;
    }
  }

  return updateCount;
}

/**
 * Delete orphan row from HM_Person_Master
 * Searches from bottom up to avoid index shifting on multi-delete
 *
 * @param {Sheet} hm - HM_Person_Master sheet
 * @param {string} orphanKey - Composite key to delete
 */
function deleteOrphanFromHM_(hm, orphanKey) {
  const lastRow = hm.getLastRow();
  if (lastRow < 2) return;

  const data = hm.getRange(2, 1, lastRow - 1, 1).getValues(); // Column A only

  // Search from bottom up to avoid index shifting
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]).trim() === orphanKey) {
      hm.deleteRow(i + 2); // Convert to sheet row number
      Logger.log(`Deleted row ${i + 2} from HM_Person_Master (${orphanKey})`);
      return;
    }
  }

  Logger.log(`Warning: Orphan key ${orphanKey} not found in HM_Person_Master`);
}

/** ==========================================================================
 *  MENU INTEGRATION
 *  ========================================================================== */

/**
 * Add orphan merge to BD Automations menu
 * Call this from Code.gs onOpen() function
 */
function addOrphanMergeToMenu_(menu) {
  menu.addSeparator();
  menu.addItem('🔄 MERGE: Orphaned Records (After Review)', 'RunOnce_MergeOrphans');
}
