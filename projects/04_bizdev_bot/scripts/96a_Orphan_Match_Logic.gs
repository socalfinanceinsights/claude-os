/**
 * 96a_Orphan_Match_Logic.gs
 * BD TRACKER - Orphan Match Logic, Archive Management & Menu Integration
 * @execution manual
 * Version: 1.0.0
 *
 * CONTAINS:
 * - Core matching logic (exact + fuzzy Levenshtein)
 * - Archive management (move to HM_Orphaned_Records_Archive)
 * - Menu integration helper
 *
 * SPLIT FROM: 96_Orphan_Reconciliation.gs (lines 237-513)
 * CALLED BY: 96_Orphan_Reconciliation.gs (RunOnce_FindPotentialMatches, RunOnce_MarkOrphansAsReviewed)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, normalizeName_, logError_)
 */

/** ==========================================================================
 *  CORE MATCHING LOGIC
 *  ========================================================================== */

/**
 * Find and write match suggestions for all pending orphaned records
 *
 * @returns {Object} - {processedCount, exactMatchCount, fuzzyMatchCount, noMatchCount}
 */
function findAndWriteMatchSuggestions_() {
  const ss = getSpreadsheet_();
  const orphanSheet = ss.getSheetByName('HM_Orphaned_Records');
  const hm = ss.getSheetByName(CONFIG.sheetHM);

  // Read orphan data
  const orphanData = orphanSheet.getDataRange().getValues();

  // Read HM_Person_Master (only records with LinkedIn URLs)
  const hmData = hm.getDataRange().getValues();
  const linkedInRecords = [];

  for (let i = 1; i < hmData.length; i++) {
    const linkedInUrl = String(hmData[i][1]).trim(); // Column B: LinkedIn URL
    if (linkedInUrl) {
      linkedInRecords.push({
        key: String(hmData[i][0]).trim(),           // A: Composite Key
        linkedIn: linkedInUrl,                      // B: LinkedIn URL
        name: String(hmData[i][2]).trim(),          // C: HM Name
        title: String(hmData[i][3]).trim(),         // D: HM Title
        company: String(hmData[i][4]).trim(),       // E: Company
        normalizedName: normalizeName_(String(hmData[i][2]).trim())
      });
    }
  }

  Logger.log(`Found ${linkedInRecords.length} records with LinkedIn URLs for matching`);

  // Process each pending orphan
  let processedCount = 0;
  let exactMatchCount = 0;
  let fuzzyMatchCount = 0;
  let noMatchCount = 0;

  const suggestionsToWrite = []; // Array of [rowIndex, suggestion1, suggestion2, suggestion3]

  for (let i = 1; i < orphanData.length; i++) {
    const reviewStatus = String(orphanData[i][8]).trim(); // Column I: Review_Status

    // Only process pending orphans
    if (reviewStatus !== 'Pending') continue;

    const orphanName = String(orphanData[i][1]).trim();
    const orphanNormalized = normalizeName_(orphanName);

    // Find top 3 matches
    const suggestions = findTopMatches_(orphanName, orphanNormalized, linkedInRecords, 3);

    // Track stats
    if (suggestions.length > 0) {
      if (suggestions[0].confidence === 'EXACT') exactMatchCount++;
      else fuzzyMatchCount++;
    } else {
      noMatchCount++;
    }

    // Format suggestions for writing
    const suggestion1 = suggestions[0] ? formatSuggestion_(suggestions[0]) : '';
    const suggestion2 = suggestions[1] ? formatSuggestion_(suggestions[1]) : '';
    const suggestion3 = suggestions[2] ? formatSuggestion_(suggestions[2]) : '';

    suggestionsToWrite.push([i + 1, suggestion1, suggestion2, suggestion3]); // +1 for 1-indexed rows
    processedCount++;
  }

  // Write suggestions back to orphan sheet (columns F-H)
  if (suggestionsToWrite.length > 0) {
    for (const [rowIndex, sug1, sug2, sug3] of suggestionsToWrite) {
      orphanSheet.getRange(rowIndex, 6).setValue(sug1);  // Column F: Suggested_Match_1
      orphanSheet.getRange(rowIndex, 7).setValue(sug2);  // Column G: Suggested_Match_2
      orphanSheet.getRange(rowIndex, 8).setValue(sug3);  // Column H: Suggested_Match_3
    }
    Logger.log(`Wrote ${suggestionsToWrite.length} sets of match suggestions`);
  }

  return {
    processedCount: processedCount,
    exactMatchCount: exactMatchCount,
    fuzzyMatchCount: fuzzyMatchCount,
    noMatchCount: noMatchCount
  };
}

/**
 * Find top N matches for a given orphan name
 * Uses exact matching first, then fuzzy matching
 *
 * @param {string} orphanName - Original name from orphan record
 * @param {string} orphanNormalized - Normalized name
 * @param {Array} linkedInRecords - Array of records with LinkedIn URLs
 * @param {number} topN - Number of top matches to return
 * @returns {Array} - Array of match objects with confidence scores
 */
function findTopMatches_(orphanName, orphanNormalized, linkedInRecords, topN) {
  const matches = [];

  // Step 1: Exact matches (normalized name matches exactly)
  for (const record of linkedInRecords) {
    if (record.normalizedName === orphanNormalized) {
      matches.push({
        key: record.key,
        linkedIn: record.linkedIn,
        name: record.name,
        company: record.company,
        confidence: 'EXACT',
        score: 100
      });
    }
  }

  // If we have enough exact matches, return them
  if (matches.length >= topN) {
    return matches.slice(0, topN);
  }

  // Step 2: Fuzzy matches (Levenshtein distance)
  for (const record of linkedInRecords) {
    // Skip if already in exact matches
    if (record.normalizedName === orphanNormalized) continue;

    const distance = levenshteinDistance_(orphanNormalized, record.normalizedName);
    const maxLength = Math.max(orphanNormalized.length, record.normalizedName.length);
    const similarityScore = Math.round((1 - distance / maxLength) * 100);

    // Only include if similarity >= 70%
    if (similarityScore >= 70) {
      matches.push({
        key: record.key,
        linkedIn: record.linkedIn,
        name: record.name,
        company: record.company,
        confidence: 'FUZZY',
        score: similarityScore
      });
    }
  }

  // Sort by score (descending) and return top N
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, topN);
}

/**
 * Format match suggestion for display in cell
 *
 * @param {Object} match - Match object
 * @returns {string} - Formatted suggestion string
 */
function formatSuggestion_(match) {
  // Extract slug from LinkedIn URL (last part after /in/)
  let slug = match.linkedIn;
  const slugMatch = match.linkedIn.match(/\/in\/([^/]+)/);
  if (slugMatch) {
    slug = slugMatch[1];
  }

  // Format: "EXACT: slug (Name @ Company)" or "FUZZY: slug (Name @ Company - 85%)"
  if (match.confidence === 'EXACT') {
    return `EXACT: ${slug} (${match.name} @ ${match.company})`;
  } else {
    return `FUZZY: ${slug} (${match.name} @ ${match.company} - ${match.score}%)`;
  }
}

/** ==========================================================================
 *  ARCHIVE MANAGEMENT
 *  ========================================================================== */

/**
 * Move selected rows from HM_Orphaned_Records to archive
 *
 * @param {number} startRow - First row to move (1-indexed)
 * @param {number} numRows - Number of rows to move
 * @returns {Object} - {movedCount}
 */
function moveToArchive_(startRow, numRows) {
  const ss = getSpreadsheet_();
  const orphanSheet = ss.getSheetByName('HM_Orphaned_Records');

  // Get or create archive sheet
  let archiveSheet = ss.getSheetByName('HM_Orphaned_Records_Archive');
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet('HM_Orphaned_Records_Archive');
    // Copy header from orphan sheet
    const headers = orphanSheet.getRange(1, 1, 1, 10).getValues();
    archiveSheet.getRange(1, 1, 1, 10).setValues(headers);
    archiveSheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    archiveSheet.setFrozenRows(1);
  }

  // Read rows to move
  const rowsToMove = orphanSheet.getRange(startRow, 1, numRows, 10).getValues();

  // Update Review_Status to "Reviewed" (column I = index 8)
  for (const row of rowsToMove) {
    row[8] = 'Reviewed';
  }

  // Append to archive
  const archiveStartRow = archiveSheet.getLastRow() + 1;
  archiveSheet.getRange(archiveStartRow, 1, rowsToMove.length, 10).setValues(rowsToMove);

  // Delete rows from orphan sheet
  orphanSheet.deleteRows(startRow, numRows);

  Logger.log(`Moved ${numRows} rows to HM_Orphaned_Records_Archive`);

  return {
    movedCount: numRows
  };
}

/** ==========================================================================
 *  HELPER FUNCTIONS
 *  ========================================================================== */

/**
 * Calculate Levenshtein distance between two strings
 * (Fuzzy string matching algorithm)
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance_(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // Deletion
        matrix[i][j - 1] + 1,      // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }

  return matrix[len1][len2];
}

/** ==========================================================================
 *  MENU INTEGRATION
 *  ========================================================================== */

/**
 * Add orphan reconciliation functions to BD Automations menu
 * Call this from Code.gs onOpen() function
 */
function addOrphanReconciliationToMenu_(menu) {
  menu.addSeparator();
  menu.addItem('Find Potential Matches for Orphans', 'RunOnce_FindPotentialMatches');
  menu.addItem('Mark Orphans as Reviewed', 'RunOnce_MarkOrphansAsReviewed');
}
