/**
 * 05_Enrichment.gs
 * Enrich candidates from Drive folder contents (Tags.json + DeepDive.md)
 *
 * @execution manual, scheduled
 * STATUS: PRODUCTION
 * PURPOSE: Extract structured data from candidate folders into Candidate_Master
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00f_Gemini_API.gs
 *
 * ENRICHMENT PRIORITY:
 * 1. Tags.json (structured JSON, free, instant) → Tech_Stack, Key_Skills, Comp_Target, Location
 * 2. DeepDive.md + Gemini Pro → Historical_Titles, Quality_Tier (always when DeepDive exists)
 * 3. DeepDive.md + Gemini Pro (full extraction) → all fields when NO Tags.json
 */

/**
 * Main orchestrator for selective candidate enrichment
 * Processes candidates in batches with timeout protection
 * @param {string[]} uids - UIDs to enrich (empty = all with Drive folders)
 * @param {number} startTime - Date.now() from caller for coordinated timeout
 * @returns {Object} - { enriched, skipped, partial }
 */
function runSelectiveEnrichment(uids, startTime) {
  if (!startTime) startTime = Date.now();
  Logger.log('=== STARTING SELECTIVE ENRICHMENT ===');

  try {
    // 1. Load Candidate_Master data
    const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
    const existingData = sheet.getDataRange().getValues();
    const headers = existingData[0];
    const colMap = {};
    headers.forEach((header, idx) => { colMap[header] = idx; });

    // 2. Identify candidates to enrich
    const candidatesToEnrich = (uids && uids.length > 0)
      ? filterCandidatesByUIDs(existingData, colMap, uids)
      : getAllCandidatesWithDriveFolders(existingData, colMap);

    Logger.log(`Candidates to enrich: ${candidatesToEnrich.length}`);
    if (candidatesToEnrich.length === 0) {
      return { enriched: 0, skipped: 0, partial: false };
    }

    // 3. Process in batches with timeout coordination
    let enriched = 0;
    let skipped = 0;
    let partial = false;

    // Collect all updates for batch write
    // Column indices for fields we write
    const writeColumns = {
      tech_stack: colMap['Tech_Stack'],
      key_skills: colMap['Key_Skills'],
      quality_tier: colMap['Quality_Tier'],
      comp_target: colMap['Comp_Target'],
      location: colMap['Location'],
      historical_titles: colMap['Historical_Titles'],
      last_enrichment: colMap['Last_Enrichment']
    };

    // Updates array: { rowNumber, field, value }
    const pendingUpdates = [];

    for (let i = 0; i < candidatesToEnrich.length; i++) {
      // Timeout check between candidates
      if (Date.now() - startTime > TIMEOUT_BUDGET_MS) {
        Logger.log(`  TIMEOUT: ${((Date.now() - startTime) / 1000).toFixed(0)}s elapsed. Stopping at candidate ${i}/${candidatesToEnrich.length}.`);
        partial = true;
        break;
      }

      if (i > 0 && i % 10 === 0) {
        Logger.log(`  Enriching candidate ${i}/${candidatesToEnrich.length}...`);
      }

      const candidate = candidatesToEnrich[i];
      const result = enrichCandidateFromDrive(candidate, existingData, colMap);

      if (result.updated) {
        enriched++;
        // Collect field updates
        for (const update of result.updates) {
          pendingUpdates.push({
            rowNumber: candidate.rowNumber,
            colIndex: writeColumns[update.field],
            value: update.value
          });
        }
      } else {
        skipped++;
      }
    }

    // 4. Batch write all collected updates
    if (pendingUpdates.length > 0) {
      Logger.log(`  Writing ${pendingUpdates.length} cell updates...`);
      for (const update of pendingUpdates) {
        sheet.getRange(update.rowNumber, update.colIndex + 1).setValue(update.value);
      }
      SpreadsheetApp.flush();
      Logger.log(`  Batch write complete.`);
    }

    Logger.log(`=== ENRICHMENT COMPLETE: ${enriched} enriched, ${skipped} skipped${partial ? ' (PARTIAL - timeout)' : ''} ===`);
    return { enriched, skipped, partial };

  } catch (error) {
    Logger.log(`ERROR in runSelectiveEnrichment: ${error.message}`);
    logError('ENRICHMENT_FAIL', error.message, 'runSelectiveEnrichment');
    throw error;
  }
}

/**
 * Filter candidates by provided UIDs
 * @param {Array[]} existingData - Full sheet data
 * @param {Object} colMap - Header → column index
 * @param {string[]} uids - UIDs to filter
 * @returns {Array<Object>} - Candidate objects with rowNumber, uid, fullName, driveLink
 */
function filterCandidatesByUIDs(existingData, colMap, uids) {
  const uidSet = new Set(uids);
  const candidates = [];

  for (let i = 1; i < existingData.length; i++) {
    const row = existingData[i];
    const uid = row[colMap['UID']] || '';
    const driveLink = row[colMap['Drive_Folder_Link']] || '';
    const liPersonal = row[colMap['LI_Personal']] || '';

    // Skip personal contacts (LI_Personal = YES)
    if (liPersonal === 'YES') continue;

    if (uidSet.has(uid) && driveLink) {
      candidates.push({
        rowNumber: i + 1,
        uid: uid,
        fullName: row[colMap['Full_Name']] || '',
        driveLink: driveLink
      });
    }
  }

  return candidates;
}

/**
 * Get all candidates with Drive_Folder_Link populated
 * Skips candidates already enriched (Last_Enrichment starts with "Tags" or "DeepDive")
 * @param {Array[]} existingData - Full sheet data
 * @param {Object} colMap - Header → column index
 * @returns {Array<Object>}
 */
function getAllCandidatesWithDriveFolders(existingData, colMap) {
  const candidates = [];

  for (let i = 1; i < existingData.length; i++) {
    const row = existingData[i];
    const driveLink = row[colMap['Drive_Folder_Link']] || '';
    const lastEnrichment = String(row[colMap['Last_Enrichment']] || '');
    const liPersonal = row[colMap['LI_Personal']] || '';

    if (!driveLink) continue;

    // Skip personal contacts (LI_Personal = YES)
    if (liPersonal === 'YES') continue;

    // Skip if already enriched from Drive content
    if (lastEnrichment.startsWith(IMPORT_PREFIX_TAGS) || lastEnrichment.startsWith(IMPORT_PREFIX_DEEPDIVE)) {
      continue;
    }

    candidates.push({
      rowNumber: i + 1,
      uid: row[colMap['UID']] || '',
      fullName: row[colMap['Full_Name']] || '',
      driveLink: driveLink
    });
  }

  return candidates;
}

/**
 * Enrich single candidate from their Drive folder
 * Priority: Tags.json (structured) → DeepDive.md (Gemini extraction)
 *
 * @param {Object} candidate - { rowNumber, uid, fullName, driveLink }
 * @param {Array[]} existingData - Full sheet data (for checking existing values)
 * @param {Object} colMap - Header → column index
 * @returns {Object} - { updated: boolean, updates: [{field, value}] }
 */
function enrichCandidateFromDrive(candidate, existingData, colMap) {
  try {
    const folderId = extractFolderIdFromUrl(candidate.driveLink);
    if (!folderId) {
      Logger.log(`  Invalid Drive URL for ${candidate.fullName}`);
      return { updated: false, updates: [] };
    }

    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();

    let tagsContent = null;
    let deepDiveContent = null;
    let deepDiveFile = null;
    let deepDiveLastUpdated = null;

    // Scan folder files
    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();

      // Tags.json — structured data from Colab
      if (/_Tags\.json$/i.test(fileName)) {
        try {
          tagsContent = JSON.parse(file.getBlob().getDataAsString());
        } catch (e) {
          Logger.log(`  WARNING: Failed to parse Tags.json for ${candidate.fullName}: ${e.message}`);
        }
      }

      // DeepDive.md — pick newest version if multiple exist
      if (/DeepDive.*\.md$/i.test(fileName)) {
        const lastUpdated = file.getLastUpdated();
        if (!deepDiveFile || lastUpdated > deepDiveLastUpdated) {
          deepDiveFile = file;
          deepDiveLastUpdated = lastUpdated;
        }
      }
    }

    if (!tagsContent && !deepDiveFile) {
      return { updated: false, updates: [] };
    }

    // Read DeepDive content if file exists
    if (deepDiveFile) {
      deepDiveContent = deepDiveFile.getBlob().getDataAsString();
    }

    const row = existingData[candidate.rowNumber - 1];
    const updates = [];
    let stampPrefix = '';

    // --- PATH A: Tags.json exists (always has DeepDive too) ---
    if (tagsContent) {
      stampPrefix = IMPORT_PREFIX_TAGS;

      // Tech_Stack from SOFTWARE array
      const techStack = (tagsContent.SOFTWARE || []).join('; ');
      if (techStack && !row[colMap['Tech_Stack']]) {
        updates.push({ field: 'tech_stack', value: techStack });
      }

      // Key_Skills from TECHNICAL + SKILLS arrays
      const keySkills = [...(tagsContent.TECHNICAL || []), ...(tagsContent.SKILLS || [])].join('; ');
      if (keySkills && !row[colMap['Key_Skills']]) {
        updates.push({ field: 'key_skills', value: keySkills });
      }

      // Comp_Target from COMP_TARGET array
      const compTarget = (tagsContent.COMP_TARGET || []).join('; ');
      if (compTarget && !row[colMap['Comp_Target']]) {
        updates.push({ field: 'comp_target', value: compTarget });
      }

      // Location from LOCATION array
      const location = (tagsContent.LOCATION || []).join('; ');
      if (location && !row[colMap['Location']]) {
        updates.push({ field: 'location', value: location });
      }

      // Quality_Tier from CERTIFICATIONS — CPA = A-tier signal
      if (!row[colMap['Quality_Tier']]) {
        const certs = (tagsContent.CERTIFICATIONS || []).join(' ').toLowerCase();
        if (certs.includes('cpa')) {
          updates.push({ field: 'quality_tier', value: 'A' });
        }
      }

      // Historical_Titles + refined Quality_Tier from DeepDive via Gemini (narrower prompt)
      if (deepDiveContent) {
        const geminiResult = extractHistoricalTitlesWithGemini(deepDiveContent);
        if (geminiResult) {
          if (geminiResult.historical_titles && !row[colMap['Historical_Titles']]) {
            updates.push({ field: 'historical_titles', value: geminiResult.historical_titles });
          }
          // Gemini Quality_Tier overrides Tags-derived tier (more context = better assessment)
          if (geminiResult.quality_tier && !row[colMap['Quality_Tier']]) {
            // Remove any Tags-derived quality_tier we may have added above
            const existingQTUpdate = updates.findIndex(u => u.field === 'quality_tier');
            if (existingQTUpdate >= 0) {
              updates[existingQTUpdate].value = geminiResult.quality_tier;
            } else {
              updates.push({ field: 'quality_tier', value: geminiResult.quality_tier });
            }
          }
        }
      }
    }
    // --- PATH B: DeepDive only (no Tags.json) — full Gemini extraction ---
    else if (deepDiveContent) {
      stampPrefix = IMPORT_PREFIX_DEEPDIVE;

      const geminiResult = extractDeepDiveWithGemini(deepDiveContent);
      if (geminiResult) {
        if (geminiResult.tech_stack && !row[colMap['Tech_Stack']]) {
          updates.push({ field: 'tech_stack', value: geminiResult.tech_stack });
        }
        if (geminiResult.key_skills && !row[colMap['Key_Skills']]) {
          updates.push({ field: 'key_skills', value: geminiResult.key_skills });
        }
        if (geminiResult.quality_tier && !row[colMap['Quality_Tier']]) {
          updates.push({ field: 'quality_tier', value: geminiResult.quality_tier });
        }
        if (geminiResult.historical_titles && !row[colMap['Historical_Titles']]) {
          updates.push({ field: 'historical_titles', value: geminiResult.historical_titles });
        }
      }
    }

    // Stamp Last_Enrichment regardless of whether fields were written (prevents re-processing)
    if (stampPrefix) {
      updates.push({ field: 'last_enrichment', value: generateStamp(stampPrefix) });
    }

    if (updates.length > 0) {
      Logger.log(`  Enriched: ${candidate.fullName} (${stampPrefix}, ${updates.length - 1} fields + stamp)`);
    }

    return { updated: updates.length > 0, updates };

  } catch (error) {
    Logger.log(`  Error enriching ${candidate.fullName}: ${error.message}`);
    return { updated: false, updates: [] };
  }
}

/**
 * Extract folder ID from Drive URL
 * Supports: /folders/FOLDER_ID and /drive/u/0/folders/FOLDER_ID
 * @param {string} url - Drive folder URL
 * @returns {string|null} - Folder ID or null
 */
function extractFolderIdFromUrl(url) {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
