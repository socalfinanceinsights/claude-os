/**
 * 03_Resume_Archive_Matcher.gs
 * Match 10,478 resume archive files to Candidate_Master records by name
 *
 * STATUS: STUB — Not yet functional. Resume archive is local, not in Drive.
 * PURPOSE: Link existing resumes to candidates for human review
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00d_Name_Matching.gs
 */

/**
 * Main orchestrator for resume archive matching
 * Scans resume archive folder, fuzzy matches to Candidate_Master, outputs to Resume_Archive_Matches tab
 */
function runResumeArchiveMatcher() {
  Logger.log('=== STARTING RESUME ARCHIVE MATCHER ===');

  try {
    // 1. Get all resume files from archive folder
    const resumeFiles = getResumeArchiveFiles();
    Logger.log(`Found ${resumeFiles.length} files in resume archive`);

    // 2. Load Candidate_Master data
    const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
    const existingData = sheet.getDataRange().getValues();
    const headers = existingData[0];

    // Build column index map
    const colMap = {};
    headers.forEach((header, idx) => {
      colMap[header] = idx;
    });

    // 3. Match resume files to candidates
    const matches = matchResumesToCandidates(resumeFiles, existingData, colMap);

    // 4. Write matches to Resume_Archive_Matches tab for human review
    writeResumeMatches(matches);

    Logger.log('=== RESUME ARCHIVE MATCHER COMPLETE ===');
    Logger.log(`Total Matches: ${matches.length}`);

    return { totalMatches: matches.length };

  } catch (error) {
    Logger.log(`ERROR in runResumeArchiveMatcher: ${error.message}`);
    throw error;
  }
}

/**
 * Get all files from resume archive folder (recursive)
 * Returns array of { name, id, url, mimeType }
 */
function getResumeArchiveFiles() {
  const files = [];
  // Set RESUME_ARCHIVE_PATH in Script Properties or update this constant in 00a_Config.gs
  const archivePath = PropertiesService.getScriptProperties().getProperty('RESUME_ARCHIVE_PATH') || 'YOUR_LOCAL_RESUME_ARCHIVE_PATH';

  // NOTE: This folder is LOCAL, not in Drive
  // We'll need to process this differently - batch upload first or use DriveApp if folder is in Drive
  // For now, placeholder assumes folder will be manually uploaded to Drive for processing

  Logger.log('WARNING: Resume archive is local folder. Upload to Drive first before running.');
  Logger.log(`Local path: ${archivePath}`);

  // TODO: Add logic to process Drive folder after user uploads resume archive
  // Expected Drive folder structure:
  // - Parent folder: Resume_Archive (ID to be added to Brain_Config)
  // - Contains: 10,478 PDF/DOC files with candidate names in filename

  return files;
}

/**
 * Match resume files to candidates using fuzzy name matching
 * Returns array of match objects for human review
 */
function matchResumesToCandidates(resumeFiles, existingData, colMap) {
  const matches = [];

  // Build name lookup from Candidate_Master
  const candidateNames = buildCandidateNameLookup(existingData, colMap);

  for (const file of resumeFiles) {
    const fileName = file.name;
    const extractedName = extractNameFromFilename(fileName);

    if (!extractedName) {
      Logger.log(`Could not extract name from: ${fileName}`);
      continue;
    }

    // Find best candidate match
    const matchedCandidate = findBestResumeMatch(extractedName, candidateNames);

    if (matchedCandidate && matchedCandidate.score >= FUZZY_MATCH_THRESHOLD) {
      matches.push({
        resume_filename: fileName,
        resume_url: file.url,
        extracted_name: extractedName,
        matched_candidate: matchedCandidate.name,
        matched_uid: matchedCandidate.uid,
        match_score: matchedCandidate.score,
        human_verified: '' // For manual review
      });
    }
  }

  return matches;
}

/**
 * Build candidate name lookup from Candidate_Master
 * Returns array of { name, uid, normalizedName }
 */
function buildCandidateNameLookup(existingData, colMap) {
  const candidates = [];

  for (let i = 1; i < existingData.length; i++) {
    const fullName = existingData[i][colMap['Full_Name']] || '';
    const uid = existingData[i][colMap['UID']] || '';

    if (fullName) {
      candidates.push({
        name: fullName,
        uid: uid,
        normalizedName: normalizeName(fullName)
      });
    }
  }

  return candidates;
}

/**
 * Extract candidate name from resume filename
 * Handles common patterns:
 * - "John Doe Resume.pdf"
 * - "Resume - Jane Smith.docx"
 * - "JohnDoe_Resume_2024.pdf"
 * - "Smith, Robert - Resume.pdf"
 */
function extractNameFromFilename(filename) {
  // Remove file extension
  let name = filename.replace(/\.(pdf|docx?|txt)$/i, '');

  // Remove common resume keywords
  name = name.replace(/resume|cv|curriculum vitae|_|-/gi, ' ');

  // Handle "Last, First" format
  if (name.includes(',')) {
    const parts = name.split(',');
    if (parts.length === 2) {
      name = `${parts[1].trim()} ${parts[0].trim()}`;
    }
  }

  // Remove numbers and extra whitespace
  name = name.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

  // Return null if name is too short (likely not a valid name)
  if (name.length < 3) {
    return null;
  }

  return name;
}

/**
 * Find best resume match using fuzzy name matching
 * Returns { name, uid, score } or null
 */
function findBestResumeMatch(extractedName, candidateNames) {
  const normalizedExtracted = normalizeName(extractedName);

  let bestMatch = null;
  let bestScore = 0;

  for (const candidate of candidateNames) {
    const similarity = calculateSimilarity(normalizedExtracted, candidate.normalizedName);

    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = {
        name: candidate.name,
        uid: candidate.uid,
        score: similarity
      };
    }
  }

  return bestMatch;
}

/**
 * Write resume matches to Resume_Archive_Matches tab for human review
 */
function writeResumeMatches(matches) {
  const sheet = getSheetByName(TAB_RESUME_ARCHIVE_MATCHES);

  // Clear existing data (except headers)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }

  // Write new matches
  if (matches.length > 0) {
    const rows = matches.map(m => [
      m.resume_filename,
      m.resume_url,
      m.extracted_name,
      m.matched_candidate,
      m.matched_uid,
      m.match_score.toFixed(2),
      m.human_verified
    ]);

    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
    Logger.log(`Wrote ${rows.length} matches to Resume_Archive_Matches tab`);
  }
}
