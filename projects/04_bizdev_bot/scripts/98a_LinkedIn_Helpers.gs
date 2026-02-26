/**
 * 98a_LinkedIn_Helpers.gs
 * BD TRACKER - LinkedIn Import Support Functions
 * @execution manual
 * Version: 1.0.0
 *
 * CONTAINS:
 * - CSV reading helpers (sheet + Drive)
 * - Title filtering (isManagerOrAbove_)
 * - Signals update helper (updateLinkedInSignals_)
 * - Job change tracking (appendToJobChangeLog_)
 * - Menu integration (addLinkedInImportToMenu_)
 *
 * SPLIT FROM: 98_LinkedIn_Import.gs (lines 430-673)
 * CALLED BY: 98_LinkedIn_Import.gs (processLinkedInCSV_, RunOnce_ImportLinkedInCSV)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, getFirstEmptyRowA_, ensureSheetHasRows_)
 */

/** ==========================================================================
 *  CSV READING HELPERS
 *  ========================================================================== */

/**
 * Read LinkedIn CSV from permanent import sheet
 * User should paste CSV data into a sheet named "Import_LinkedIn"
 *
 * @returns {Array<Array>} - 2D array of CSV data (skips header row)
 */
function readLinkedInCSVFromSheet_() {
  const ss = getSpreadsheet_();
  const tempSheet = ss.getSheetByName('Import_LinkedIn');

  if (!tempSheet) {
    throw new Error(
      'Sheet "Import_LinkedIn" not found.\n\n' +
      'Please create a sheet named "Import_LinkedIn" and paste the LinkedIn CSV data there.'
    );
  }

  const lastRow = tempSheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('Import_LinkedIn sheet is empty or missing data');
  }

  // Read all data (skip header row)
  const data = tempSheet.getRange(2, 1, lastRow - 1, 7).getValues();

  Logger.log(`Read ${data.length} rows from Import_LinkedIn`);

  return data;
}

/**
 * ALTERNATIVE: Read LinkedIn CSV from Google Drive
 * Upload CSV to Drive, get file ID, and update below
 *
 * @returns {Array<Array>} - 2D array of CSV data
 */
function readLinkedInCSVFromDrive_() {
  // Replace with actual file ID from Google Drive
  const fileId = 'YOUR_GOOGLE_DRIVE_FILE_ID_HERE';

  try {
    const file = DriveApp.getFileById(fileId);
    const csvContent = file.getBlob().getDataAsString();
    const csvData = Utilities.parseCsv(csvContent);

    // Skip header row
    return csvData.slice(1);

  } catch (e) {
    Logger.log(`Error reading CSV from Drive: ${e.toString()}`);
    throw new Error(
      'Could not read LinkedIn CSV from Drive.\n\n' +
      'Please upload CSV to Google Drive and update fileId in readLinkedInCSVFromDrive_()\n' +
      'OR paste CSV into Import_LinkedIn sheet and use readLinkedInCSVFromSheet_() instead'
    );
  }
}

/** ==========================================================================
 *  TITLE FILTERING
 *  ========================================================================== */

/**
 * Check if title is Manager level or above
 * Conservative filter — only includes clear Manager+ titles
 *
 * INCLUDES: Manager, Controller, Director, VP, President, C-Suite, Partner, Principal, Head of
 * EXCLUDES: Staff/Senior Accountant, Analyst, Associate, Consultant, Advisor, blank titles
 *
 * @param {string} title - Job title from LinkedIn
 * @returns {boolean} - True if Manager+ level
 */
function isManagerOrAbove_(title) {
  if (!title || String(title).trim() === '') return false;

  const titleLower = String(title).toLowerCase().trim();

  if (titleLower.includes('manager')) return true;
  if (titleLower.includes('controller')) return true;
  if (titleLower.includes('director')) return true;
  if (titleLower.includes('vp') || titleLower.includes('v.p.')) return true;
  if (titleLower.includes('vice president')) return true;
  if (titleLower.includes('president') && !titleLower.includes('vice')) return true;
  if (titleLower.includes('cfo') || titleLower.includes('chief financial')) return true;
  if (titleLower.includes('cao') || titleLower.includes('chief accounting')) return true;
  if (titleLower.includes('ceo') || titleLower.includes('chief executive')) return true;
  if (titleLower.includes('coo') || titleLower.includes('chief operating')) return true;
  if (titleLower.includes('cto') || titleLower.includes('chief technology')) return true;
  if (titleLower.includes('cio') || titleLower.includes('chief information')) return true;
  if (titleLower.includes('cmo') || titleLower.includes('chief marketing')) return true;
  if (titleLower.match(/\bc[a-z]o\b/)) return true; // Match other CXO patterns
  if (titleLower.includes('chief')) return true;     // Catch any other Chief titles
  if (titleLower.includes('partner')) return true;
  if (titleLower.includes('principal')) return true;
  if (titleLower.includes('head of')) return true;

  return false;
}

/** ==========================================================================
 *  SIGNALS HELPER
 *  ========================================================================== */

/**
 * Update HM_Signals_Master column G (1st-Degree) for LinkedIn connections
 * Assumes HM_Signals_Master is already seeded with composite keys in column A
 *
 * @param {Array<string>} keys - Array of composite keys to mark as 1st-degree
 * @returns {number} - Number of rows updated
 */
function updateLinkedInSignals_(keys) {
  if (!keys || keys.length === 0) return 0;

  const ss = getSpreadsheet_();
  const signalsSheet = ss.getSheetByName(CONFIG.sheetSignals || 'HM_Signals_Master');

  if (!signalsSheet) {
    Logger.log('Warning: HM_Signals_Master not found. Auto-seed may not have run.');
    return 0;
  }

  const lastRow = signalsSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('Warning: HM_Signals_Master has no data rows.');
    return 0;
  }

  const allKeys = signalsSheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();

  const keyToRow = new Map();
  allKeys.forEach((key, index) => {
    if (key) keyToRow.set(String(key).trim(), index + 2); // +2 for header and 0-index
  });

  const rowsToUpdate = [];
  for (const key of keys) {
    const row = keyToRow.get(String(key).trim());
    if (row) {
      rowsToUpdate.push(row);
    }
  }

  if (rowsToUpdate.length === 0) {
    Logger.log('Warning: No matching keys found in HM_Signals_Master.');
    return 0;
  }

  for (const row of rowsToUpdate) {
    signalsSheet.getRange(row, 7).setValue('Yes'); // Column G = 7
  }

  Logger.log(`Updated ${rowsToUpdate.length} rows in HM_Signals_Master (1st-Degree = Yes)`);
  return rowsToUpdate.length;
}

/** ==========================================================================
 *  JOB CHANGE TRACKING
 *  ========================================================================== */

/**
 * Append job changes to HM_Job_Change_Log
 * Creates tab if doesn't exist, logs Title and Company changes
 *
 * @param {Array<Object>} changes - Array of {key, oldTitle, newTitle, oldCompany, newCompany, changeDate, source}
 * @returns {number} - Number of changes logged
 */
function appendToJobChangeLog_(changes) {
  if (!changes || changes.length === 0) return 0;

  const ss = getSpreadsheet_();
  let logSheet = ss.getSheetByName('HM_Job_Change_Log');

  if (!logSheet) {
    logSheet = ss.insertSheet('HM_Job_Change_Log');
    logSheet.appendRow([
      'Composite_Key', 'Old_Title', 'New_Title', 'Old_Company', 'New_Company',
      'Change_Date', 'Source'
    ]);
    logSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    logSheet.setFrozenRows(1);
  }

  const rows = changes.map(c => [
    c.key,
    c.oldTitle,
    c.newTitle,
    c.oldCompany,
    c.newCompany,
    c.changeDate,
    c.source
  ]);

  const startRow = getFirstEmptyRowA_(logSheet);
  ensureSheetHasRows_(logSheet, startRow + rows.length - 1);
  logSheet.getRange(startRow, 1, rows.length, 7).setValues(rows);

  Logger.log(`Added ${rows.length} job changes to HM_Job_Change_Log`);
  return rows.length;
}

/** ==========================================================================
 *  MENU INTEGRATION
 *  ========================================================================== */

/**
 * Add LinkedIn import to BD Automations menu
 * Call this from Code.gs onOpen() function
 */
function addLinkedInImportToMenu_(menu) {
  menu.addSeparator();
  menu.addItem('🔵 IMPORT: LinkedIn Connections', 'RunOnce_ImportLinkedInCSV');
}
