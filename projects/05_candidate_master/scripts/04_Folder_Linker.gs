/**
 * 04_Folder_Linker.gs
 * Link existing Drive folders to Candidate_Master records
 *
 * @execution manual, scheduled
 * STATUS: PRODUCTION
 * PURPOSE: Match ~68-500 candidate folders by name, scan contents, trigger enrichment
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00d_Name_Matching.gs, 05_Enrichment.gs
 */

/**
 * Main orchestrator for linking Drive folders to candidates
 * Single-pass: list folders → match names → scan contents → batch write → enrich
 * @returns {Object} - { linked, alreadyLinked, unmatchedFolders, unmatchedFolderNames, enriched, enrichedPartial }
 */
function runFolderLinker() {
  const startTime = Date.now();
  Logger.log('=== STARTING FOLDER LINKER ===');

  try {
    // 1. Get all candidate subfolders from Drive
    let candidateFolders = getCandidateFolders();
    Logger.log(`Found ${candidateFolders.length} candidate folders in Drive`);

    if (candidateFolders.length > MAX_FOLDERS_PER_RUN) {
      Logger.log(`WARNING: ${candidateFolders.length} folders found. Processing first ${MAX_FOLDERS_PER_RUN}.`);
      candidateFolders = candidateFolders.slice(0, MAX_FOLDERS_PER_RUN);
    }

    // 2. Load Candidate_Master data (one read)
    const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
    const existingData = sheet.getDataRange().getValues();
    const headers = existingData[0];
    const colMap = {};
    headers.forEach((header, idx) => { colMap[header] = idx; });

    // 3. Build lookup structures
    const candidateNameMap = buildCandidateNameMap(existingData, colMap);
    const lastNameIndex = buildLastNameIndex(existingData, colMap);
    const existingLinksSet = buildExistingLinksSet(existingData, colMap);

    // 4. Match folders to candidates
    let linked = 0;
    let alreadyLinked = 0;
    const unmatchedFolderNames = [];
    const linkedUids = []; // UIDs that were just linked (for enrichment)

    // Pre-read columns P (Drive_Folder_Link), Q (Has_Resume), R (Has_DeepDive) for batch write
    const lastRow = existingData.length;
    const colP = colMap['Drive_Folder_Link'];
    const colQ = colMap['Has_Resume'];
    const colR = colMap['Has_DeepDive'];

    // Build update arrays from existing data (preserve non-updated rows)
    const updateP = existingData.slice(1).map(row => [row[colP] || '']);
    const updateQ = existingData.slice(1).map(row => [row[colQ] || '']);
    const updateR = existingData.slice(1).map(row => [row[colR] || '']);

    for (let i = 0; i < candidateFolders.length; i++) {
      const folder = candidateFolders[i];

      // Progress logging every 10 folders
      if (i > 0 && i % 10 === 0) {
        Logger.log(`  Processing folder ${i}/${candidateFolders.length}...`);
      }

      // Skip folders already linked to any candidate
      if (existingLinksSet.has(folder.url)) {
        alreadyLinked++;
        continue;
      }

      // Match folder name to candidate
      const match = findBestCandidateMatch(folder.name, candidateNameMap, lastNameIndex);

      if (match) {
        // Scan folder contents
        const contents = scanFolderContents(folder.id);

        // Update batch arrays (match.rowIndex is 0-based index into data rows, excluding header)
        const dataIdx = match.rowIndex;
        updateP[dataIdx] = [folder.url];
        updateQ[dataIdx] = [contents.hasResume ? 'TRUE' : (updateQ[dataIdx][0] || '')];
        updateR[dataIdx] = [contents.hasDeepDive ? 'TRUE' : (updateR[dataIdx][0] || '')];

        linked++;
        linkedUids.push({
          uid: match.uid,
          rowIndex: dataIdx,
          hasDeepDive: contents.hasDeepDive,
          hasTags: contents.hasTags
        });

        Logger.log(`  Linked: "${folder.name}" -> row ${match.rowIndex + 2} (${match.matchTier})`);
      } else {
        unmatchedFolderNames.push(folder.name);
      }
    }

    // 5. Batch write (one write per column)
    if (linked > 0) {
      sheet.getRange(2, colP + 1, lastRow - 1, 1).setValues(updateP);
      sheet.getRange(2, colQ + 1, lastRow - 1, 1).setValues(updateQ);
      sheet.getRange(2, colR + 1, lastRow - 1, 1).setValues(updateR);
      Logger.log(`  Batch write complete: ${linked} rows updated across 3 columns`);
    }

    // 6. Log results
    logImport(
      "Folder Link",
      CANDIDATES_FOLDER_ID,
      candidateFolders.length,
      linked,
      "Success",
      `Linked: ${linked}, Skipped: ${alreadyLinked}, Unmatched: ${unmatchedFolderNames.join(', ')}`
    );

    if (unmatchedFolderNames.length > 0) {
      Logger.log(`  Unmatched folders (${unmatchedFolderNames.length}): ${unmatchedFolderNames.join(', ')}`);
    }

    // 7. Auto-trigger enrichment for newly linked candidates with content
    let enriched = 0;
    let enrichedPartial = false;
    const enrichableUids = linkedUids.filter(u => u.hasDeepDive || u.hasTags);

    if (enrichableUids.length > 0) {
      Logger.log(`  Triggering enrichment for ${enrichableUids.length} candidates with DeepDive/Tags...`);
      const enrichResult = runSelectiveEnrichment(
        enrichableUids.map(u => u.uid),
        startTime
      );
      enriched = enrichResult.enriched || 0;
      enrichedPartial = enrichResult.partial || false;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    Logger.log(`=== FOLDER LINKER COMPLETE (${elapsed}s) ===`);
    Logger.log(`Linked: ${linked}, Already Linked: ${alreadyLinked}, Unmatched: ${unmatchedFolderNames.length}, Enriched: ${enriched}`);

    return {
      linked,
      alreadyLinked,
      unmatchedFolders: unmatchedFolderNames.length,
      unmatchedFolderNames,
      enriched,
      enrichedPartial
    };

  } catch (error) {
    Logger.log(`ERROR in runFolderLinker: ${error.message}`);
    logError('FOLDER_LINK_FAIL', error.message, 'runFolderLinker');
    throw error;
  }
}

/**
 * Get all candidate subfolders from CANDIDATES_FOLDER_ID
 * @returns {Array<{name: string, id: string, url: string}>}
 */
function getCandidateFolders() {
  const parentFolder = DriveApp.getFolderById(CANDIDATES_FOLDER_ID);
  const subfolders = parentFolder.getFolders();
  const folders = [];

  while (subfolders.hasNext()) {
    const folder = subfolders.next();
    folders.push({
      name: folder.getName(),
      id: folder.getId(),
      url: folder.getUrl()
    });
  }

  return folders;
}

/**
 * Build candidate name lookup map from Candidate_Master
 * Maps normalized name → ARRAY of candidate entries (handles duplicate names)
 * @param {Array[]} existingData - Full sheet data including header
 * @param {Object} colMap - Header name → column index
 * @returns {Object} - { normalizedName: [{ rowIndex, uid, notesSummary, driveLink }, ...] }
 */
function buildCandidateNameMap(existingData, colMap) {
  const nameMap = {};

  for (let i = 1; i < existingData.length; i++) {
    // Skip merged donor rows — they're defunct records
    if (existingData[i][colMap['Match_Status']] === 'MERGED') continue;

    // Skip personal contacts (LI_Personal = YES)
    const liPersonal = existingData[i][colMap['LI_Personal']] || '';
    if (liPersonal === 'YES') continue;

    const fullName = existingData[i][colMap['Full_Name']] || '';
    if (!fullName) continue;

    const normalized = normalizeForFolderMatch(fullName);
    if (!nameMap[normalized]) {
      nameMap[normalized] = [];
    }

    nameMap[normalized].push({
      rowIndex: i - 1, // 0-based index into data rows (excluding header)
      uid: existingData[i][colMap['UID']] || '',
      notesSummary: existingData[i][colMap['Notes_Summary']] || '',
      driveLink: existingData[i][colMap['Drive_Folder_Link']] || ''
    });
  }

  return nameMap;
}

/**
 * Build set of existing Drive_Folder_Link URLs for skip-if-already-linked
 * @param {Array[]} existingData - Full sheet data including header
 * @param {Object} colMap - Header name → column index
 * @returns {Set<string>} - Set of folder URLs already linked
 */
function buildExistingLinksSet(existingData, colMap) {
  const linksSet = new Set();
  const colIdx = colMap['Drive_Folder_Link'];

  for (let i = 1; i < existingData.length; i++) {
    const link = existingData[i][colIdx];
    if (link) {
      linksSet.add(link);
    }
  }

  return linksSet;
}

/**
 * Normalize name for folder matching
 * Handles: comma-reversed names ("Smith, John"), diacritics, credentials
 * @param {string} name - Raw name
 * @returns {string} - Normalized name
 */
function normalizeForFolderMatch(name) {
  if (!name) return '';

  // 1. Transliterate accents → ASCII
  let cleaned = normalizeDiacritics(name);

  // 2. Detect "Last, First" format and flip
  // Split on FIRST comma only — handles "Smith, John, CPA" → "Smith" + "John, CPA"
  const commaIdx = cleaned.indexOf(',');
  if (commaIdx > 0) {
    const beforeComma = cleaned.substring(0, commaIdx).trim();
    const afterComma = cleaned.substring(commaIdx + 1).trim();

    // Only flip if beforeComma looks like a last name (single word, no credentials)
    // This avoids flipping "John Smith, CPA" (beforeComma = "John Smith" = 2 words)
    if (beforeComma.split(/\s+/).length === 1) {
      cleaned = afterComma + ' ' + beforeComma;
    }
  }

  // 3. Standard normalization (strip credentials, lowercase, remove special chars)
  return normalizeName(cleaned);
}

/**
 * Extract last name from a normalized name string
 * Strips common suffixes (Jr, Sr, II, III, etc.) then returns the last word
 * @param {string} normalizedName - Already normalized name (lowercase, no special chars)
 * @returns {string} - Last name
 */
function extractLastName(normalizedName) {
  const parts = normalizedName.split(/\s+/).filter(p => p.length > 0);
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/**
 * Extract first name parts from a normalized name string
 * Returns everything before the last name (after suffix stripping)
 * @param {string} normalizedName - Already normalized name
 * @returns {string[]} - Array of first/middle name parts
 */
function extractFirstParts(normalizedName) {
  const parts = normalizedName.split(/\s+/).filter(p => p.length > 0);
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.length > 1 ? parts.slice(0, -1) : [];
}

/**
 * Build last-name index for Tier 2 matching
 * Maps normalized last name → array of candidate entries
 * @param {Array[]} existingData - Full sheet data including header
 * @param {Object} colMap - Header name → column index
 * @returns {Object} - { lastName: [{ rowIndex, uid, fullNormalized, notesSummary, driveLink }] }
 */
function buildLastNameIndex(existingData, colMap) {
  const lastNameMap = {};

  for (let i = 1; i < existingData.length; i++) {
    // Skip merged donor rows — they're defunct records
    if (existingData[i][colMap['Match_Status']] === 'MERGED') continue;

    // Skip personal contacts (LI_Personal = YES)
    const liPersonal = existingData[i][colMap['LI_Personal']] || '';
    if (liPersonal === 'YES') continue;

    const fullName = existingData[i][colMap['Full_Name']] || '';
    if (!fullName) continue;

    const normalized = normalizeForFolderMatch(fullName);
    const lastName = extractLastName(normalized);
    if (!lastName) continue;

    if (!lastNameMap[lastName]) {
      lastNameMap[lastName] = [];
    }

    lastNameMap[lastName].push({
      rowIndex: i - 1,
      uid: existingData[i][colMap['UID']] || '',
      fullNormalized: normalized,
      notesSummary: existingData[i][colMap['Notes_Summary']] || '',
      driveLink: existingData[i][colMap['Drive_Folder_Link']] || ''
    });
  }

  return lastNameMap;
}

/**
 * Find best candidate match for a folder name
 * Tier 1: Exact full normalized name match
 * Tier 2: Last-name-first — match last name, then verify first name within that group
 *
 * @param {string} folderName - Drive folder name
 * @param {Object} candidateNameMap - Output of buildCandidateNameMap (full name → candidates)
 * @param {Object} lastNameIndex - Output of buildLastNameIndex (last name → candidates)
 * @returns {Object|null} - { rowIndex, uid, matchTier } or null
 */
function findBestCandidateMatch(folderName, candidateNameMap, lastNameIndex) {
  const normalizedFolder = normalizeForFolderMatch(folderName);
  if (!normalizedFolder) return null;

  // --- Tier 1: Exact normalized match ---
  if (candidateNameMap[normalizedFolder]) {
    const candidates = candidateNameMap[normalizedFolder];
    const winner = resolveDuplicates(candidates);
    if (winner) {
      return { rowIndex: winner.rowIndex, uid: winner.uid, matchTier: 'exact' };
    }
    Logger.log(`  Tier 1 found ${candidates.length} exact matches but could not resolve. Skipping Tier 2.`);
    return null;
  }

  // --- Tier 2: Last-name-first matching ---
  const folderLastName = extractLastName(normalizedFolder);
  const folderFirstParts = extractFirstParts(normalizedFolder);
  if (!folderLastName || folderFirstParts.length === 0) return null;

  // 2a. Find candidates sharing the same last name
  let pool = [];

  // Exact last name
  if (lastNameIndex[folderLastName]) {
    pool = lastNameIndex[folderLastName].slice(); // copy
  }

  // Fuzzy last name: only for 5+ char last names, distance exactly 1
  if (pool.length === 0 && folderLastName.length >= 5) {
    for (const candidateLastName in lastNameIndex) {
      if (candidateLastName.length >= 4 && levenshteinDistance(folderLastName, candidateLastName) === 1) {
        pool = pool.concat(lastNameIndex[candidateLastName]);
      }
    }
  }

  if (pool.length === 0) return null;

  // 2b. Within the last-name pool, verify first name match
  const matchingCandidates = [];

  for (const candidate of pool) {
    const candidateFirstParts = extractFirstParts(candidate.fullNormalized);
    if (candidateFirstParts.length === 0) continue;

    // At least one folder first-part must match one candidate first-part
    let firstNameMatched = false;
    for (const fPart of folderFirstParts) {
      for (const cPart of candidateFirstParts) {
        const dist = levenshteinDistance(fPart, cPart);
        // Threshold: 1-3 chars = exact, 4+ chars = distance 1
        const minLen = Math.min(fPart.length, cPart.length);
        const maxDist = minLen <= 3 ? 0 : 1;
        if (dist <= maxDist) {
          firstNameMatched = true;
          break;
        }
      }
      if (firstNameMatched) break;
    }

    if (firstNameMatched) {
      matchingCandidates.push(candidate);
    }
  }

  if (matchingCandidates.length > 0) {
    const winner = resolveDuplicates(matchingCandidates);
    if (winner) {
      return { rowIndex: winner.rowIndex, uid: winner.uid, matchTier: 'lastName' };
    }
  }

  return null;
}

/**
 * Resolve duplicate name matches using tiebreaker logic
 * Tiebreaker A: Skip already-linked candidates
 * Tiebreaker B: Prefer candidates with Bullhorn notes (Notes_Summary non-empty)
 * Tiebreaker C: If still tied, return null (unmatched — safer than guessing)
 *
 * @param {Array<Object>} candidates - Array of { rowIndex, uid, notesSummary, driveLink }
 * @returns {Object|null} - Winning candidate or null if unresolvable
 */
function resolveDuplicates(candidates) {
  if (candidates.length === 1) {
    // Single match — but skip if already linked
    if (candidates[0].driveLink) return null;
    return candidates[0];
  }

  // Tiebreaker A: Filter out already-linked
  const unlinked = candidates.filter(c => !c.driveLink);
  if (unlinked.length === 0) return null; // All already linked
  if (unlinked.length === 1) return unlinked[0];

  // Tiebreaker B: Prefer those with Bullhorn notes
  const withNotes = unlinked.filter(c => c.notesSummary && c.notesSummary.trim().length > 0);
  if (withNotes.length === 1) return withNotes[0];

  // Tiebreaker C: Can't resolve — skip to avoid wrong link
  Logger.log(`  WARNING: ${candidates.length} candidates share a name, could not resolve. UIDs: ${unlinked.map(c => c.uid).join(', ')}`);
  return null;
}

/**
 * Scan folder contents for resume, DeepDive, and Tags files
 * @param {string} folderId - Drive folder ID
 * @returns {Object} - { hasResume, hasDeepDive, hasTags }
 */
function scanFolderContents(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();

  let hasResume = false;
  let hasDeepDive = false;
  let hasTags = false;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    // Resume: any .pdf or .docx
    if (fileName.match(/\.(pdf|docx?)$/i)) {
      hasResume = true;
    }

    // DeepDive: DeepDive*.md (handles versioned: DeepDive.md, DeepDive_v1.md, etc.)
    if (/DeepDive.*\.md$/i.test(fileName)) {
      hasDeepDive = true;
    }

    // Tags: *_Tags.json
    if (/_Tags\.json$/i.test(fileName)) {
      hasTags = true;
    }
  }

  return { hasResume, hasDeepDive, hasTags };
}
