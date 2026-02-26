/**
 * @file 06c_Screening_Config_Helpers.gs
 * Config tab management, results tab creation, and matrix formatting for Job Screening Engine
 *
 * PURPOSE: Job_Screen_Config tab CRUD operations, recent screen queries for sidebar,
 *          results tab creation with conditional formatting and dropdowns,
 *          and matrix summary formatting
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs
 *
 * NOTE: These functions are called by 06_Job_Screening.gs and 06b_Screening_Helpers.gs.
 * Location normalization and candidate retrieval: see 06b_Screening_Helpers.gs
 * Do not rename without updating callers.
 *
 * @execution manual
 */

// ============================================
// CONFIG TAB MANAGEMENT
// ============================================

/**
 * Create or get the Job_Screen_Config tab
 * @returns {Sheet} - Config sheet
 */
function getOrCreateScreenConfigTab() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let configSheet = ss.getSheetByName(TAB_JOB_SCREEN_CONFIG);

  if (!configSheet) {
    configSheet = ss.insertSheet(TAB_JOB_SCREEN_CONFIG);
    const headers = [
      'Screen_ID', 'Role_Title', 'Created_Date', 'Status',
      'JD_Text', 'Client_Notes', 'Screening_Matrix',
      'Candidates_Screened', 'Results_Tab', 'Filters_Used'
    ];
    configSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    configSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    configSheet.setFrozenRows(1);
    Logger.log('Created Job_Screen_Config tab');
  }

  return configSheet;
}

/**
 * Generate a unique Screen_ID
 * Format: SCR_YYYY-MM-DD_NNN
 *
 * @returns {string} - Screen ID
 */
function generateScreenId() {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const prefix = `SCR_${today}_`;

  const configSheet = getOrCreateScreenConfigTab();
  const data = configSheet.getDataRange().getValues();

  // Count existing screens for today
  let todayCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().startsWith(prefix)) {
      todayCount++;
    }
  }

  return `${prefix}${String(todayCount + 1).padStart(3, '0')}`;
}

/**
 * Create a new screening config row
 *
 * @param {string} screenId - Generated screen ID
 * @param {string} roleTitle - Role title from matrix
 * @param {string} jdText - Full JD text
 * @param {string} clientNotes - Client notes
 * @param {Object} matrix - Screening matrix JSON
 * @param {Object} filters - Filter settings used
 * @returns {number} - Row number of new config entry
 */
function createScreeningConfig(screenId, roleTitle, jdText, clientNotes, matrix, filters) {
  const configSheet = getOrCreateScreenConfigTab();

  const row = [
    screenId,
    roleTitle,
    new Date(),
    'MATRIX_READY',
    jdText,
    clientNotes || '',
    JSON.stringify(matrix),
    0,
    '',
    JSON.stringify(filters || {})
  ];

  configSheet.appendRow(row);
  Logger.log(`Created screening config: ${screenId} - ${roleTitle}`);

  return configSheet.getLastRow();
}

/**
 * Update screening config status and count
 *
 * @param {string} screenId - Screen ID to update
 * @param {string} status - New status
 * @param {number} candidatesScreened - Total candidates processed
 * @param {string} resultsTab - Name of results tab
 */
function updateScreeningConfig(screenId, status, candidatesScreened, resultsTab) {
  const configSheet = getOrCreateScreenConfigTab();
  const data = configSheet.getDataRange().getValues();
  const headers = data[0];

  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (data[i][colMap['Screen_ID']] === screenId) {
      const rowNum = i + 1;
      if (status) configSheet.getRange(rowNum, colMap['Status'] + 1).setValue(status);
      if (candidatesScreened !== undefined) configSheet.getRange(rowNum, colMap['Candidates_Screened'] + 1).setValue(candidatesScreened);
      if (resultsTab) configSheet.getRange(rowNum, colMap['Results_Tab'] + 1).setValue(resultsTab);
      Logger.log(`Updated config ${screenId}: status=${status}, screened=${candidatesScreened}`);
      return;
    }
  }

  Logger.log(`WARNING: Screen_ID ${screenId} not found in config tab`);
}

/**
 * Get screening matrix for a Screen_ID
 *
 * @param {string} screenId - Screen ID
 * @returns {Object|null} - Matrix JSON or null
 */
function getScreeningMatrix(screenId) {
  const configSheet = getOrCreateScreenConfigTab();
  const data = configSheet.getDataRange().getValues();
  const headers = data[0];

  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (data[i][colMap['Screen_ID']] === screenId) {
      const matrixStr = data[i][colMap['Screening_Matrix']];
      if (matrixStr) {
        return JSON.parse(matrixStr);
      }
    }
  }

  return null;
}

// ============================================
// RECENT SCREENS (for sidebar dropdown)
// ============================================

/**
 * Get recent screen configs for sidebar "Re-run" dropdown
 * Returns last 10 screens, newest first
 *
 * @returns {Array<Object>} - [{ screenId, roleTitle, company, date, status, candidatesScreened }]
 */
function getRecentScreens() {
  const configSheet = getOrCreateScreenConfigTab();
  const data = configSheet.getDataRange().getValues();

  if (data.length <= 1) return [];

  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const screens = [];
  for (let i = data.length - 1; i >= 1 && screens.length < 10; i--) {
    const row = data[i];
    const matrixStr = row[colMap['Screening_Matrix']];
    let company = '';
    if (matrixStr) {
      try {
        const matrix = JSON.parse(matrixStr);
        company = matrix.company || '';
      } catch (e) { /* ignore parse errors */ }
    }

    screens.push({
      screenId: row[colMap['Screen_ID']] || '',
      roleTitle: row[colMap['Role_Title']] || '',
      company: company,
      date: row[colMap['Created_Date']] ? row[colMap['Created_Date']].toString() : '',
      status: row[colMap['Status']] || '',
      candidatesScreened: row[colMap['Candidates_Screened']] || 0
    });
  }

  return screens;
}

/**
 * Load a saved screen's matrix and return summary for sidebar
 * Called when user picks a previous screen from dropdown
 *
 * @param {string} screenId - Screen ID to load
 * @returns {Object} - { success, screenId, summary, error }
 */
function sidebarLoadSavedScreen(screenId) {
  try {
    const matrix = getScreeningMatrix(screenId);
    if (!matrix) {
      return { success: false, error: `Matrix not found for ${screenId}` };
    }

    const summary = formatMatrixSummary(matrix);
    return {
      success: true,
      screenId: screenId,
      summary: summary
    };

  } catch (error) {
    Logger.log(`ERROR in sidebarLoadSavedScreen: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================
// RESULTS TAB MANAGEMENT
// ============================================

/**
 * Generate results tab name from role title and optional company
 * Never overwrites — each run gets a unique tab via HH:MM timestamp
 * Format: "Screen_AcctMgr_MonsterEnergy_0209_0115"
 *
 * @param {string} roleTitle - Full role title from matrix
 * @param {string} [company] - Optional company name
 * @returns {string} - Tab name (max ~50 chars for Sheets tab limit)
 */
function generateResultsTabName(roleTitle, company) {
  // Abbreviate role title: first 2-4 chars of significant words
  const titleWords = roleTitle.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 0);
  let titleAbbrev = '';
  for (const word of titleWords) {
    if (word.length <= 2 && titleWords.length > 1) continue;
    titleAbbrev += word.charAt(0).toUpperCase() + word.substring(1, Math.min(4, word.length)).toLowerCase();
  }
  if (titleAbbrev.length > 15) titleAbbrev = titleAbbrev.substring(0, 15);

  // Abbreviate company if provided: first word or first 12 chars
  let compAbbrev = '';
  if (company) {
    const compWords = company.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
    compAbbrev = compWords.length > 0 ? compWords[0].substring(0, 12) : '';
  }

  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMdd');
  const timeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmm');

  // Build tab name: Screen_Title_Company_MMDD_HHMM or Screen_Title_MMDD_HHMM
  const parts = ['Screen', titleAbbrev];
  if (compAbbrev) parts.push(compAbbrev);
  parts.push(dateStr);
  parts.push(timeStr);

  return parts.join('_');
}

/**
 * Create the results tab and write headers
 *
 * @param {string} tabName - Tab name
 * @returns {Sheet} - New results sheet
 */
function createResultsTab(tabName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Never overwrite — tab names are unique via HH:MM timestamp
  // If somehow a duplicate exists, append a suffix
  let finalName = tabName;
  let suffix = 1;
  while (ss.getSheetByName(finalName)) {
    finalName = tabName + '_' + suffix;
    suffix++;
  }

  const sheet = ss.insertSheet(finalName);

  const headers = [
    'Rank', 'UID', 'Full_Name', 'Match_Pct',
    'Current_Title', 'Current_Company', 'Key_Skills',
    'Comp_Target', 'Location', 'Quality_Tier',
    'Match_Reasons', 'Concerns',
    'LinkedIn_URL', 'Email', 'Phone', 'Notes_Snippet',
    'Shortlist', 'Action', 'Recruiter_Notes'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#f3f3f3');
  sheet.setFrozenRows(1);

  // Set column widths for readability
  sheet.setColumnWidth(1, 50);   // Rank
  sheet.setColumnWidth(2, 100);  // UID
  sheet.setColumnWidth(3, 180);  // Full_Name
  sheet.setColumnWidth(4, 80);   // Match_Pct
  sheet.setColumnWidth(5, 200);  // Current_Title
  sheet.setColumnWidth(6, 200);  // Current_Company
  sheet.setColumnWidth(7, 250);  // Key_Skills
  sheet.setColumnWidth(8, 100);  // Comp_Target
  sheet.setColumnWidth(9, 120);  // Location
  sheet.setColumnWidth(10, 80);  // Quality_Tier
  sheet.setColumnWidth(11, 300); // Match_Reasons
  sheet.setColumnWidth(12, 250); // Concerns
  sheet.setColumnWidth(13, 120); // LinkedIn_URL
  sheet.setColumnWidth(14, 200); // Email
  sheet.setColumnWidth(15, 120); // Phone
  sheet.setColumnWidth(16, 300); // Notes_Snippet
  sheet.setColumnWidth(17, 80);  // Shortlist
  sheet.setColumnWidth(18, 120); // Action
  sheet.setColumnWidth(19, 250); // Recruiter_Notes

  Logger.log(`Created results tab: ${tabName}`);
  return sheet;
}

/**
 * Write Top N results to results tab with conditional formatting
 *
 * @param {string} tabName - Results tab name
 * @param {Array<Object>} allResults - All scored results (will be sorted and trimmed to Top N)
 * @param {Array<Object>} candidateLookup - Map of UID → full candidate data
 */
function writeScreeningResults(tabName, allResults, candidateLookup) {
  // Sort by match_pct descending, filter out disqualified
  const ranked = allResults
    .filter(r => !r.disqualified && r.match_pct > 0)
    .sort((a, b) => b.match_pct - a.match_pct)
    .slice(0, SCREENING_TOP_N);

  const sheet = createResultsTab(tabName);

  if (ranked.length === 0) {
    sheet.getRange(2, 1).setValue('No qualifying candidates found.');
    Logger.log('WARNING: No candidates passed screening.');
    return;
  }

  // Build output rows (LinkedIn column excluded — written separately as formula)
  const rows = ranked.map((result, idx) => {
    const candidate = candidateLookup[result.uid] || {};
    return [
      idx + 1,
      result.uid,
      candidate.full_name || '',
      result.match_pct,
      candidate.current_title || '',
      candidate.current_company || '',
      candidate.key_skills || '',
      candidate.comp_target || '',
      candidate.location || '',
      candidate.quality_tier || '',
      (result.match_reasons || []).join('; '),
      (result.concerns || []).join('; '),
      '',  // LinkedIn_URL placeholder — written below as HYPERLINK formula
      candidate.email || '',
      candidate.phone || '',
      candidate.notes_summary ? candidate.notes_summary.substring(0, 200) : '',
      '',  // Shortlist (manual checkbox)
      '',  // Action (manual dropdown — validation added below)
      ''   // Recruiter_Notes (free text)
    ];
  });

  // Write all rows at once (batch operation)
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

  // Write LinkedIn URLs as HYPERLINK formulas (column 13)
  // setValues() treats formula strings as plain text; setFormulas() is required
  const linkedinFormulas = ranked.map(result => {
    const candidate = candidateLookup[result.uid] || {};
    const url = candidate.linkedin_url || '';
    return [url ? `=HYPERLINK("${url}","LinkedIn")` : ''];
  });
  sheet.getRange(2, 13, linkedinFormulas.length, 1).setFormulas(linkedinFormulas);

  // Apply conditional formatting: gradient green on Match_Pct column (D)
  const matchPctRange = sheet.getRange(2, 4, rows.length, 1);

  // Dark green for high scores
  const highRule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThanOrEqualTo(80)
    .setBackground('#b7e1cd')
    .setRanges([matchPctRange])
    .build();

  // Light green for moderate scores
  const midRule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberBetween(60, 79)
    .setBackground('#d9ead3')
    .setRanges([matchPctRange])
    .build();

  // Yellow for lower scores
  const lowRule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberBetween(40, 59)
    .setBackground('#fff2cc')
    .setRanges([matchPctRange])
    .build();

  const rules = sheet.getConditionalFormatRules();
  rules.push(highRule, midRule, lowRule);
  sheet.setConditionalFormatRules(rules);

  // Add dropdown validation for Action column (col 18)
  const actionRange = sheet.getRange(2, 18, rows.length, 1);
  const actionValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['To Contact', 'Contacted', 'Pass', 'Submitted'], true)
    .setAllowInvalid(false)
    .build();
  actionRange.setDataValidation(actionValidation);

  Logger.log(`Wrote ${rows.length} results to ${tabName}`);
}

// ============================================
// MATRIX SUMMARY FORMATTING
// ============================================

/**
 * Format screening matrix as human-readable summary for sidebar preview
 *
 * @param {Object} matrix - Screening matrix JSON
 * @returns {Object} - { title, level, mustHaveCount, signalCount, disqualifierCount, summary }
 */
function formatMatrixSummary(matrix) {
  if (!matrix) return null;

  const mustHaves = matrix.must_have || [];
  const signals = matrix.strong_signals || [];
  const disqualifiers = matrix.disqualifiers || [];

  const summary = {
    title: matrix.role_title || 'Unknown',
    company: matrix.company || 'Unknown',
    level: matrix.role_level || 'Unknown',
    specialization: matrix.specialization || 'Unknown',
    location: matrix.location_requirement || 'Not specified',
    comp: matrix.comp_range || 'Not specified',
    industry: matrix.industry || 'Not specified',
    mustHaveCount: mustHaves.length,
    mustHaveList: mustHaves,
    signalCount: signals.length,
    signalList: signals,
    disqualifierCount: disqualifiers.length,
    disqualifierList: disqualifiers.map(d => d.description)
  };

  return summary;
}
