/**
 * @file 01c_Import_LinkedIn_Helpers.gs
 * LinkedIn UPSERT logic and string utility functions for import pipeline
 *
 * PURPOSE: Processing LinkedIn CSV connections, updating LinkedIn-specific fields,
 *          and shared string utilities (phone normalization, title case)
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs
 *
 * NOTE: These functions are called by 01_Initial_Import.gs and 02_Incremental_Import.gs.
 * Core BH notes + UPSERT helpers: see 01b_Import_Helpers.gs
 * Do not rename without updating callers.
 *
 * @execution manual
 */

// ============================================
// LINKEDIN PROCESSING
// ============================================

/**
 * Process LinkedIn connections with UPSERT logic
 * @param {Array<Object>} linkedInData - LinkedIn CSV data
 * @param {Object} existingByLinkedIn - Lookup map by LinkedIn_URL
 * @param {Object} existingByEmail - Lookup map by Email
 * @returns {Object} - {updated: number, inserted: number}
 */
function processLinkedInConnections(linkedInData, existingByLinkedIn, existingByEmail) {
  const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const importStamp = generateStamp(IMPORT_PREFIX_LINKEDIN);

  let updateCount = 0;
  let insertCount = 0;
  const rowsToInsert = [];

  for (const linkedin of linkedInData) {
    const linkedinUrl = linkedin['URL'] || '';
    const email = linkedin['Email Address'] || '';
    const firstName = linkedin['First Name'] || '';
    const lastName = linkedin['Last Name'] || '';
    const fullName = `${lastName}, ${firstName}`.trim();
    const company = linkedin['Company'] || '';
    const position = linkedin['Position'] || '';
    const connectedOn = linkedin['Connected On'] || '';

    // Try to find existing record by LinkedIn URL or Email
    let existingRecord = null;
    if (linkedinUrl && existingByLinkedIn[linkedinUrl]) {
      existingRecord = existingByLinkedIn[linkedinUrl];
    } else if (email && existingByEmail[email]) {
      existingRecord = existingByEmail[email];
    }

    if (existingRecord) {
      // UPDATE existing record
      updateLinkedInFields(sheet, existingRecord._rowNum, {
        linkedin_url: linkedinUrl,
        email: email,
        current_title: position,
        current_company: company,
        last_linkedin_refresh: new Date()
      }, existingRecord, importStamp);
      updateCount++;

    } else {
      // INSERT new skeleton profile (24 columns: A through X)
      const newCandidate = {
        full_name: fullName,
        email: email,
        linkedin_url: linkedinUrl,
        current_title: position,
        current_company: company,
        status: 'New Lead',
        last_bullhorn_contact: '',
        comp_target: '',
        location: '',
        notes_summary: `LinkedIn connection added on ${connectedOn}`
      };
      newCandidate.uid = generateUID(newCandidate);

      rowsToInsert.push([
        newCandidate.uid,
        newCandidate.full_name,
        newCandidate.current_title,
        newCandidate.current_company,
        newCandidate.linkedin_url,
        newCandidate.email,
        '', // Phone
        newCandidate.status,
        new Date(), // Last_LinkedIn_Refresh
        '', // Last_Bullhorn_Contact
        '', // Comp_Target
        '', // Location
        '', // Region (col 13, NEW)
        '', // Tech_Stack
        '', // Key_Skills
        '', // Quality_Tier
        '', // Drive_Folder_Link
        false, // Has_Resume
        false, // Has_DeepDive
        newCandidate.notes_summary,
        '', // Historical_Titles
        '', // Match_Status
        importStamp, // Last_Import (W)
        ''  // Last_Enrichment (X)
      ]);
      insertCount++;
    }
  }

  // Batch insert new rows (24 columns: A through X)
  if (rowsToInsert.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToInsert.length, 24).setValues(rowsToInsert);
  }

  return { updated: updateCount, inserted: insertCount };
}

/**
 * Update LinkedIn-specific fields for existing candidate
 * @param {Sheet} sheet - Candidate_Master sheet
 * @param {number} rowNum - Row number (1-indexed)
 * @param {Object} newData - New LinkedIn data
 * @param {Object} existingRecord - Existing record data
 * @param {string} importStamp - Import stamp for Last_Import column
 */
function updateLinkedInFields(sheet, rowNum, newData, existingRecord, importStamp) {
  const colLinkedInURL = getColumnIndex(sheet, 'LinkedIn_URL') + 1;
  const colEmail = getColumnIndex(sheet, 'Email') + 1;
  const colCurrentTitle = getColumnIndex(sheet, 'Current_Title') + 1;
  const colCurrentCompany = getColumnIndex(sheet, 'Current_Company') + 1;
  const colLastRefresh = getColumnIndex(sheet, 'Last_LinkedIn_Refresh') + 1;
  const colLastImport = getColumnIndex(sheet, 'Last_Import') + 1;

  let changed = false;

  if (!existingRecord['LinkedIn_URL'] && newData.linkedin_url) {
    sheet.getRange(rowNum, colLinkedInURL).setValue(newData.linkedin_url);
    changed = true;
  }
  if (!existingRecord['Email'] && newData.email) {
    sheet.getRange(rowNum, colEmail).setValue(newData.email);
    changed = true;
  }
  if (!existingRecord['Current_Title'] && newData.current_title) {
    sheet.getRange(rowNum, colCurrentTitle).setValue(newData.current_title);
    changed = true;
  }
  if (!existingRecord['Current_Company'] && newData.current_company) {
    sheet.getRange(rowNum, colCurrentCompany).setValue(newData.current_company);
    changed = true;
  }

  // Always update Last_LinkedIn_Refresh
  sheet.getRange(rowNum, colLastRefresh).setValue(newData.last_linkedin_refresh);

  // Stamp Last_Import if any data changed
  if (changed && importStamp) {
    sheet.getRange(rowNum, colLastImport).setValue(importStamp);
  }

  Logger.log(`Updated LinkedIn fields for row ${rowNum}`);
}

// ============================================
// STRING UTILITIES
// ============================================

/**
 * Normalize phone number to XXX-XXX-XXXX format
 * Handles: +1 626-822-1430, (949) 444-1790, +1 424 302 2656
 * @param {string} phone - Raw phone string
 * @returns {string} - Normalized phone or empty string
 */
function normalizePhoneNumber(phone) {
  if (!phone) return '';

  // Strip everything except digits
  const digits = phone.replace(/\D/g, '');

  // Handle country code: 11 digits starting with 1
  let tenDigits = digits;
  if (digits.length === 11 && digits.startsWith('1')) {
    tenDigits = digits.substring(1);
  }

  if (tenDigits.length !== 10) return '';

  return `${tenDigits.slice(0, 3)}-${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

/**
 * Convert string to Title Case
 * Handles: "NOIELLA ELIEH" -> "Noiella Elieh", "austin cheng" -> "Austin Cheng"
 * @param {string} str - Input string
 * @returns {string} - Title cased string
 */
function toTitleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
