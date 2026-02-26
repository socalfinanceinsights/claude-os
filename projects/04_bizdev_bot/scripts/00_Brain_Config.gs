/**
 * Simple test function for clasp run verification
 */
function testClaspRun() {
  return "clasp run works - 04_BizDev_Bot";
}

/** @const — BizDev Tracker spreadsheet ID. Single source of truth for all script access. */
const SPREADSHEET_ID_ = "YOUR_SPREADSHEET_ID";

/**
 * Returns the BizDev spreadsheet.
 * Works in both UI (menu/trigger) and headless (Execution API / clasp run) contexts.
 * Use this everywhere instead of getSpreadsheet_().
 */
function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID_);
}

/**
 * BD TRACKER - BRAIN CONFIG
 * Version: 2.0.0 (Refactored)
 *
 * CONTAINS:
 * - Configuration constants
 * - Shared utility functions (The "Laws")
 * - Logging system
 * - Column mapping helpers
 */

/** ==========================================================================
 *  CONFIGURATION CONSTANTS
 *  ========================================================================== */

const CONFIG = {
  // Sheet Names
  sheetBD: 'BD_Contacts',
  sheetHM: 'HM_Person_Master',
  sheetSignals: 'HM_Signals_Master',
  sheetCompany: 'Company_Master',
  sheetLusha: 'LushaContactInserts',
  sheetCrunchbase: 'Import CB',
  sheetContactInfo: 'HM_ContactInfo',
  sheetQA: 'QA_LandingHeaders',
  sheetLogs: 'Run_Logs',
  sheetErrorLog: 'ErrorLog',
  sheetCampaigns: 'BD_Campaigns',
  sheetCampaignSteps: 'BD_Campaign_Steps',
  sheetCampaignDrafts: 'Campaign_Drafts',
  sheetTemplateBank: 'Template_Bank',
  sheetEvents: 'Company_Events',
  sheetBehavioral: 'Company_Behavioral_Score',
  sheetICPScore: 'ICP_Score',
  sheetPromptConfig: 'Prompt_Config',
  sheetCadenceConfig: 'Cadence_Config',
  sheetSizeRevenueNorm: 'Size_Revenue_Normalization',
  sheetLushaCompany: 'LushaCompanyInserts',

  // Timezone
  timezone: 'America/Los_Angeles',

  // Gemini
  geminiModel: 'gemini-3-flash-preview',

  // System Settings
  defaultIdentityRows: 10000,
  batchSize: 50, // Conservative batch size to avoid timeouts

  // Column Mappings (HM_Person_Master A-J)
  hmPersonCols: {
    key: 0,              // A: Composite Key
    linkedin: 1,         // B: LinkedIn URL
    name: 2,             // C: HM Name
    title: 3,            // D: HM Title
    company: 4,          // E: Company
    domain: 5,           // F: Company Domain
    primaryEmail: 6,     // G: Primary_Email (NEW v2.1)
    primaryPhone: 7,     // H: Primary_Phone (NEW v2.1)
    originalSource: 8,   // I: Original_Source (NEW v2.1)
    originalSourceDate: 9,    // J: Original_Source_Date (NEW v2.1)
    // K: Active Campaign ID (view) - formula/manual, not in config
    // L: Dedup_Status - populated by 96_HM_Dedup
    lastUpdateSource: 12,    // M: Last_Update_Source (v2.2) - source of most recent update
    lastUpdateDate: 13,     // N: Last_Update_Date (v2.2) - timestamp of most recent update
    secondaryPhone: 14,     // O: Secondary_Phone (v3.0 Enrichment Blitz)
    lastEnrichment: 15      // P: Last_Enrichment (v3.0 Enrichment Blitz)
  },

  // Column Mappings (HM_ContactInfo A-G)
  contactInfoCols: {
    key: 0,              // A: Composite_Key
    channelType: 1,      // B: Channel_Type
    channelValue: 2,     // C: Channel_Value
    companyDomain: 3,    // D: Company_Domain_at_Time
    sourceSystem: 4,     // E: Source_System
    lastSeen: 5,         // F: Last_Seen
    notes: 6             // G: Notes
  },

  // Column Mappings (BD_Contacts A-AE, 0-indexed)
  bdContactCols: {
    compositeKey: 0,    // A: Composite_Key
    linkedinUrl: 1,     // B: LinkedIn_URL
    firstDegree: 2,     // C: 1st_Degree
    hmName: 3,          // D: HM_Name
    hmTitle: 4,         // E: HM_Title
    company: 5,         // F: Company
    companyDomain: 6,   // G: Company_Domain
    industry: 8,        // I: Industry
    region: 9,          // J: Region
    primaryEmail: 10,   // K: Primary_Email
    primaryPhone: 11,   // L: Primary_Phone
    secondaryPhone: 12, // M: Secondary_Phone
    initialOutreachDate: 13, // N: Initial_Outreach_Date
    outreachStage: 14,  // O: Outreach_Stage
    lastContact: 15,    // P: Last_Contact
    responseStatus: 19, // T: Response_Status
    campaignId: 25,     // Z: Campaign_ID
    campaignStepNo: 26  // AA: Campaign_Step_No
  },

  // Column Mappings (Campaign_Drafts A-Q, 0-indexed)
  campaignDraftsCols: {
    campaignId: 0,
    hmCompositeKey: 1,
    hmName: 2,
    touchNo: 3,
    channel: 4,
    toEmail: 5,
    subject: 6,
    body: 7,
    cta: 8,
    linkedinUrl: 9,
    phoneNumber: 10,
    dateGenerated: 11,
    dateSent: 12,
    response: 13,
    variantId: 14,
    displayLabel: 15,
    vmBriefingCard: 16
  }
};

// Lusha Upsert: only overwrite existing HM records if last update is older than this
const LUSHA_UPSERT_STALE_DAYS = 90;

// Lusha Import Configuration
const LUSHA_CFG = {
  sheetName: CONFIG.sheetLusha,
  headerRow: 1,
  firstDataRow: 2,

  // Operational columns (BL-BP in Excel, 62-66 in 0-indexed)
  ops: {
    runId: 61,      // Column BL (62nd column, 0-indexed = 61)
    source: 62,     // Column BM
    processed: 63,  // Column BN
    errFlag: 64,    // Column BO
    errNotes: 65    // Column BP
  },

  // Data column indices (0-indexed)
  cols: {
    firstName: 2,   // C
    lastName: 3,    // D
    email: 4,       // E: Work Email
    directEmail: 6,        // G: Direct Email
    additionalEmail1: 8,   // I: Additional Email 1
    additionalEmail2: 10,  // K: Additional Email 2
    phone1: 12,            // M: Phone 1
    phone1Type: 13,        // N: Phone 1 Type
    phone2: 14,            // O: Phone 2
    phone2Type: 15,        // P: Phone 2 Type
    title: 16,      // Q
    linkedIn: 19,   // T
    companyName: 26,    // AA
    companyDomain: 27,  // AB
    companyWebsite: 30, // AE
    companyLinkedIn: 33, // AH
    companyCity: 50,     // AZ (Company City)
    companyState: 49,    // AY (Company State)
    companyCountry: 48,  // AW (Company Country)
    industry: 41,        // AP
    subIndustry: 42,     // AQ
    companySize: 31,     // AF
    companyRevenue: 32   // AG
  },

  hmSheet: CONFIG.sheetHM,
  coSheet: CONFIG.sheetCompany,
  qaSheet: CONFIG.sheetQA,

  // Expected header validation (56 columns)
  expectedHeaders: [
    'Date','User','First Name','Last Name','Work Email','Work Email Confidence','Direct Email','Direct Email Confidence',
    'Additional Email 1','Additional Email 1 Confidence','Additional Email 2','Additional Email 2 Confidence',
    'Phone 1','Phone 1 Type','Phone 2','Phone 2 Type','Job Title','Seniority','Departments','LinkedIn URL',
    'Continent','Country','State','City','Country ISO','Tags','Company Name','Company Domain','Company Description',
    'Company Year Founded','Company Website','Company Number of Employees','Company Revenue','Company LinkedIn URL',
    'Total Funding Amount','Total Number of Rounds','Last Round/Event Amount','Last Round/Event Type','Last Round/Event Date',
    'IPO Status','IPO Date','Company Main Industry','Company Sub Industry','Company Technologies','Company SIC (Standard Industrial Classification)',
    'Company NAIC (North American Industry Classification)','Company Specialties','Company Continent','Company Country','Company State',
    'Company City','Company Country ISO','Company Number of Intent Topics','Company Intent Topics','Company Intent Level','Topic Count Trend'
  ]
};

// Crunchbase Import Configuration
const CRUNCHBASE_CFG = {
  sheetName: CONFIG.sheetCrunchbase,
  headerRow: 1,
  firstDataRow: 2,

  // Operational columns (U-Y, 21-25 in 1-indexed, 20-24 in 0-indexed)
  ops: {
    runId: 20,      // Column U
    source: 21,     // Column V
    processed: 22,  // Column W
    errFlag: 23,    // Column X
    errNotes: 24    // Column Y
  },

  // Data column indices (0-indexed)
  cols: {
    orgName: 0,           // A
    linkedIn: 1,          // B
    website: 2,           // C
    industryGroups: 3,    // D
    industries: 4,        // E
    hqLocation: 5,        // F
    numEmployees: 6,      // G
    revenueRange: 7,      // H
    numRounds: 8,         // I
    foundedDate: 9,       // J
    lastFundingType: 10,  // K
    lastFundingDate: 11,  // L
    lastFundingAmount: 12, // M
    stockSymbol: 13,      // N
    stockUrl: 14          // O
  },

  coSheet: CONFIG.sheetCompany,
  qaSheet: CONFIG.sheetQA,

  // Expected headers (14 columns)
  expectedHeaders: [
    'Organization Name','LinkedIn','Website','Industry Groups','Industries','Headquarters Location',
    'Number of Employees','Estimated Revenue Range','Number of Funding Rounds_CB','Founded Date',
    'Last Funding Type_CB','Last Funding Date_CB','Last Funding Amount_CB','Stock Symbol','Stock Symbol URL'
  ]
};

// Lusha Company Import Configuration
const LUSHA_COMPANY_CFG = {
  sheetName: CONFIG.sheetLushaCompany,
  headerRow: 1,
  firstDataRow: 2,

  // Operational columns (will be added after data columns)
  ops: {
    runId: 30,      // Column AE (31st column, 0-indexed = 30)
    source: 31,     // Column AF
    processed: 32,  // Column AG
    errFlag: 33,    // Column AH
    errNotes: 34    // Column AI
  },

  // Data column indices (0-indexed, matching Lusha Company export)
  cols: {
    companyName: 0,           // A: Company Name
    companyDomain: 1,         // B: Company Domain
    companyDescription: 2,    // C: Company Description
    yearFounded: 3,           // D: Company Year Founded
    companyWebsite: 4,        // E: Company Website
    numEmployees: 5,          // F: Company Number of Employees
    revenue: 6,               // G: Company Revenue
    linkedIn: 7,              // H: Company linkedin URL
    totalFundingAmount: 8,    // I: Total Funding Amount
    totalRounds: 9,           // J: Total Number of Rounds
    lastRoundAmount: 10,      // K: Last Round/Event Amount
    lastRoundType: 11,        // L: Last Round/Event Type
    lastRoundDate: 12,        // M: Last Round/Event Date
    ipoStatus: 13,            // N: IPO Status
    ipoDate: 14,              // O: IPO Date
    mainIndustry: 15,         // P: Company Main Industry
    subIndustry: 16,          // Q: Company Sub Industry
    technologies: 17,         // R: Company Technologies
    sic: 18,                  // S: Company SIC
    naic: 19,                 // T: Company NAIC
    specialties: 20,          // U: Company Specialties
    continent: 21,            // V: Company Continent
    country: 22,              // W: Company Country
    state: 23,                // X: Company State
    city: 24,                 // Y: Company City
    countryISO: 25            // Z: Company Country ISO
    // Columns AA-AD (26-29): Intent data (premium, always empty) - skip
  },

  coSheet: CONFIG.sheetCompany,
  qaSheet: CONFIG.sheetQA,

  // Expected headers (30 columns total, but only 26 usable)
  expectedHeaders: [
    'Company Name','Company Domain','Company Description','Company Year Founded','Company Website',
    'Company Number of Employees','Company Revenue','Company linkedin URL','Total Funding Amount',
    'Total Number of Rounds','Last Round/Event Amount','Last Round/Event Type','Last Round/Event Date',
    'IPO Status','IPO Date','Company Main Industry','Company Sub Industry','Company Technologies',
    'Company SIC (Standard Industrial Classification)','Company NAIC (North American Industry Classification)',
    'Company Specialties','Company Continent','Company Country','Company State','Company City',
    'Company Country ISO','Company Number of Intent Topics','Company Intent Topics','Company Intent Level','Topic Count Trend'
  ]
};

/** ==========================================================================
 *  SHARED UTILITY FUNCTIONS (THE "LAWS")
 *  ========================================================================== */

/**
 * LAW #1: Anti-getLastRow()
 * Finds the first truly empty row in Column A by scanning values.
 * Ignores pre-filled formulas that return "".
 *
 * @param {Sheet} sheet - The sheet to scan
 * @returns {number} - Row number of first empty row (1-indexed)
 */
function getFirstEmptyRowA_(sheet) {
  const maxRows = sheet.getMaxRows();
  if (maxRows <= 1) return 2;

  // Read Col A (skip header row 1)
  const vals = sheet.getRange(2, 1, maxRows - 1, 1).getValues();

  for (let i = 0; i < vals.length; i++) {
    const v = vals[i][0];
    if (v === undefined || v === null || String(v).trim() === '') {
      return 2 + i; // Return absolute row number
    }
  }

  return maxRows + 1;
}

/**
 * Ensure sheet has enough rows
 * @param {Sheet} sheet - The sheet to expand
 * @param {number} requiredRows - Minimum number of rows needed
 */
function ensureSheetHasRows_(sheet, requiredRows) {
  const current = sheet.getMaxRows();
  if (current < requiredRows) {
    sheet.insertRowsAfter(current, requiredRows - current);
  }
}

/**
 * Ensure sheet has enough columns
 * @param {Sheet} sheet - The sheet to expand
 * @param {number} requiredCols - Minimum number of columns needed
 */
function ensureSheetHasCols_(sheet, requiredCols) {
  const current = sheet.getMaxColumns();
  if (current < requiredCols) {
    sheet.insertColumnsAfter(current, requiredCols - current);
  }
}

/**
 * Get current timestamp in ISO 8601 UTC format
 * @returns {string} - ISO timestamp
 */
function isoNow_() {
  return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/**
 * Check if a record's last update date is older than a threshold
 * Returns true if blank, invalid, or older than staleDays
 *
 * @param {*} lastUpdateDate - Date value from sheet (string, Date, or blank)
 * @param {number} staleDays - Number of days before a record is considered stale
 * @returns {boolean}
 */
function isStaleRecord_(lastUpdateDate, staleDays) {
  if (!lastUpdateDate) return true;
  const date = new Date(lastUpdateDate);
  if (isNaN(date.getTime())) return true;
  const diffDays = (new Date() - date) / (1000 * 60 * 60 * 24);
  return diffDays >= staleDays;
}

/**
 * Clean LinkedIn URL to standard format
 * Extracts slug and returns canonical URL
 * @param {string} url - Raw LinkedIn URL
 * @returns {string} - Cleaned LinkedIn URL or original if no match
 */
function cleanLinkedInUrl_(url) {
  if (!url || !url.includes('/in/')) return url;

  const match = url.match(/\/in\/([^\/\?]+)/);
  if (!match) return url;

  return `https://www.linkedin.com/in/${match[1]}/`;
}

/**
 * Clean domain to root domain format
 * Removes protocol, www, and path
 * @param {string} domain - Raw domain/URL
 * @returns {string} - Cleaned root domain (e.g., "acme.com")
 */
function cleanDomain_(domain) {
  if (!domain) return '';

  return String(domain)
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .split('/')[0]
    .trim();
}

/**
 * Generate composite key for a person
 * Primary: LinkedIn slug
 * Fallback: NO_LI-{first}-{last}-{domain}
 *
 * @param {string} linkedInUrl - LinkedIn URL (optional)
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @param {string} domain - Company domain
 * @returns {string} - Composite key
 */
function generatePersonKey_(linkedInUrl, firstName, lastName, domain) {
  if (linkedInUrl && linkedInUrl.includes('/in/')) {
    const match = linkedInUrl.match(/\/in\/([^\/\?]+)/);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  // Fallback: NO_LI-{first}-{last}-{domain}
  const cleanFirst = String(firstName || '').replace(/\s+/g, '').toLowerCase();
  const cleanLast = String(lastName || '').replace(/\s+/g, '').toLowerCase();
  const cleanDom = String(domain || '').replace(/\s+/g, '').toLowerCase();

  return `NO_LI-${cleanFirst}-${cleanLast}-${cleanDom}`;
}

/**
 * Fix date-converted company size strings
 * Converts "Nov-50" back to "11-50", "Jan-10" back to "1-10", etc.
 *
 * @param {string} sizeStr - Size string (potentially date-converted)
 * @returns {string} - Fixed size string
 */
function fixDateConvertedSize_(sizeStr) {
  if (!sizeStr) return '';

  const str = String(sizeStr).trim();

  // Month name to number mapping
  const monthMap = {
    'Jan': '1', 'Feb': '2', 'Mar': '3', 'Apr': '4', 'May': '5', 'Jun': '6',
    'Jul': '7', 'Aug': '8', 'Sep': '9', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };

  // Match patterns like "Nov-50" or "Jan-10"
  const match = str.match(/^([A-Z][a-z]{2})-(\d+)$/);
  if (match && monthMap[match[1]]) {
    return monthMap[match[1]] + '-' + match[2]; // Convert "Nov-50" → "11-50"
  }

  // If it's a full date object string, try to extract range from it
  if (str.includes('GMT')) {
    // Can't reliably recover from full date conversion - return empty
    return '';
  }

  return str;
}

/** ==========================================================================
 *  LOGGING SYSTEM
 *  ========================================================================== */

/**
 * Persist run log to Run_Logs sheet AND ScriptProperties
 * Dual persistence for both human audit and programmatic recovery
 *
 * @param {string} action - Action name (e.g., "LushaImport")
 * @param {Object} data - Data to log (will be JSON stringified)
 */
function persistRunLog_(action, data) {
  try {
    const ss = getSpreadsheet_();
    let logSheet = ss.getSheetByName(CONFIG.sheetLogs);

    // Create Log sheet if missing
    if (!logSheet) {
      logSheet = ss.insertSheet(CONFIG.sheetLogs);
      logSheet.appendRow(['Timestamp', 'User', 'Action', 'Run_ID', 'JSON_Data']);
    }

    let user = 'unknown';
    try { user = Session.getActiveUser().getEmail() || 'system'; } catch (e) { user = 'system'; }
    const ts = isoNow_();
    const runId = data.runId || `run_${Date.now()}`;
    const json = JSON.stringify(data);

    // Append to sheet
    logSheet.appendRow([ts, user, action, runId, json]);

    // Save to Properties for programmatic access
    PropertiesService.getScriptProperties().setProperty(`LAST_RUN_${action}`, json);

  } catch (e) {
    Logger.log(`Failed to persist log for ${action}: ${e.toString()}`);
  }
}

/**
 * Log error to ErrorLog sheet with structured format
 *
 * @param {string} sourceId - Source identifier (e.g., "LUSHA_IMPORT")
 * @param {string} errorCode - Error code (e.g., "HEADER_MISMATCH")
 * @param {string} sourceTitle - Human-readable title
 * @param {string} errorDefinition - Error details
 */
function logError_(sourceId, errorCode, sourceTitle, errorDefinition) {
  try {
    const ss = getSpreadsheet_();
    let errorSheet = ss.getSheetByName(CONFIG.sheetErrorLog);

    // Create ErrorLog sheet if missing
    if (!errorSheet) {
      errorSheet = ss.insertSheet(CONFIG.sheetErrorLog);
      errorSheet.appendRow(['DateLog', 'SourceID', 'ErrorCode', 'SourceTitle', 'ErrorDefinition', 'Resolved?', 'Resolution_Notes']);
    }

    const dateLog = isoNow_();

    errorSheet.appendRow([dateLog, sourceId, errorCode, sourceTitle, errorDefinition, '', '']);

    Logger.log(`ERROR logged: ${errorCode} - ${sourceTitle}`);

  } catch (e) {
    Logger.log(`Failed to log error: ${e.toString()}`);
  }
}

/** ==========================================================================
 *  INDUSTRY NORMALIZATION LOGGING (Bug #8, #9 Fix)
 *  ========================================================================== */

/**
 * Log industry data to Industry_Normalization_Log for future normalization
 * Append-only running log of all industries seen from imports
 *
 * @param {Array<Object>} companyRows - Array of {domain, primaryIndustry, subIndustry}
 * @param {string} source - "Lusha" or "Crunchbase"
 */
function logIndustryNormalization_(companyRows, source) {
  const ss = getSpreadsheet_();
  let logSheet = ss.getSheetByName('Industry_Normalization');

  // Create log sheet if missing
  if (!logSheet) {
    logSheet = ss.insertSheet('Industry_Normalization');
    logSheet.appendRow(['Company_Domain', 'Source', 'Date_Added', 'PrimaryIndustry_RAW', 'SubIndustry_RAW', 'NormalizedPrimaryIndustry', 'NormalizedSubIndustry']);
    logSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }

  // Read existing logs to deduplicate (check columns A, B)
  const lastRow = logSheet.getLastRow();
  const existingData = lastRow > 1
    ? logSheet.getRange(2, 1, lastRow - 1, 2).getValues()
    : [];

  const existingSet = new Set();
  for (const row of existingData) {
    const key = `${row[0]}_${row[1]}`; // Domain_Source
    existingSet.add(key);
  }

  // Prepare new log entries
  const toLog = [];
  const dateAdded = Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy');

  for (const company of companyRows) {
    const domain = String(company.domain || '').trim();
    const primaryIndustry = String(company.primaryIndustry || '').trim();
    const subIndustry = String(company.subIndustry || '').trim();

    if (!domain) continue; // Skip if no domain

    const key = `${domain}_${source}`;
    if (existingSet.has(key)) continue; // Skip duplicates

    toLog.push([domain, source, dateAdded, primaryIndustry, subIndustry, '', '']);
    existingSet.add(key);
  }

  // Batch append new entries
  if (toLog.length > 0) {
    logSheet.getRange(logSheet.getLastRow() + 1, 1, toLog.length, 7).setValues(toLog);
    Logger.log(`✓ Logged ${toLog.length} industries to Industry_Normalization`);
  }
}

/** ==========================================================================
 *  SIZE/REVENUE NORMALIZATION LOGGING
 *  ========================================================================== */

/**
 * Log size/revenue data to Size_Revenue_Normalization for future normalization
 * Append-only running log of all size/revenue seen from imports
 *
 * @param {Array<Object>} companyRows - Array of {domain, companySize, companyRevenue}
 * @param {string} source - "Lusha" or "Crunchbase"
 */
function logSizeRevenueNormalization_(companyRows, source) {
  const ss = getSpreadsheet_();
  let logSheet = ss.getSheetByName(CONFIG.sheetSizeRevenueNorm);

  // Create log sheet if missing
  if (!logSheet) {
    logSheet = ss.insertSheet(CONFIG.sheetSizeRevenueNorm);
    logSheet.appendRow(['Company_Domain', 'Source', 'Date_Added', 'CompanySize_RAW', 'CompanyRevenue_RAW', 'CompanySizeNorm', 'CompanyRevenueNorm']);
    logSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }

  // Read existing logs to deduplicate (check columns A, B)
  const lastRow = logSheet.getLastRow();
  const existingData = lastRow > 1
    ? logSheet.getRange(2, 1, lastRow - 1, 2).getValues()
    : [];

  const existingSet = new Set();
  for (const row of existingData) {
    const key = `${row[0]}_${row[1]}`; // Domain_Source
    existingSet.add(key);
  }

  // Prepare new log entries
  const toLog = [];
  const dateAdded = Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy');

  for (const company of companyRows) {
    const domain = String(company.domain || '').trim();
    const companySize = String(company.companySize || '').trim();
    const companyRevenue = String(company.companyRevenue || '').trim();

    if (!domain) continue; // Skip if no domain

    const key = `${domain}_${source}`;
    if (existingSet.has(key)) continue; // Skip duplicates

    toLog.push([domain, source, dateAdded, companySize, companyRevenue, '', '']);
    existingSet.add(key);
  }

  // Batch append new entries
  if (toLog.length > 0) {
    logSheet.getRange(logSheet.getLastRow() + 1, 1, toLog.length, 7).setValues(toLog);
    Logger.log(`✓ Logged ${toLog.length} size/revenue records to Size_Revenue_Normalization`);
  }
}

/** ==========================================================================
 *  CONTACT INFO MANAGEMENT (v2.1)
 *  ========================================================================== */

/**
 * Append rows to HM_ContactInfo (append-only ledger)
 * Deduplicates within the batch to avoid duplicate entries
 *
 * @param {Array<Array>} rows - Array of [Key, Type, Value, Domain, Source, Timestamp, Notes]
 * @returns {number} - Number of rows actually appended
 */
function appendToContactInfo_(rows) {
  if (!rows || rows.length === 0) {
    Logger.log('appendToContactInfo_: No rows to append');
    return 0;
  }

  const ss = getSpreadsheet_();
  let contactInfo = ss.getSheetByName(CONFIG.sheetContactInfo);

  // Create sheet if doesn't exist
  if (!contactInfo) {
    contactInfo = ss.insertSheet(CONFIG.sheetContactInfo);
    contactInfo.appendRow(['Composite_Key', 'Channel_Type', 'Channel_Value', 'Company_Domain_at_Time', 'Source_System', 'Last_Seen', 'Notes']);
    contactInfo.getRange(1, 1, 1, 7).setFontWeight('bold');
    Logger.log(`✓ Created HM_ContactInfo sheet`);
  }

  // Deduplicate within this batch (Key + Type + Value)
  const uniqueRows = [];
  const seen = new Set();

  for (const row of rows) {
    const key = `${row[0]}|${row[1]}|${row[2]}`;
    if (!seen.has(key) && String(row[2] || '').trim()) { // Skip if channel value is blank
      uniqueRows.push(row);
      seen.add(key);
    }
  }

  if (uniqueRows.length === 0) {
    Logger.log('appendToContactInfo_: All rows were duplicates or blank');
    return 0;
  }

  // Append to sheet
  const startRow = getFirstEmptyRowA_(contactInfo);
  ensureSheetHasRows_(contactInfo, startRow + uniqueRows.length - 1);
  contactInfo.getRange(startRow, 1, uniqueRows.length, 7).setValues(uniqueRows);

  Logger.log(`✓ Added ${uniqueRows.length} contact info rows to HM_ContactInfo`);
  return uniqueRows.length;
}

/** ==========================================================================
 *  COLUMN MAPPING HELPERS (GUARDIAN Pattern)
 *  ========================================================================== */

/**
 * Get column mapping for a sheet by header names
 * Maps header names to 0-indexed column positions
 *
 * @param {Sheet} sheet - The sheet to map
 * @param {Array<string>} expectedHeaders - Array of expected header names
 * @returns {Object} - Map of {headerName: columnIndex}
 * @throws {Error} - If required header not found
 */
function getColumnMapping_(sheet, expectedHeaders) {
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
 * Verify sheet headers match expected structure
 * Used for import validation (Lusha, Crunchbase)
 *
 * @param {Sheet} sheet - The sheet to verify
 * @param {Array<string>} expectedHeaders - Expected headers in order
 * @param {number} headerCount - Number of headers to check
 * @returns {Object} - {isValid: boolean, mismatches: Array<string>}
 */
function verifyHeaders_(sheet, expectedHeaders, headerCount) {
  const actualHeaders = sheet.getRange(1, 1, 1, headerCount).getValues()[0].map(h => String(h).trim());

  const mismatches = [];

  for (let i = 0; i < expectedHeaders.length; i++) {
    if (actualHeaders[i].toLowerCase() !== expectedHeaders[i].toLowerCase()) {
      mismatches.push(`Col ${i+1}: Expected '${expectedHeaders[i]}', got '${actualHeaders[i]}'`);
    }
  }

  return {
    isValid: mismatches.length === 0,
    mismatches: mismatches
  };
}

// ============================================================================
// DRIVE IMPORT CONFIGURATION
// ============================================================================

/**
 * Drive-based CSV import system
 * Folder IDs are stored in ScriptProperties (set by Setup_Drive_Import_Folders)
 * Each source has its own folder; folder determines the processor
 */
const DRIVE_IMPORT = {
  processedFolderName: 'BDBot_Import_Processed',
  processedPropKey: 'DRIVE_IMPORT_PROCESSED_FOLDER',

  sources: {
    linkedin: {
      label: 'LinkedIn Contacts',
      folderName: 'BDBot_Import_LinkedIn',
      propKey: 'DRIVE_IMPORT_FOLDER_LINKEDIN',
      targetTab: 'Import_LinkedIn',
      expectedCols: 7,
      skipMetadataRows: 0,
      expectedHeaders: ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On']
    },
    lusha: {
      label: 'Lusha Contacts',
      folderName: 'BDBot_Import_Lusha',
      propKey: 'DRIVE_IMPORT_FOLDER_LUSHA',
      targetTab: CONFIG.sheetLusha,
      expectedCols: 56,
      skipMetadataRows: 0,
      expectedHeaders: LUSHA_CFG.expectedHeaders
    },
    lushaCompany: {
      label: 'Lusha Companies',
      folderName: 'BDBot_Import_LushaCompany',
      propKey: 'DRIVE_IMPORT_FOLDER_LUSHA_COMPANY',
      targetTab: CONFIG.sheetLushaCompany,
      expectedCols: 30,
      skipMetadataRows: 0,
      expectedHeaders: LUSHA_COMPANY_CFG.expectedHeaders
    },
    crunchbase: {
      label: 'CrunchBase Companies',
      folderName: 'BDBot_Import_CrunchBase',
      propKey: 'DRIVE_IMPORT_FOLDER_CRUNCHBASE',
      targetTab: CONFIG.sheetCrunchbase,
      expectedCols: 15,
      skipMetadataRows: 0,
      expectedHeaders: CRUNCHBASE_CFG.expectedHeaders
    },
    bullhorn: {
      label: 'Bullhorn Interactions',
      folderName: 'BDBot_Import_Bullhorn',
      propKey: 'DRIVE_IMPORT_FOLDER_BULLHORN',
      targetTab: 'Import_Bullhorn',
      expectedCols: 8,
      skipMetadataRows: 2,
      expectedHeaders: ['Department', 'Note Author', 'Date Note Added', 'Type', 'Note Action', 'About', 'Status', 'Note Body']
    }
  }
};

// ============================================================================
// CAMPAIGN CONFIGURATION
// ============================================================================

const CAMPAIGN_KINDS = [
  "MPC (Most Placeable Candidate)",
  "Funding Announcement",
  "New CFO Hired",
  "New HM Hired",
  "Public Accounting - October",
  "Public Accounting - April",
  "S1 Filing / IPO Prep",
  "Job Posting Detected",
  "General Introduction",
  "Business Journal Mention",
  "Market Update",
  "Other"
];

const SERPER_QUERY_TEMPLATES = {
  "MPC": "recent news OR job postings site:{{domain}} after:{{date_6mo_ago}}",
  "Funding": "funding OR investment {{company}} after:{{date_6mo_ago}}",
  "New_CFO": "CFO OR hire {{company}} after:{{date_3mo_ago}}",
  "Job_Post": "job posting accountant OR controller {{company}}"
};

// Gemini API Configuration (Market Intel)
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.geminiModel}:generateContent`;

const MARKET_INTEL_CONFIG = {
  searchWindow: 90,          // days to look back
  maxResultsPerDomain: 5,    // Serper results per query
  extractionTemp: 0.1        // Gemini temperature for consistent output
};

// Claude API Configuration
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Get Claude API key from Script Properties
 */
function getClaudeAPIKey() {
  return PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
}

/**
 * Get Serper API key from Script Properties
 */
function getSerperAPIKey() {
  return PropertiesService.getScriptProperties().getProperty("SERPER_API_KEY");
}

/**
 * Get Gemini API key from Script Properties
 */
function getGeminiAPIKey() {
  return PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
}

// ============================================================================
// SHARED HELPERS (consolidated from campaign + import scripts)
// ============================================================================

/**
 * Campaign error logging (consolidated from 10/11/12_BD_Campaign*.gs)
 */
function logCampaignError(message) {
  console.error(`[Campaign Error] ${message}`);
  Logger.log(`ERROR: ${message}`);
}

/**
 * Campaign action logging (consolidated from 10/11/12_BD_Campaign*.gs)
 */
function logCampaignAction(message) {
  console.log(`[Campaign Action] ${message}`);
  Logger.log(`ACTION: ${message}`);
}

/**
 * Normalize a name for fuzzy matching (consolidated from 96/97)
 * Lowercase, strip punctuation, collapse spaces
 * @param {string} name - Raw name
 * @returns {string} - Normalized name
 */
function normalizeName_(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim();
}

/**
 * Parse first name from full name string
 * @param {string} fullName - Full name (e.g., "John Smith")
 * @returns {string} - First name (e.g., "John")
 */
function parseFirstName_(fullName) {
  if (!fullName) return '';
  return String(fullName).trim().split(' ')[0];
}
