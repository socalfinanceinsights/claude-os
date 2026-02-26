/**
 * @file 96c_Dedup_Merge_Helpers.gs
 * Merge logic, review tab management, and UID lookup functions for deduplication
 *
 * PURPOSE: Merging LinkedIn rows into Bullhorn rows, status stamping,
 *          review tab creation/population, and UID-based candidate lookups
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs
 *
 * NOTE: These functions are called by orchestrators in 96_Candidate_Deduplication.gs.
 * Data retrieval and Gemini matching: see 96b_Dedup_Helpers.gs
 * Do not rename without updating callers.
 *
 * @execution manual
 */

// ============================================
// MERGE & STATUS UPDATES
// ============================================

/**
 * Merge LinkedIn candidate into Bullhorn candidate row and delete LinkedIn row
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {Object} linkedInCandidate - LinkedIn candidate
 * @param {Object} bullhornCandidate - Bullhorn candidate to merge into
 */
function mergeLinkedInToBullhorn(masterSheet, linkedInCandidate, bullhornCandidate) {
  const headers = masterSheet.getRange(1, 1, 1, masterSheet.getLastColumn()).getValues()[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i + 1);

  // LinkedIn wins: Current_Title, Current_Company, LinkedIn_URL, Location, Last_LinkedIn_Refresh
  const updates = [];

  if (linkedInCandidate.currentTitle) {
    updates.push({ col: colMap['Current_Title'], value: linkedInCandidate.currentTitle });
  }
  if (linkedInCandidate.currentCompany) {
    updates.push({ col: colMap['Current_Company'], value: linkedInCandidate.currentCompany });
  }
  if (linkedInCandidate.linkedInUrl) {
    updates.push({ col: colMap['LinkedIn_URL'], value: linkedInCandidate.linkedInUrl });
  }
  if (linkedInCandidate.location) {
    updates.push({ col: colMap['Location'], value: linkedInCandidate.location });
  }
  updates.push({ col: colMap['Last_LinkedIn_Refresh'], value: new Date() });

  // Stamp Match_Status on the Bullhorn row
  const today = new Date();
  const dateStamp = Utilities.formatDate(today, Session.getScriptTimeZone(), 'MM.dd.yyyy');
  updates.push({ col: colMap['Match_Status'], value: `LinkedIn Matched ${dateStamp}` });

  // Apply updates to Bullhorn row
  for (const update of updates) {
    masterSheet.getRange(bullhornCandidate.rowNum, update.col).setValue(update.value);
  }

  // Delete LinkedIn row
  masterSheet.deleteRow(linkedInCandidate.rowNum);

  Logger.log(`Merged: ${linkedInCandidate.fullName} (row ${linkedInCandidate.rowNum}) → ${bullhornCandidate.fullName} (row ${bullhornCandidate.rowNum})`);
}

/**
 * Mark LinkedIn candidate as processed (by UID to avoid row number shifts)
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {string} uid - Candidate UID
 * @param {string} status - Match status (NO_MATCH, REVIEW, MERGED)
 */
function markAsProcessedByUID(masterSheet, uid, status) {
  const rowNum = findCandidateRowByUID(masterSheet, uid);

  if (!rowNum) {
    Logger.log(`  WARNING: Could not find candidate ${uid} to mark as ${status}`);
    return;
  }

  const headers = masterSheet.getRange(1, 1, 1, masterSheet.getLastColumn()).getValues()[0];
  let matchStatusColIndex = headers.indexOf('Match_Status');

  if (matchStatusColIndex === -1) {
    masterSheet.getRange(1, headers.length + 1).setValue('Match_Status');
    matchStatusColIndex = headers.length;
  }

  const matchStatusCol = matchStatusColIndex + 1;
  masterSheet.getRange(rowNum, matchStatusCol).setValue(status);
  Logger.log(`  Marked ${uid} as ${status} at row ${rowNum}`);
}

/**
 * Mark LinkedIn candidate as processed by row number
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {number} rowNum - Row number
 * @param {string} status - Match status (NO_MATCH, REVIEW, MERGED)
 */
function markAsProcessed(masterSheet, rowNum, status) {
  const headers = masterSheet.getRange(1, 1, 1, masterSheet.getLastColumn()).getValues()[0];
  let matchStatusColIndex = headers.indexOf('Match_Status');

  if (matchStatusColIndex === -1) {
    masterSheet.getRange(1, headers.length + 1).setValue('Match_Status');
    matchStatusColIndex = headers.length;
  }

  const matchStatusCol = matchStatusColIndex + 1;
  masterSheet.getRange(rowNum, matchStatusCol).setValue(status);
}

// ============================================
// REVIEW TAB
// ============================================

/**
 * Write fuzzy match to review tab with dropdown for manual decision
 * @param {Spreadsheet} ss - Spreadsheet object
 * @param {Object} linkedInCandidate - LinkedIn candidate
 * @param {Array} topMatches - Top 3 match suggestions
 */
function writeToReviewTab(ss, linkedInCandidate, topMatches) {
  let reviewSheet = ss.getSheetByName(TAB_CANDIDATE_MATCH_REVIEW);

  if (!reviewSheet) {
    reviewSheet = ss.insertSheet(TAB_CANDIDATE_MATCH_REVIEW);
    const headers = [
      'LinkedIn_UID', 'LinkedIn_Name', 'LinkedIn_Company',
      'Suggestion_1_Name', 'Suggestion_1_UID', 'Suggestion_1_Score',
      'Suggestion_2_Name', 'Suggestion_2_UID', 'Suggestion_2_Score',
      'Suggestion_3_Name', 'Suggestion_3_UID', 'Suggestion_3_Score',
      'Action'
    ];
    reviewSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    reviewSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    reviewSheet.setFrozenRows(1);
  }

  const top1 = topMatches[0];
  const top2 = topMatches[1];
  const top3 = topMatches[2];

  const rowNum = reviewSheet.getLastRow() + 1;

  const row = [
    linkedInCandidate.uid,
    linkedInCandidate.fullName,
    linkedInCandidate.currentCompany,
    top1 ? `${top1.bullhornCandidate.fullName} @ ${top1.bullhornCandidate.currentCompany}` : '',
    top1 ? top1.bullhornCandidate.uid : '',
    top1 ? top1.confidence : '',
    top2 ? `${top2.bullhornCandidate.fullName} @ ${top2.bullhornCandidate.currentCompany}` : '',
    top2 ? top2.bullhornCandidate.uid : '',
    top2 ? top2.confidence : '',
    top3 ? `${top3.bullhornCandidate.fullName} @ ${top3.bullhornCandidate.currentCompany}` : '',
    top3 ? top3.bullhornCandidate.uid : '',
    top3 ? top3.confidence : '',
    'Pending Review'
  ];

  reviewSheet.appendRow(row);

  // Create dropdown for Action column
  const dropdownOptions = ['NO MATCH'];
  if (top1) dropdownOptions.push(top1.bullhornCandidate.uid);
  if (top2) dropdownOptions.push(top2.bullhornCandidate.uid);
  if (top3) dropdownOptions.push(top3.bullhornCandidate.uid);

  const actionCell = reviewSheet.getRange(rowNum, 13);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(dropdownOptions, true)
    .setAllowInvalid(true)
    .build();
  actionCell.setDataValidation(rule);
}

// ============================================
// STRING UTILITIES
// ============================================

/**
 * Extract last name from full name
 * Handles "Last, First", "First Last", and "Last / MBA / First" formats
 * NOTE: This version strips credentials and handles Bullhorn name formats.
 * A simpler extractLastName exists in 04_Folder_Linker.gs for pre-normalized names.
 * @param {string} fullName - Full name (may include credentials)
 * @returns {string} - Last name
 */
function extractLastName(fullName) {
  if (!fullName) return '';

  // Remove credentials
  let cleanName = fullName.replace(/[,\/]?\s*(CPA|FPC|CPP|MBA|CFA|EA|ACCA|CIA|USAF Veteran)\b/gi, '').trim();

  // Remove standalone slashes
  cleanName = cleanName.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim();

  // "Last, First" format
  if (cleanName.includes(',')) {
    const parts = cleanName.split(',');
    return parts[0].trim();
  }

  // "First Last" format — take last word
  const words = cleanName.split(/\s+/);
  return words[words.length - 1];
}

// ============================================
// UID-BASED LOOKUPS
// ============================================

/**
 * Find candidate row number by UID in Candidate_Master
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {string} uid - Candidate UID
 * @returns {number|null} - Row number or null if not found
 */
function findCandidateRowByUID(masterSheet, uid) {
  const data = masterSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === uid) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Find LinkedIn candidate object by UID
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {string} uid - LinkedIn UID
 * @returns {Object|null} - LinkedIn candidate object or null
 */
function findLinkedInCandidateByUID(masterSheet, uid) {
  const data = masterSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[colMap['UID']] === uid) {
      return {
        rowNum: i + 1,
        uid: row[colMap['UID']],
        fullName: row[colMap['Full_Name']],
        currentTitle: row[colMap['Current_Title']],
        currentCompany: row[colMap['Current_Company']],
        linkedInUrl: row[colMap['LinkedIn_URL']],
        email: row[colMap['Email']],
        phone: row[colMap['Phone']],
        location: row[colMap['Location']],
        keySkills: row[colMap['Key_Skills']]
      };
    }
  }
  return null;
}

/**
 * Find Bullhorn candidate object by UID
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {string} uid - Bullhorn UID
 * @returns {Object|null} - Bullhorn candidate object or null
 */
function findBullhornCandidateByUID(masterSheet, uid) {
  const data = masterSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[colMap['UID']] === uid) {
      return {
        rowNum: i + 1,
        uid: row[colMap['UID']],
        fullName: row[colMap['Full_Name']],
        currentTitle: row[colMap['Current_Title']],
        currentCompany: row[colMap['Current_Company']]
      };
    }
  }
  return null;
}
