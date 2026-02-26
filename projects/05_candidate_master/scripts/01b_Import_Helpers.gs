/**
 * @file 01b_Import_Helpers.gs
 * Supporting functions for Bullhorn notes import and UPSERT logic
 *
 * PURPOSE: Data transformation, note filtering, candidate extraction, and UPSERT helpers
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00d_Name_Matching.gs, 00e_Note_Parsers.gs
 *
 * NOTE: These functions are called by orchestrators in 01_Initial_Import.gs
 * and by 02_Incremental_Import.gs. Do not rename without updating callers.
 *
 * LinkedIn processing and string utilities: see 01c_Import_LinkedIn_Helpers.gs
 *
 * @execution manual
 */

// ============================================
// NOTES ARCHIVE
// ============================================

/**
 * Write all notes to Notes_Archive tab
 * @param {Array<Object>} notes - Array of note objects
 */
function writeNotesToArchive(notes) {
  const sheet = getSheetByName(TAB_NOTES_ARCHIVE);
  const rows = [];

  for (const note of notes) {
    rows.push([
      note['Date Note Added'] || '',
      note['About'] || '',
      note['Note Author'] || '',
      note['Note Type'] || '',
      note['Note Action'] || '',
      note['Status'] || '',
      note['Note Body'] || ''
    ]);
  }

  if (rows.length > 0) {
    // Append after existing data (not overwrite from row 2)
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 7).setValues(rows);
    Logger.log(`Appended ${rows.length} notes to Notes_Archive (starting at row ${startRow})`);
  }
}

// ============================================
// NOTE FILTERING
// ============================================

/**
 * Determine if note should be skipped (outbound emails, simple rejections)
 * @param {string} noteBody - Note body text
 * @returns {boolean} - True if note should be skipped
 */
function shouldSkipNote(noteBody) {
  if (!noteBody) return true;

  // Always keep if note contains a candidate email (not ARG domain)
  const candidateEmail = parseEmailFromNote(noteBody);
  if (candidateEmail) return false; // Has candidate email, keep it

  // Always keep if note contains a phone number
  const phoneNumber = parsePhoneFromNote(noteBody);
  if (phoneNumber) return false; // Has phone number, keep it

  // Check if it's a simple rejection (skip these)
  const rejectionPhrases = [
    'is not interested in learning more at this time',
    'is not interested at this time',
    'not interested right now',
    'not looking at this time'
  ];

  for (const phrase of rejectionPhrases) {
    if (noteBody.toLowerCase().includes(phrase.toLowerCase())) {
      return true; // Skip simple rejections
    }
  }

  // Keep outbound emails that contain recruiting context (role details, client info)
  const recruitingContextIndicators = [
    'opportunity', 'role', 'position', 'client', 'company',
    'seeking', 'looking for', 'requirements', 'responsibilities',
    'salary', 'comp', 'benefits', 'publicly traded', 'startup'
  ];

  for (const indicator of recruitingContextIndicators) {
    if (noteBody.toLowerCase().includes(indicator)) {
      return false; // Keep notes with recruiting context
    }
  }

  // Skip very short notes (likely administrative/scheduling)
  if (noteBody.length < 100) {
    return true;
  }

  return false; // Default: keep the note
}

// ============================================
// CANDIDATE EXTRACTION
// ============================================

/**
 * Extract unique candidates from notes
 * @param {Array<Object>} notes - Array of note objects
 * @returns {Array<Object>} - Array of unique candidate objects
 */
function extractCandidatesFromNotes(notes) {
  // Sort notes by date DESC to get most recent first
  notes.sort((a, b) => {
    const dateA = new Date(a['Date Note Added'] || '1900-01-01');
    const dateB = new Date(b['Date Note Added'] || '1900-01-01');
    return dateB - dateA; // Descending
  });

  // Phase 1: Group all substantive notes by candidate
  const candidateNotesMap = {}; // Key: candidate name, Value: array of notes

  for (const note of notes) {
    const candidateName = (note['About'] || '').trim();
    if (!candidateName) continue;

    const noteBody = note['Note Body'] || '';

    // Skip notes based on filter
    if (shouldSkipNote(noteBody)) continue;

    // Add note to candidate's collection
    if (!candidateNotesMap[candidateName]) {
      candidateNotesMap[candidateName] = [];
    }
    candidateNotesMap[candidateName].push(note);
  }

  // Phase 2: Build candidate objects with concatenated notes
  const candidates = [];

  for (const [candidateName, candidateNotes] of Object.entries(candidateNotesMap)) {
    // Use most recent note for primary data extraction
    const mostRecentNote = candidateNotes[0];
    const noteBody = mostRecentNote['Note Body'] || '';
    const noteAction = mostRecentNote['Note Action'] || '';
    const status = mostRecentNote['Status'] || 'New Lead';
    const lastContact = mostRecentNote['Date Note Added'] || '';

    // Extract contact data from most recent note
    // NOTE: comp and location removed from regex extraction (2026-02-08)
    // These fields are now handled by Gemini enrichment (90_Gemini_Batch_Enrichment.gs)
    const email = parseEmailFromNote(noteBody);
    const phone = parsePhoneFromNote(noteBody);

    // Build concatenated notes summary (date + snippet for each note)
    // Prescreen and Phone Interview notes get full body (gold-standard data)
    // All other note types get 200-char snippets to keep token costs down
    const HIGH_VALUE_NOTE_TYPES = ['Prescreen', 'Candidate-Phone Interview'];

    const notesSummary = candidateNotes.map(n => {
      const date = n['Date Note Added'] || '';
      const noteAction = n['Note Action'] || '';
      const rawBody = n['Note Body'] || '';

      const isHighValue = HIGH_VALUE_NOTE_TYPES.some(t =>
        noteAction.toLowerCase().includes(t.toLowerCase())
      );
      const body = isHighValue ? rawBody : rawBody.substring(0, 200);

      return `[${date}] ${body}`;
    }).join('\n\n');

    // Create candidate object
    const candidate = {
      full_name: candidateName,
      email: email || '',
      phone: phone || '',
      linkedin_url: '',
      current_title: '',
      current_company: '',
      status: status,
      last_bullhorn_contact: lastContact,
      comp_target: '',  // Gemini enrichment handles this
      location: '',     // Gemini enrichment handles this
      key_skills: '',
      quality_tier: '',
      notes_summary: notesSummary
    };

    candidate.uid = generateUID(candidate);
    candidates.push(candidate);
  }

  return candidates;
}

// ============================================
// UPSERT LOGIC (CANDIDATE_MASTER)
// ============================================

/**
 * Write candidates to Candidate_Master tab (UPSERT logic)
 * @param {Array<Object>} candidates - Array of candidate objects
 * @param {string} importPrefix - Import type prefix for Last_Import stamp (e.g., IMPORT_PREFIX_BH_NOTES)
 */
function writeCandidatesToMaster(candidates, importPrefix) {
  const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
  const importStamp = importPrefix ? generateStamp(importPrefix) : '';

  // Get existing data
  const existingData = sheet.getDataRange().getValues();
  const headers = existingData[0];
  const uidColIndex = headers.indexOf('UID');

  // Build map of existing UIDs to row numbers
  const existingUIDs = {};
  for (let i = 1; i < existingData.length; i++) {
    const uid = existingData[i][uidColIndex];
    if (uid) {
      existingUIDs[uid] = i + 1; // 1-indexed row number
    }
  }

  let insertCount = 0;
  let updateCount = 0;
  const rowsToInsert = [];

  for (const cand of candidates) {
    const existingRow = existingUIDs[cand.uid];

    if (existingRow) {
      // UPDATE existing record
      updateExistingCandidate(sheet, existingRow, cand, existingData[existingRow - 1], importStamp);
      updateCount++;
    } else {
      // INSERT new record (24 columns: A-W + X)
      rowsToInsert.push([
        cand.uid,
        cand.full_name,
        cand.current_title,
        cand.current_company,
        cand.linkedin_url,
        cand.email,
        cand.phone || '',
        cand.status,
        '', // Last_LinkedIn_Refresh
        cand.last_bullhorn_contact,
        cand.comp_target,
        cand.location,
        '', // Region (col 13, NEW)
        '', // Tech_Stack
        cand.key_skills || '',
        cand.quality_tier || '',
        '', // Drive_Folder_Link
        false, // Has_Resume
        false, // Has_DeepDive
        cand.notes_summary,
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

  Logger.log(`UPSERT complete: ${insertCount} inserted, ${updateCount} updated`);
}

/**
 * Update existing candidate record with merge logic
 * @param {Sheet} sheet - Candidate_Master sheet
 * @param {number} rowNum - Row number to update (1-indexed)
 * @param {Object} newData - New candidate data
 * @param {Array} existingRow - Existing row values
 * @param {string} importStamp - Import stamp for Last_Import column (e.g., "BHNotes 08.02.2026 09:04")
 */
function updateExistingCandidate(sheet, rowNum, newData, existingRow, importStamp) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  // MERGE STRATEGY: Only fill empty fields (don't overwrite existing data)
  // Exception: Last_Bullhorn_Contact (always update to most recent)
  const updates = [];

  if (!existingRow[colMap['Email']] && newData.email) {
    updates.push({ col: colMap['Email'] + 1, value: newData.email });
  }
  if (!existingRow[colMap['Phone']] && newData.phone) {
    updates.push({ col: colMap['Phone'] + 1, value: newData.phone });
  }
  if (!existingRow[colMap['Location']] && newData.location) {
    updates.push({ col: colMap['Location'] + 1, value: newData.location });
  }
  if (!existingRow[colMap['Comp_Target']] && newData.comp_target) {
    updates.push({ col: colMap['Comp_Target'] + 1, value: newData.comp_target });
  }
  if (!existingRow[colMap['Key_Skills']] && newData.key_skills) {
    updates.push({ col: colMap['Key_Skills'] + 1, value: newData.key_skills });
  }
  if (!existingRow[colMap['Quality_Tier']] && newData.quality_tier) {
    updates.push({ col: colMap['Quality_Tier'] + 1, value: newData.quality_tier });
  }

  // Always update Last_Bullhorn_Contact if new data is more recent
  const existingDate = new Date(existingRow[colMap['Last_Bullhorn_Contact']] || '1900-01-01');
  const newDate = new Date(newData.last_bullhorn_contact || '1900-01-01');
  if (newDate > existingDate) {
    updates.push({ col: colMap['Last_Bullhorn_Contact'] + 1, value: newData.last_bullhorn_contact });
    updates.push({ col: colMap['Notes_Summary'] + 1, value: newData.notes_summary });
  }

  // Stamp Last_Import whenever we touch the record
  if (importStamp && updates.length > 0) {
    updates.push({ col: colMap['Last_Import'] + 1, value: importStamp });
  }

  // Apply updates
  for (const update of updates) {
    sheet.getRange(rowNum, update.col).setValue(update.value);
  }

  if (updates.length > 0) {
    Logger.log(`Updated ${updates.length} fields for ${newData.full_name}`);
  }
}

// LinkedIn processing and string utilities: see 01c_Import_LinkedIn_Helpers.gs
