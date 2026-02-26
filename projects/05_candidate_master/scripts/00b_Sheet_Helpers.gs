/**
 * 00b_Sheet_Helpers.gs
 * Sheet operations, column mapping, and logging utilities
 *
 * PURPOSE: All functions that read/write to Google Sheets (non-CSV)
 * DEPENDENCIES: 00a_Config.gs (constants)
 */

/**
 * Get sheet by name with error handling
 * @param {string} sheetName - Name of sheet to get
 * @returns {Sheet} - Sheet object
 */
function getSheetByName(sheetName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in spreadsheet`);
  }

  return sheet;
}

/**
 * Get column mapping for a sheet
 * @param {Sheet} sheet - The sheet object
 * @param {Array<string>} expectedHeaders - Array of expected header names
 * @returns {Object} - Mapping of header names to column indices (0-based)
 */
function getColumnMapping(sheet, expectedHeaders) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const mapping = {};

  for (const header of expectedHeaders) {
    const index = headers.indexOf(header);
    if (index === -1) {
      throw new Error(`Required header "${header}" not found in sheet ${sheet.getName()}`);
    }
    mapping[header] = index;
  }

  return mapping;
}

/**
 * Get column index by header name
 * @param {Sheet} sheet - Sheet object
 * @param {string} headerName - Header to find
 * @returns {number} - 0-based column index
 */
function getColumnIndex(sheet, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const index = headers.indexOf(headerName);
  if (index === -1) {
    throw new Error(`Header "${headerName}" not found in sheet ${sheet.getName()}`);
  }
  return index;
}

/**
 * Build UID lookup map from Candidate_Master
 * @param {string} keyField - Field to use as lookup key ('UID', 'LinkedIn_URL', 'Email')
 * @returns {Object} - Map of key -> row data object
 */
function buildCandidateLookupMap(keyField = 'UID') {
  const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIndex = headers.indexOf(keyField);

  if (keyIndex === -1) {
    throw new Error(`Key field "${keyField}" not found in headers`);
  }

  const lookupMap = {};

  for (let i = 1; i < data.length; i++) {
    const key = data[i][keyIndex];
    if (!key) continue; // Skip empty keys

    // Build row object with all fields
    const rowData = { _rowNum: i + 1 }; // Store 1-indexed row number
    headers.forEach((header, colIndex) => {
      rowData[header] = data[i][colIndex];
    });

    lookupMap[key] = rowData;
  }

  return lookupMap;
}

/**
 * Log error to ErrorLog tab (creates if doesn't exist)
 * @param {string} errorCode - Error identifier
 * @param {string} message - Error message
 * @param {string} context - Where error occurred
 */
function logError(errorCode, message, context) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let errorLog = ss.getSheetByName(TAB_ERROR_LOG);

    if (!errorLog) {
      errorLog = ss.insertSheet(TAB_ERROR_LOG);
      errorLog.appendRow(["Timestamp", "Error_Code", "Message", "Context"]);
    }

    errorLog.appendRow([new Date(), errorCode, message, context]);
    Logger.log(`ERROR logged: ${errorCode} - ${message} (${context})`);
  } catch (e) {
    Logger.log(`Failed to log error: ${e.toString()}`);
  }
}

/**
 * Generate a stamped string for Last_Import or Last_Enrichment columns
 * Format: "{PREFIX} DD.MM.YYYY HH:MM"
 * @param {string} prefix - Import type prefix (e.g., IMPORT_PREFIX_BH_NOTES, "Gemini")
 * @returns {string} - Formatted stamp like "BHNotes 08.02.2026 09:04"
 */
function generateStamp(prefix) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${prefix} ${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

/**
 * Parse a stamp string back to a Date object for comparison
 * Handles format: "{PREFIX} DD.MM.YYYY HH:MM"
 * @param {string} stamp - Stamp string
 * @returns {Date} - Parsed date, or epoch (1970) if unparseable
 */
function parseStamp(stamp) {
  if (!stamp) return new Date(0);
  const str = String(stamp).trim();

  // Match "PREFIX DD.MM.YYYY HH:MM"
  const match = str.match(/\S+\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return new Date(0);

  const day = parseInt(match[1]);
  const month = parseInt(match[2]) - 1; // 0-indexed
  const year = parseInt(match[3]);
  const hours = parseInt(match[4]);
  const minutes = parseInt(match[5]);

  return new Date(year, month, day, hours, minutes);
}

/**
 * Log import activity to Import_Log tab
 * @param {string} importType - Type of import (e.g., "Bullhorn Notes", "LinkedIn Connections")
 * @param {string} fileName - Name of file imported (or "Multiple files")
 * @param {number} recordsProcessed - Number of records/notes processed
 * @param {number} candidatesAffected - Number of candidates inserted/updated
 * @param {string} status - "Success" or "Failed"
 * @param {string} notes - Optional notes about the import
 */
function logImport(importType, fileName, recordsProcessed, candidatesAffected, status, notes = '') {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let importLog = ss.getSheetByName(TAB_IMPORT_LOG);

    if (!importLog) {
      importLog = ss.insertSheet(TAB_IMPORT_LOG);
      importLog.appendRow([
        "Timestamp",
        "Import_Type",
        "File_Name",
        "Records_Processed",
        "Candidates_Affected",
        "Status",
        "Notes"
      ]);
      // Format header row
      const headerRange = importLog.getRange(1, 1, 1, 7);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#f3f3f3");
    }

    importLog.appendRow([
      new Date(),
      importType,
      fileName,
      recordsProcessed,
      candidatesAffected,
      status,
      notes
    ]);

    Logger.log(`IMPORT logged: ${importType} - ${fileName} - ${status}`);
  } catch (e) {
    Logger.log(`Failed to log import: ${e.toString()}`);
  }
}
