/**
 * 90_Gemini_Batch_Enrichment.gs
 * Batch enrichment of Candidate_Master with Gemini Flash parsing
 *
 * PURPOSE: Process structured notes (Prescreen, Phone Interview) to extract skills/quality/comp
 * USAGE: Set up as time-based trigger to run overnight/during off-hours
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs (generateStamp, parseStamp), 00f_Gemini_API.gs
 *
 * ENRICHMENT LOGIC:
 * A candidate needs enrichment when:
 *   1. Last_Enrichment is empty (never processed), OR
 *   2. Last_Import is more recent than Last_Enrichment (new data since last enrichment)
 * Only Bullhorn candidates (with Last_Bullhorn_Contact + Notes_Summary) are eligible.
 */

/**
 * Main batch enrichment function
 * Processes candidates in batches to avoid timeout
 * Uses ALL available data (notes_summary, location) to enrich candidates
 *
 * Safe to run repeatedly — compares Last_Import vs Last_Enrichment timestamps
 */
function runGeminiBatchEnrichment() {
  Logger.log('=== STARTING GEMINI BATCH ENRICHMENT ===');

  const BATCH_SIZE = 50; // Process 50 candidates per run (safe for 6-min timeout)

  try {
    // Check for API key
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not set in Script Properties. Cannot proceed.');
    }

    // Get candidates needing enrichment (full data, not just names)
    const candidatesToEnrich = getCandidatesNeedingEnrichment(BATCH_SIZE);

    if (candidatesToEnrich.length === 0) {
      Logger.log('No candidates need enrichment. All done!');
      return { success: true, processed: 0, remaining: 0 };
    }

    Logger.log(`Found ${candidatesToEnrich.length} candidates needing enrichment`);

    // Generate enrichment stamp once for this entire batch
    const enrichmentStamp = generateStamp('Gemini');

    // Batch read: get sheet, headers, and all candidate rows at once
    const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap = {};
    headers.forEach((h, i) => colMap[h] = i);

    // Read all rows we need in one batch (collect row numbers, read range)
    const rowNumbers = candidatesToEnrich.map(c => c.rowNumber);
    const allData = sheet.getDataRange().getValues();

    // Collect all pending writes
    const pendingWrites = []; // { row, col, value }

    // Process each candidate
    let enriched = 0;
    let skipped = 0;

    for (const candidate of candidatesToEnrich) {
      // Enrich with Gemini using all available data
      const enrichmentData = enrichCandidateWithGemini({
        full_name: candidate.full_name,
        notes_summary: candidate.notes_summary,
        location: candidate.location
      });

      const existingRow = allData[candidate.rowNumber - 1]; // 0-indexed

      if (enrichmentData) {
        // Collect updates (no writes yet)
        const updates = enrichCandidateRow(candidate.rowNumber, enrichmentData, enrichmentStamp, colMap, existingRow);
        updates.forEach(u => pendingWrites.push({ row: candidate.rowNumber, col: u.col, value: u.value }));
        enriched++;
        Logger.log(`Enriched: ${candidate.full_name}`);
      } else {
        // Gemini returned nothing — still stamp so we don't re-process same data
        pendingWrites.push({ row: candidate.rowNumber, col: colMap['Last_Enrichment'] + 1, value: enrichmentStamp });
        Logger.log(`No data extracted for: ${candidate.full_name} (stamped to prevent re-run)`);
        skipped++;
      }

      // Small delay between API calls to avoid rate limiting
      Utilities.sleep(500);
    }

    // Batch write: apply all pending writes at once
    Logger.log(`Writing ${pendingWrites.length} cell updates in batch...`);
    for (const write of pendingWrites) {
      sheet.getRange(write.row, write.col).setValue(write.value);
    }
    SpreadsheetApp.flush(); // Ensure all writes are committed

    // Count remaining candidates
    const remainingCount = countCandidatesNeedingEnrichment() - enriched - skipped;

    Logger.log('=== GEMINI BATCH ENRICHMENT COMPLETE ===');
    Logger.log(`Enriched: ${enriched}, Skipped (no data): ${skipped}, Remaining: ${remainingCount}`);

    return {
      success: true,
      processed: enriched,
      skipped: skipped,
      remaining: remainingCount
    };

  } catch (error) {
    Logger.log(`ERROR in runGeminiBatchEnrichment: ${error.message}`);
    throw error;
  }
}

/**
 * Get candidates needing enrichment based on Last_Import vs Last_Enrichment timestamps
 * A candidate needs enrichment when:
 *   1. Last_Enrichment is empty (never processed), OR
 *   2. Last_Import timestamp is more recent than Last_Enrichment timestamp
 * Only Bullhorn candidates (with Last_Bullhorn_Contact + Notes_Summary) are eligible.
 *
 * @param {number} limit - Max candidates to return
 * @returns {Array<Object>} - Array of { rowNumber, full_name, uid, notes_summary, location }
 */
function getCandidatesNeedingEnrichment(limit) {
  const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const candidates = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const fullName = row[colMap['Full_Name']] || '';
    const uid = row[colMap['UID']] || '';
    const notesSummary = row[colMap['Notes_Summary']] || '';
    const location = row[colMap['Location']] || '';
    const lastBullhornContact = row[colMap['Last_Bullhorn_Contact']] || '';
    const lastImport = row[colMap['Last_Import']] || '';
    const lastEnrichment = row[colMap['Last_Enrichment']] || '';
    const liPersonal = row[colMap['LI_Personal']] || '';

    // Skip LinkedIn-only candidates (no Bullhorn contact = no notes to enrich from)
    if (!fullName || !lastBullhornContact || !notesSummary) continue;

    // Skip personal contacts (LI_Personal = YES)
    if (liPersonal === 'YES') continue;

    // Needs enrichment if: never enriched OR imported after last enrichment
    let needsEnrichment = false;
    if (!lastEnrichment) {
      needsEnrichment = true;
    } else if (lastImport) {
      const importDate = parseStamp(lastImport);
      const enrichDate = parseStamp(lastEnrichment);
      needsEnrichment = importDate > enrichDate;
    }

    if (needsEnrichment) {
      candidates.push({
        rowNumber: i + 1, // 1-indexed
        full_name: fullName,
        uid: uid,
        notes_summary: notesSummary,
        location: location
      });

      if (candidates.length >= limit) break;
    }
  }

  return candidates;
}

/**
 * Count total candidates needing enrichment (same logic as getCandidatesNeedingEnrichment)
 * @returns {number} - Count of candidates needing enrichment
 */
function countCandidatesNeedingEnrichment() {
  const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const fullName = row[colMap['Full_Name']] || '';
    const lastBullhornContact = row[colMap['Last_Bullhorn_Contact']] || '';
    const notesSummary = row[colMap['Notes_Summary']] || '';
    const lastImport = row[colMap['Last_Import']] || '';
    const lastEnrichment = row[colMap['Last_Enrichment']] || '';
    const liPersonal = row[colMap['LI_Personal']] || '';

    if (!fullName || !lastBullhornContact || !notesSummary) continue;

    // Skip personal contacts (LI_Personal = YES)
    if (liPersonal === 'YES') continue;

    if (!lastEnrichment) {
      count++;
    } else if (lastImport) {
      const importDate = parseStamp(lastImport);
      const enrichDate = parseStamp(lastEnrichment);
      if (importDate > enrichDate) count++;
    }
  }

  return count;
}


/**
 * Enrich candidate row with Gemini-extracted data and stamp Last_Enrichment
 * Uses batch-friendly approach: reads existing values once, returns update array
 * Caller is responsible for writing updates via setValues()
 *
 * @param {number} rowNumber - Row number in Candidate_Master (1-indexed)
 * @param {Object} enrichmentData - { current_title, current_company, key_skills, quality_tier, normalized_location, comp_target }
 * @param {string} enrichmentStamp - Pre-generated stamp string (e.g., "Gemini 10.02.2026 06:41")
 * @param {Object} colMap - Column mapping from headers
 * @param {Array} existingRow - Current row data from batch read
 * @returns {Array<Object>} - Array of { col, value } updates to apply
 */
function enrichCandidateRow(rowNumber, enrichmentData, enrichmentStamp, colMap, existingRow) {
  const updates = [];

  // Update Current_Title if extracted AND current value is empty
  if (enrichmentData.current_title && !existingRow[colMap['Current_Title']]) {
    updates.push({ col: colMap['Current_Title'] + 1, value: enrichmentData.current_title });
  }

  // Update Current_Company if extracted AND current value is empty
  if (enrichmentData.current_company && !existingRow[colMap['Current_Company']]) {
    updates.push({ col: colMap['Current_Company'] + 1, value: enrichmentData.current_company });
  }

  // Update Key_Skills if extracted
  if (enrichmentData.key_skills) {
    updates.push({ col: colMap['Key_Skills'] + 1, value: enrichmentData.key_skills });
  }

  // Update Quality_Tier if extracted
  if (enrichmentData.quality_tier) {
    updates.push({ col: colMap['Quality_Tier'] + 1, value: enrichmentData.quality_tier });
  }

  // Update Location with normalized value if extracted (overwrites raw regex location)
  if (enrichmentData.normalized_location) {
    updates.push({ col: colMap['Location'] + 1, value: enrichmentData.normalized_location });
  }

  // Update Comp_Target if extracted AND current value is empty
  if (enrichmentData.comp_target && !existingRow[colMap['Comp_Target']]) {
    updates.push({ col: colMap['Comp_Target'] + 1, value: enrichmentData.comp_target });
  }

  // Stamp Last_Enrichment
  updates.push({ col: colMap['Last_Enrichment'] + 1, value: enrichmentStamp });

  return updates;
}

