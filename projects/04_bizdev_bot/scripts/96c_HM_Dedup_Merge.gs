/**
 * 96c_HM_Dedup_Merge.gs
 * BD TRACKER - HM Dedup Merge Logic & Review Tab
 * @execution manual
 * Version: 1.0.0
 *
 * CONTAINS:
 * - Merge execution (enrich LinkedIn record, cascade key updates, delete NO_LI row)
 * - Cascade key update across all downstream sheets
 * - Dedup status management (by row or by key)
 * - HM_Dedup_Review tab management
 *
 * SPLIT FROM: 96b_HM_Dedup_Helpers.gs (lines 275-503)
 * CALLED BY: 96_HM_Dedup.gs orchestrators
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, logError_)
 */

/** ==========================================================================
 *  MERGE LOGIC
 *  ========================================================================== */

/**
 * Merge a NO_LI record into its matched LinkedIn record
 * Enriches LinkedIn record with NO_LI data (fill blanks only)
 * Cascades key update to downstream sheets
 * Deletes the NO_LI row
 *
 * @param {Spreadsheet} ss
 * @param {Sheet} hmSheet
 * @param {Object} noLiRecord - The NO_LI record to absorb
 * @param {Object} liRecord - The LinkedIn-keyed record to enrich
 */
function mergeNoLiToLinkedIn_(ss, hmSheet, noLiRecord, liRecord) {
  const headers = hmSheet.getRange(1, 1, 1, hmSheet.getLastColumn()).getValues()[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i + 1); // 1-indexed for getRange

  // --- Step 1: Enrich LinkedIn record with NO_LI data (fill blanks only) ---

  // Title: NO_LI wins if LinkedIn is empty (Bullhorn often has more detailed titles)
  if (noLiRecord.title && !liRecord.title) {
    hmSheet.getRange(liRecord.rowNum, colMap['HM Title']).setValue(noLiRecord.title);
  }

  // Company: NO_LI wins if LinkedIn is empty
  if (noLiRecord.company && !liRecord.company) {
    hmSheet.getRange(liRecord.rowNum, colMap['Company']).setValue(noLiRecord.company);
  }

  // Domain: NO_LI wins if LinkedIn is empty
  if (noLiRecord.domain && !liRecord.domain) {
    hmSheet.getRange(liRecord.rowNum, colMap['Company Domain']).setValue(noLiRecord.domain);
  }

  // Email: NO_LI wins if LinkedIn is empty
  if (noLiRecord.primaryEmail && !liRecord.primaryEmail) {
    hmSheet.getRange(liRecord.rowNum, colMap['Primary_Email']).setValue(noLiRecord.primaryEmail);
  }

  // Phone: NO_LI wins if LinkedIn is empty
  if (noLiRecord.primaryPhone && !liRecord.primaryPhone) {
    hmSheet.getRange(liRecord.rowNum, colMap['Primary_Phone']).setValue(noLiRecord.primaryPhone);
  }

  // Original source: Only fill if LinkedIn record is blank (don't concatenate — col has data validation)
  if (noLiRecord.originalSource && !liRecord.originalSource) {
    try {
      hmSheet.getRange(liRecord.rowNum, colMap['Original_Source']).setValue(noLiRecord.originalSource);
    } catch (e) {
      Logger.log(`  Skipped original source (data validation): ${noLiRecord.originalSource}`);
    }
  }

  // --- Step 2: Cascade key updates to all downstream sheets ---
  const oldKey = noLiRecord.key;
  const newKey = liRecord.key;

  cascadeKeyUpdate_(ss, 'HM_Signals_Master', 'Composite Key', oldKey, newKey);
  cascadeKeyUpdate_(ss, 'HM_Interaction_History', 'Composite_Key', oldKey, newKey);
  cascadeKeyUpdate_(ss, 'HM_ContactInfo', 'Composite_Key', oldKey, newKey);
  cascadeKeyUpdate_(ss, 'Placements_Log', 'HM_Composite_Key', oldKey, newKey);
  cascadeKeyUpdate_(ss, 'BD_Contacts', 'Composite Key (view)', oldKey, newKey);

  // --- Step 3: Delete NO_LI row ---
  // Re-find the row (may have shifted if earlier merges deleted rows above)
  const currentData = hmSheet.getDataRange().getValues();
  const keyCol = currentData[0].indexOf('Composite_Key');

  for (let i = 1; i < currentData.length; i++) {
    if (String(currentData[i][keyCol]).trim() === oldKey) {
      hmSheet.deleteRow(i + 1);
      Logger.log(`  Deleted NO_LI row ${i + 1} (${oldKey})`);
      break;
    }
  }

  Logger.log(`  Merged: ${oldKey} → ${newKey}`);
}

/** ==========================================================================
 *  CASCADE KEY UPDATE
 *  ========================================================================== */

/**
 * Update all occurrences of oldKey → newKey in a specific sheet column
 *
 * @param {Spreadsheet} ss
 * @param {string} sheetName - Target sheet name
 * @param {string} headerName - Column header containing composite keys
 * @param {string} oldKey - The NO_LI key to replace
 * @param {string} newKey - The LinkedIn key to replace with
 */
function cascadeKeyUpdate_(ss, sheetName, headerName, oldKey, newKey) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log(`  Cascade skip: ${sheetName} not found`);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(headerName);
  if (col === -1) {
    Logger.log(`  Cascade skip: ${headerName} not found in ${sheetName}`);
    return;
  }

  // Read the key column
  const keyData = sheet.getRange(2, col + 1, lastRow - 1, 1).getValues();
  let updated = 0;

  for (let i = 0; i < keyData.length; i++) {
    if (String(keyData[i][0]).trim() === oldKey) {
      sheet.getRange(i + 2, col + 1).setValue(newKey);
      updated++;
    }
  }

  if (updated > 0) {
    Logger.log(`  Cascade: ${sheetName}.${headerName} — ${updated} rows updated`);
  }
}

/** ==========================================================================
 *  STATUS MANAGEMENT
 *  ========================================================================== */

/**
 * Mark Dedup_Status by row number
 *
 * @param {Sheet} hmSheet
 * @param {number} rowNum - 1-indexed row number
 * @param {string} status - 'NO_MATCH', 'REVIEW', 'MERGED'
 */
function markDedupStatus_(hmSheet, rowNum, status) {
  const headers = hmSheet.getRange(1, 1, 1, hmSheet.getLastColumn()).getValues()[0];
  let col = headers.indexOf('Dedup_Status');

  if (col === -1) {
    hmSheet.getRange(1, headers.length + 1).setValue('Dedup_Status');
    col = headers.length;
  }

  hmSheet.getRange(rowNum, col + 1).setValue(status);
}

/**
 * Mark Dedup_Status by composite key (for review processing)
 *
 * @param {Sheet} hmSheet
 * @param {string} key - Composite key
 * @param {string} status - 'NO_MATCH', 'REVIEW', 'MERGED'
 */
function markDedupStatusByKey_(hmSheet, key, status) {
  const data = hmSheet.getDataRange().getValues();
  const keyCol = data[0].indexOf('Composite_Key');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyCol]).trim() === key) {
      markDedupStatus_(hmSheet, i + 1, status);
      return;
    }
  }

  Logger.log(`  WARNING: Key ${key} not found for status update`);
}

/** ==========================================================================
 *  REVIEW TAB
 *  ========================================================================== */

/**
 * Write fuzzy match to HM_Dedup_Review tab with dropdown
 * Creates the tab if it doesn't exist
 *
 * @param {Spreadsheet} ss
 * @param {Object} noLiRecord - The NO_LI record
 * @param {Array<Object>} topMatches - Top 3 matches [{record, confidence, reason}]
 */
function writeToHMDedupReview_(ss, noLiRecord, topMatches) {
  let reviewSheet = ss.getSheetByName('HM_Dedup_Review');

  if (!reviewSheet) {
    reviewSheet = ss.insertSheet('HM_Dedup_Review');
    const headers = [
      'NO_LI_Key', 'NO_LI_Name', 'NO_LI_Company',
      'Match_1_Name', 'Match_1_Key', 'Match_1_Company', 'Confidence_1',
      'Match_2_Name', 'Match_2_Key', 'Match_2_Company', 'Confidence_2',
      'Match_3_Name', 'Match_3_Key', 'Match_3_Company', 'Confidence_3',
      'Action'
    ];
    reviewSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    reviewSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    reviewSheet.setFrozenRows(1);
  }

  const m1 = topMatches[0];
  const m2 = topMatches[1];
  const m3 = topMatches[2];

  const rowNum = reviewSheet.getLastRow() + 1;

  const row = [
    noLiRecord.key,
    noLiRecord.name,
    noLiRecord.company,
    m1 ? m1.record.name : '', m1 ? m1.record.key : '', m1 ? m1.record.company : '', m1 ? m1.confidence : '',
    m2 ? m2.record.name : '', m2 ? m2.record.key : '', m2 ? m2.record.company : '', m2 ? m2.confidence : '',
    m3 ? m3.record.name : '', m3 ? m3.record.key : '', m3 ? m3.record.company : '', m3 ? m3.confidence : '',
    'Pending Review'
  ];

  reviewSheet.appendRow(row);

  // Dropdown: NO MATCH + each match's LinkedIn key
  const options = ['NO MATCH'];
  if (m1) options.push(m1.record.key);
  if (m2) options.push(m2.record.key);
  if (m3) options.push(m3.record.key);

  const actionCell = reviewSheet.getRange(rowNum, 16); // Col P = Action
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(true)
    .build();
  actionCell.setDataValidation(rule);
}
