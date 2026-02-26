/**
 * 97a_Bullhorn_Helpers.gs
 * BD TRACKER - Bullhorn Import Support Functions
 * @execution manual
 * Version: 1.0.0
 *
 * CONTAINS:
 * - Orphaned records tab population
 * - CSV reading helper
 * - Name matching helpers (buildNameLookupMap_, buildExistingKeysSet_, generateSimpleKey_)
 * - Data storage helpers (appendToInteractionHistory_)
 * - Utility helpers (formatDate_)
 * - Menu integration (addBullhornImportToMenu_)
 *
 * SPLIT FROM: 97_Bullhorn_Import.gs (lines 301-550)
 * CALLED BY: 97_Bullhorn_Import.gs (processBullhornCSV_, RunOnce_ImportBullhornCSV)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, logError_, getFirstEmptyRowA_, ensureSheetHasRows_)
 */

/** ==========================================================================
 *  ORPHANED RECORDS TAB POPULATION
 *  ========================================================================== */

/**
 * Populate HM_Orphaned_Records tab with records needing review
 * Called automatically after Bullhorn import
 *
 * @param {Array<string>} orphanedKeys - Array of composite keys for orphaned records
 */
function populateOrphanedRecordsTab_(orphanedKeys) {
  if (!orphanedKeys || orphanedKeys.length === 0) return;

  const ss = getSpreadsheet_();
  const hm = ss.getSheetByName(CONFIG.sheetHM);

  // Get or create HM_Orphaned_Records sheet
  let orphanSheet = ss.getSheetByName('HM_Orphaned_Records');
  if (!orphanSheet) {
    orphanSheet = ss.insertSheet('HM_Orphaned_Records');
    orphanSheet.appendRow([
      'Composite_Key', 'HM_Name', 'HM_Title', 'Company', 'Source',
      'Suggested_Match_1', 'Suggested_Match_2', 'Suggested_Match_3',
      'Review_Status', 'Manual_Notes', 'Merge_With_Key'
    ]);
    orphanSheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    orphanSheet.setFrozenRows(1);
  }

  // Read orphaned records from HM_Person_Master
  const hmData = hm.getDataRange().getValues();
  const orphanRows = [];

  for (let i = 1; i < hmData.length; i++) {
    const key = String(hmData[i][0]).trim();
    if (orphanedKeys.includes(key)) {
      orphanRows.push([
        key,                          // A: Composite_Key
        hmData[i][2],                 // B: HM_Name
        hmData[i][3],                 // C: HM_Title
        hmData[i][4],                 // D: Company
        hmData[i][8],                 // E: Source
        '',                           // F: Suggested_Match_1 (filled by match script)
        '',                           // G: Suggested_Match_2
        '',                           // H: Suggested_Match_3
        'Pending',                    // I: Review_Status
        '',                           // J: Manual_Notes
        ''                            // K: Merge_With_Key (filled during review)
      ]);
    }
  }

  // Append to orphan sheet
  if (orphanRows.length > 0) {
    const startRow = orphanSheet.getLastRow() + 1;
    orphanSheet.getRange(startRow, 1, orphanRows.length, 11).setValues(orphanRows);
    Logger.log(`Added ${orphanRows.length} orphaned records to HM_Orphaned_Records`);
  }
}

/** ==========================================================================
 *  CSV READING HELPER
 *  ========================================================================== */

/**
 * Read Bullhorn CSV from permanent import sheet
 * User should paste CSV data into a sheet named "Import_Bullhorn"
 *
 * @returns {Array<Array>} - 2D array of CSV data (skips first 3 header rows)
 */
function readBullhornCSVFromSheet_() {
  const ss = getSpreadsheet_();
  const tempSheet = ss.getSheetByName('Import_Bullhorn');

  if (!tempSheet) {
    throw new Error(
      'Sheet "Import_Bullhorn" not found.\n\n' +
      'Please create a sheet named "Import_Bullhorn" and paste the Bullhorn CSV data there.'
    );
  }

  const lastRow = tempSheet.getLastRow();
  if (lastRow < 4) {
    throw new Error('TEMP_BULLHORN_IMPORT sheet is empty or missing data');
  }

  // Read all data (skip first 3 rows - Bullhorn CSV has header info in rows 1-3)
  const data = tempSheet.getRange(4, 1, lastRow - 3, 8).getValues();

  Logger.log(`Read ${data.length} interaction notes from Import_Bullhorn`);

  return data;
}

/** ==========================================================================
 *  NAME MATCHING HELPERS
 *  ========================================================================== */

/**
 * Build name lookup map from existing HM_Person_Master
 * Maps normalized names to composite keys
 *
 * @param {Sheet} hm - HM_Person_Master sheet
 * @returns {Map} - Map of normalized name → composite key
 */
function buildNameLookupMap_(hm) {
  const hmLastRow = hm.getLastRow();
  const hmData = hmLastRow > 1
    ? hm.getRange(2, 1, hmLastRow - 1, 3).getValues() // A-C: Key, LinkedIn, Name
    : [];

  const nameLookup = new Map();

  for (const row of hmData) {
    const key = String(row[0]).trim();
    const name = String(row[2]).trim();

    if (name) {
      const normalizedName = normalizeName_(name);
      nameLookup.set(normalizedName, key);
    }
  }

  Logger.log(`Built name lookup map with ${nameLookup.size} entries`);

  return nameLookup;
}

/**
 * Build set of existing composite keys from HM_Person_Master
 * Used for collision detection when generating orphan keys (Bug Fix v2.1.1)
 *
 * @param {Sheet} hm - HM_Person_Master sheet
 * @returns {Set} - Set of all existing composite keys
 */
function buildExistingKeysSet_(hm) {
  const hmLastRow = hm.getLastRow();
  const hmData = hmLastRow > 1
    ? hm.getRange(2, 1, hmLastRow - 1, 1).getValues() // Column A: Composite Keys
    : [];

  const existingKeys = new Set();

  for (const row of hmData) {
    const key = String(row[0]).trim();
    if (key) {
      existingKeys.add(key);
    }
  }

  return existingKeys;
}

/**
 * Generate composite key for orphaned records following NO_LI fallback pattern
 * Format: NO_LI-{first}-{last} (per SPEC Law #2)
 * Handles collisions by appending counter suffix (Bug Fix v2.1.1)
 *
 * @param {string} normalizedName - Normalized name (e.g., "joseph malixi")
 * @param {Set} existingKeys - Set of existing composite keys for collision detection
 * @returns {string} - Unique composite key
 */
function generateSimpleKey_(normalizedName, existingKeys) {
  // Split normalized name into parts
  const parts = normalizedName.trim().split(/\s+/);
  const firstName = parts[0] || 'unknown';
  const lastName = parts[parts.length - 1] || 'unknown';

  // Generate NO_LI key pattern (per SPEC Law #2)
  const baseKey = `NO_LI-${firstName}-${lastName}`;
  let key = baseKey;
  let counter = 1;

  // Handle collisions by appending counter
  while (existingKeys.has(key)) {
    key = `${baseKey}-${counter}`;
    counter++;
  }

  return key;
}

/** ==========================================================================
 *  DATA STORAGE HELPERS
 *  ========================================================================== */

/**
 * Append rows to HM_Interaction_History
 * Creates tab if doesn't exist, stores full interaction notes
 *
 * @param {Array<Array>} rows - Array of [Key, Date, Type, Action, Status, Body, Author, Dept, Source]
 * @returns {number} - Number of rows added
 */
function appendToInteractionHistory_(rows) {
  if (!rows || rows.length === 0) return 0;

  const ss = getSpreadsheet_();
  let historySheet = ss.getSheetByName('HM_Interaction_History');

  // Create sheet if doesn't exist
  if (!historySheet) {
    historySheet = ss.insertSheet('HM_Interaction_History');
    historySheet.appendRow([
      'Composite_Key', 'Interaction_Date', 'Type', 'Note_Action', 'Status',
      'Note_Body', 'Note_Author', 'Department', 'Source'
    ]);
    historySheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    historySheet.setFrozenRows(1);
  }

  // Append all rows (no deduplication - full audit trail)
  const startRow = getFirstEmptyRowA_(historySheet);
  ensureSheetHasRows_(historySheet, startRow + rows.length - 1);
  historySheet.getRange(startRow, 1, rows.length, 9).setValues(rows);

  Logger.log(`Added ${rows.length} interaction notes to HM_Interaction_History`);
  return rows.length;
}

/** ==========================================================================
 *  UTILITY HELPERS
 *  ========================================================================== */

/**
 * Format date for consistent display
 *
 * @param {Date|string} date - Date to format
 * @returns {string} - Formatted date string (YYYY-MM-DD)
 */
function formatDate_(date) {
  if (!date) return '';
  if (typeof date === 'string') return date;

  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** ==========================================================================
 *  MENU INTEGRATION
 *  ========================================================================== */

/**
 * Add Bullhorn import to BD Automations menu
 * Call this from Code.gs onOpen() function
 */
function addBullhornImportToMenu_(menu) {
  menu.addSeparator();
  menu.addItem('🔵 IMPORT: Bullhorn Interactions (One-Time)', 'RunOnce_ImportBullhornCSV');
}
