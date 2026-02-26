/**
 * @file 96b_Dedup_Helpers.gs
 * Data retrieval and Gemini matching functions for candidate deduplication
 *
 * PURPOSE: Candidate data retrieval and Gemini-powered name matching
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00d_Name_Matching.gs
 *
 * NOTE: These functions are called by orchestrators in 96_Candidate_Deduplication.gs.
 * Merge logic, review tab, string utilities, and UID lookups: see 96c_Dedup_Merge_Helpers.gs
 * Do not rename without updating callers.
 *
 * @execution manual
 */

// ============================================
// DATA RETRIEVAL
// ============================================

/**
 * Get all Bullhorn candidates (for matching against)
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @returns {Array} - Array of Bullhorn candidate objects
 */
function getBullhornCandidates(masterSheet) {
  const data = masterSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const bullhornCandidates = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const lastBullhornContact = row[colMap['Last_Bullhorn_Contact']];

    if (lastBullhornContact) {
      bullhornCandidates.push({
        rowNum: i + 1,
        uid: row[colMap['UID']],
        fullName: row[colMap['Full_Name']],
        currentTitle: row[colMap['Current_Title']],
        currentCompany: row[colMap['Current_Company']]
      });
    }
  }

  return bullhornCandidates;
}

/**
 * Get LinkedIn candidates that need matching (not yet processed)
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {number} limit - Max candidates to return
 * @returns {Array} - Array of LinkedIn candidate objects (sorted DESCENDING by row)
 */
function getLinkedInCandidatesNeedingMatching(masterSheet, limit) {
  const data = masterSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const candidates = [];

  // Find or add Match_Status column
  let matchStatusCol = headers.indexOf('Match_Status');
  if (matchStatusCol === -1) {
    masterSheet.getRange(1, headers.length + 1).setValue('Match_Status');
    matchStatusCol = headers.length;
  }

  // Process from BOTTOM to TOP to avoid row number shifts during deletions
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const lastBullhornContact = row[colMap['Last_Bullhorn_Contact']];
    const matchStatus = row[matchStatusCol] || '';

    // LinkedIn-only candidates (no Bullhorn contact) that haven't been processed yet
    if (!lastBullhornContact && !matchStatus) {
      candidates.push({
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
      });

      if (candidates.length >= limit) break;
    }
  }

  return candidates;
}

/**
 * Count LinkedIn candidates needing matching
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @returns {number} - Count of candidates needing matching
 */
function countLinkedInCandidatesNeedingMatching(masterSheet) {
  const data = masterSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const matchStatusCol = headers.indexOf('Match_Status');
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const lastBullhornContact = row[colMap['Last_Bullhorn_Contact']];
    const matchStatus = matchStatusCol >= 0 ? row[matchStatusCol] : '';

    if (!lastBullhornContact && !matchStatus) {
      count++;
    }
  }

  return count;
}

// ============================================
// GEMINI MATCHING
// ============================================

/**
 * Use Gemini to find best matches for a LinkedIn candidate
 * @param {Object} linkedInCandidate - LinkedIn candidate
 * @param {Array} bullhornCandidates - Array of Bullhorn candidates
 * @returns {Array} - Array of matches with confidence scores
 */
function findMatchesWithGemini(linkedInCandidate, bullhornCandidates) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('ERROR: GEMINI_API_KEY not set. Falling back to no matches.');
    return [];
  }

  // Step 1: Pre-filter by last name to get top 50 candidates
  const linkedInLastName = extractLastName(linkedInCandidate.fullName);
  Logger.log(`  LinkedIn last name: ${linkedInLastName}`);

  const scoredCandidates = bullhornCandidates.map(bullhornCandidate => {
    const bullhornLastName = extractLastName(bullhornCandidate.fullName);

    // Normalize diacritics for matching (Özgeç → Ozgec)
    const normalizedLinkedInLastName = normalizeDiacritics(linkedInLastName).toLowerCase();
    const normalizedBullhornLastName = normalizeDiacritics(bullhornLastName).toLowerCase();

    const lastNameMatch = normalizedLinkedInLastName === normalizedBullhornLastName;

    let similarity = 0;
    if (lastNameMatch) {
      similarity = 100;
    } else {
      const normalizedLinkedInName = normalizeName(linkedInCandidate.fullName);
      const normalizedBullhornName = normalizeName(bullhornCandidate.fullName);
      const distance = levenshteinDistance(normalizedLinkedInName, normalizedBullhornName);
      const maxLength = Math.max(normalizedLinkedInName.length, normalizedBullhornName.length);
      similarity = Math.round((1 - distance / maxLength) * 100);
    }

    return { candidate: bullhornCandidate, similarity: similarity };
  });

  // Sort by similarity and take top 50
  scoredCandidates.sort((a, b) => b.similarity - a.similarity);
  const topCandidates = scoredCandidates.slice(0, 50).map(sc => sc.candidate);

  Logger.log(`  Pre-filtered to top 50 candidates (best similarity: ${scoredCandidates[0].similarity}%)`);

  // Step 2: Send top 50 to Gemini for smart matching
  const candidates = topCandidates.map((c, idx) => {
    return `${idx + 1}. ${c.fullName} @ ${c.currentCompany || 'Unknown Company'}`;
  }).join('\n');

  const prompt = `You are matching a LinkedIn profile to a candidate database.

LINKEDIN PROFILE:
Name: ${linkedInCandidate.fullName}
Company: ${linkedInCandidate.currentCompany || 'Unknown'}
Title: ${linkedInCandidate.currentTitle || 'Unknown'}

CANDIDATE DATABASE (Bullhorn):
${candidates}

INSTRUCTIONS:
1. Strip credentials from LinkedIn name (CPA, FPC, CPP, MBA, etc.)
2. Handle name format differences:
   - LinkedIn format: "Last, Credentials, First" or "Last, First"
   - Bullhorn format: "First Last"
3. Match based on PERSON IDENTITY (same person), not just name similarity
4. Consider company as secondary signal (people change companies)
5. Return the TOP 3 BEST MATCHES with confidence scores (0-100)

Return ONLY a JSON array in this format:
[
  {"candidate_number": 1, "confidence": 95, "reason": "Same person - John Smith matches Smith, CPA, John"},
  {"candidate_number": 5, "confidence": 75, "reason": "Likely match - same name, different company"}
]

IMPORTANT:
- confidence >= 95 = Same person, auto-merge
- confidence 70-94 = Possible match, needs review
- confidence < 70 = Different person, exclude from results
- Return empty array [] if no matches above 70% confidence
- Return ONLY the JSON array, no explanation`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const text = json.candidates[0].content.parts[0].text.trim();
      Logger.log(`  Gemini raw response: ${text.substring(0, 200)}...`);

      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const results = JSON.parse(cleanText);

      Logger.log(`  Gemini returned ${results.length} matches`);

      // Map results back to candidate objects (using topCandidates, not all bullhornCandidates)
      const matches = results.map(result => {
        const bullhornCandidate = topCandidates[result.candidate_number - 1];
        return {
          bullhornCandidate: bullhornCandidate,
          confidence: result.confidence,
          reason: result.reason
        };
      });

      return matches;
    } else {
      Logger.log(`  WARNING: No candidates in Gemini response`);
      Logger.log(`  Response: ${JSON.stringify(json).substring(0, 500)}`);
    }

    return [];

  } catch (error) {
    Logger.log(`  ERROR in Gemini matching: ${error.message}`);
    Logger.log(`  Stack: ${error.stack}`);
    return [];
  }
}

// Merge logic, review tab, string utilities, and UID lookups: see 96c_Dedup_Merge_Helpers.gs
