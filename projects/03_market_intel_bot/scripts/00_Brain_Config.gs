/**
 * 00_Brain_Config.gs
 * 
 * Central configuration file for the Market Intel Bot.
 * Contains constants, properties retrieval, and core utility functions.
 */

// --- CONSTANTS ---
const CORE_SHEET_ID = "YOUR_SPREADSHEET_ID"; 
const CONFIG_SHEET_NAME = "_CONFIG"; 

// Keys for Script Properties
const GEMINI_API_KEY_PROPERTY = "GEMINI_API_KEY";
const SERPER_API_KEY_PROPERTY = "SERPER_API_KEY";

// Main Configuration Object (Phase 2)
const MI_CONFIG = {
  CORE_SHEET_ID: CORE_SHEET_ID,
  BD_TRACKER_SHEET_ID: 'YOUR_SPREADSHEET_ID',
  CONFIG_SHEET_NAME: CONFIG_SHEET_NAME,
  SERPER_ENDPOINT: 'https://google.serper.dev/search',
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
  SERPER_RESULTS_PER_QUERY: 10,
  BD_EVENTS_SHEET: 'Company_Events',

  // Stock Performance Snapshot
  STOCK_TAB_NAME: '1 Mo stock Performance',
  STOCK_HELPER_TAB: '_STOCK_HELPER',
  STOCK_BATCH_SIZE: 50,
  STOCK_BATCH_DELAY_MS: 5000
};

// --- SETUP FUNCTION ---
/**
 * Run this function ONCE to set your API keys in the script properties.
 * This is safer than hardcoding them in the file.
 */
function setupScriptProperties() {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperties({
    'GEMINI_API_KEY': 'YOUR_GEMINI_KEY_HERE', // REPLACE IF NEEDED OR ALREADY SET
    'SERPER_API_KEY': 'YOUR_SERPER_API_KEY_HERE'
  });
  Logger.log('Script Properties updated. GEMINI and SERPER keys set.');
}

// --- UTILITY FUNCTIONS ---

/**
 * Safely retrieves a script property from the PropertiesService.
 * @param {string} key The key of the property to retrieve.
 * @returns {string} The property value.
 * @throws {Error} If the property is not found.
 * @private
 */
function getScriptProperty_(key) {
  const property = PropertiesService.getScriptProperties().getProperty(key);
  if (!property) {
    throw new Error(`Configuration Error: The required script property '${key}' is not set.`);
  }
  return property;
}

/**
 * Fetches all data from the configuration sheet, following the Batch Operations principle.
 * Expects the data to be in the range A2:lastRow.
 * @returns {any[][]} A two-dimensional array of the configuration data.
 * @private
 */
function getConfigSheetData_() {
  try {
    const spreadsheet = SpreadsheetApp.openById(CORE_SHEET_ID);
    const sheet = spreadsheet.getSheetByName(CONFIG_SHEET_NAME);
    
    if (!sheet) {
      throw new Error(`Sheet Error: Configuration sheet '${CONFIG_SHEET_NAME}' not found.`);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return []; 
    }

    const range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
    return range.getValues();

  } catch (e) {
    Logger.log(`Error in getConfigSheetData_: ${e.message}`);
    throw e; 
  }
}

/**
 * Retrieves the header names from the configuration sheet (Row 1).
 * @returns {string[]} An array of header names.
 * @private
 */
function getHeaders_() {
  try {
    const spreadsheet = SpreadsheetApp.openById(CORE_SHEET_ID);
    const sheet = spreadsheet.getSheetByName(CONFIG_SHEET_NAME);
    
    if (!sheet) {
      throw new Error(`Sheet Error: Configuration sheet '${CONFIG_SHEET_NAME}' not found.`);
    }

    const lastColumn = sheet.getLastColumn();
    return sheet.getRange(1, 1, 1, lastColumn).getValues()[0];

  } catch (e) {
    Logger.log(`Error in getHeaders_: ${e.message}`);
    throw e;
  }
}

/**
 * Creates a mapping of header names to their column index (0-based) for resilient access.
 * @param {string[]} requiredHeaders An array of header names the function requires.
 * @returns {Object<string, number>} A map from header name to column index.
 * @throws {Error} If any required header is missing.
 * @private
 */
function getColumnMapping_(requiredHeaders) {
  const headers = getHeaders_();
  const mapping = {};
  const missingHeaders = [];

  // Create the mapping object
  headers.forEach((header, index) => {
    mapping[header] = index;
  });

  // Verify all required headers are present
  requiredHeaders.forEach(required => {
    if (mapping[required] === undefined) {
      missingHeaders.push(required);
    }
  });

  if (missingHeaders.length > 0) {
    throw new Error(`Schema Error: Missing required headers in '${CONFIG_SHEET_NAME}': ${missingHeaders.join(', ')}`);
  }

  return mapping;
}

/**
 * Parses the configuration sheet data into a structured array of search prompt objects.
 * Supports optional columns (BD Eligible, Validate SoCal) with backward-compatible defaults.
 * @returns {Array<Object>} An array of prompt configuration objects.
 */
function getSearchPromptsConfig() {
  const REQUIRED_HEADERS = ['Task Name', 'Search Queries', 'Sheet Name', 'System Prompt', 'Active', 'LastRun'];
  const OPTIONAL_HEADERS = ['BD Eligible', 'Validate SoCal', 'Serper_TBS', 'Cadence'];

  const data = getConfigSheetData_();

  if (data.length === 0) {
    Logger.log("Config sheet is empty or only contains headers.");
    return [];
  }

  // Get resilient column mapping for required headers
  const col = getColumnMapping_(REQUIRED_HEADERS);

  // Check for optional headers (don't throw if missing)
  const headers = getHeaders_();
  OPTIONAL_HEADERS.forEach(header => {
    const idx = headers.indexOf(header);
    if (idx !== -1) col[header] = idx;
  });

  const prompts = [];

  data.forEach(row => {
    const isActive = String(row[col['Active']]).toUpperCase() === 'TRUE';

    if (isActive) {
      prompts.push({
        taskName: row[col['Task Name']],
        searchQueries: row[col['Search Queries']],
        sheetName: row[col['Sheet Name']],
        systemPrompt: row[col['System Prompt']],
        lastRun: row[col['LastRun']] instanceof Date ? row[col['LastRun']] : null,
        bdEligible: col['BD Eligible'] !== undefined
          ? String(row[col['BD Eligible']]).toUpperCase() === 'TRUE'
          : true,
        validateSoCal: col['Validate SoCal'] !== undefined
          ? String(row[col['Validate SoCal']]).toUpperCase() === 'TRUE'
          : true,
        serperTbs: col['Serper_TBS'] !== undefined
          ? String(row[col['Serper_TBS']] || '').trim()
          : '',
        cadence: col['Cadence'] !== undefined
          ? String(row[col['Cadence']] || '').trim().toLowerCase()
          : ''
      });
    }
  });

  return prompts;
}
