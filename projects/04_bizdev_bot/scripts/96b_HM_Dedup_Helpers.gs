/**
 * 96b_HM_Dedup_Helpers.gs
 * Supporting functions for HM_Person_Master NO_LI deduplication
 *
 * PURPOSE: Data retrieval, name matching, Gemini identity matching,
 *          merge logic with downstream cascade, review tab management
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 * CALLED BY: 96_HM_Dedup.gs orchestrators
 */

// ============================================
// DATA RETRIEVAL
// ============================================

/**
 * Load all HM_Person_Master records into objects
 * @param {Sheet} hmSheet
 * @returns {Array<Object>} - Array of person record objects
 */
function loadHMPersonRecords_(hmSheet) {
  const data = hmSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const records = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const key = String(row[colMap['Composite Key']] || '').trim();
    if (!key) continue;

    records.push({
      rowNum: i + 1,
      key: key,
      linkedInUrl: String(row[colMap['LinkedIn URL']] || '').trim(),
      name: String(row[colMap['HM Name']] || '').trim(),
      title: String(row[colMap['HM Title']] || '').trim(),
      company: String(row[colMap['Company']] || '').trim(),
      domain: String(row[colMap['Company Domain']] || '').trim(),
      primaryEmail: String(row[colMap['Primary_Email']] || '').trim(),
      primaryPhone: String(row[colMap['Primary_Phone']] || '').trim(),
      originalSource: String(row[colMap['Original_Source']] || '').trim(),
      originalSourceDate: row[colMap['Original_Source_Date']] || '',
      dedupStatus: String(row[headers.indexOf('Dedup_Status')] || '').trim(),
      liPersonal: String(row[colMap['LI_Personal']] || '').trim()
    });
  }

  return records;
}

/**
 * Get NO_LI records that haven't been deduped yet
 * @param {Sheet} hmSheet
 * @param {Array<Object>} allRecords - Pre-loaded records
 * @param {number} limit - Max to return
 * @returns {Array<Object>}
 */
function getNoLiRecordsNeedingDedup_(hmSheet, allRecords, limit) {
  // Ensure Dedup_Status column exists
  const headers = hmSheet.getRange(1, 1, 1, hmSheet.getLastColumn()).getValues()[0];
  let dedupCol = headers.indexOf('Dedup_Status');
  if (dedupCol === -1) {
    hmSheet.getRange(1, headers.length + 1).setValue('Dedup_Status');
    dedupCol = headers.length;
  }

  const batch = [];

  for (const record of allRecords) {
    if (record.key.startsWith('NO_LI-') && !record.dedupStatus) {
      batch.push(record);
      if (batch.length >= limit) break;
    }
  }

  return batch;
}

/**
 * Count NO_LI records still needing dedup
 * @param {Sheet} hmSheet
 * @returns {number}
 */
function countNoLiNeedingDedup_(hmSheet) {
  const data = hmSheet.getDataRange().getValues();
  const headers = data[0];
  const keyCol = headers.indexOf('Composite_Key');
  const dedupCol = headers.indexOf('Dedup_Status');

  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][keyCol] || '').trim();
    const status = dedupCol >= 0 ? String(data[i][dedupCol] || '').trim() : '';
    if (key.startsWith('NO_LI-') && !status) count++;
  }

  return count;
}

// ============================================
// NAME MATCHING (Pre-filter)
// ============================================

/**
 * Pre-filter LinkedIn records by last name match against NO_LI record
 * Uses last name extraction from both the NO_LI key and the HM Name field
 *
 * @param {Object} noLiRecord - The NO_LI record
 * @param {Array<Object>} linkedInRecords - All real LinkedIn-keyed records
 * @returns {Array<Object>} - Filtered records with same last name (max 50)
 */
function preFilterByName_(noLiRecord, linkedInRecords) {
  const noLiLastName = extractLastNameFromRecord_(noLiRecord);
  if (!noLiLastName) return [];

  Logger.log(`  Last name: "${noLiLastName}"`);

  const matches = [];

  for (const liRecord of linkedInRecords) {
    // Skip personal LinkedIn connections
    if (liRecord.liPersonal === 'YES') continue;

    const liLastName = extractLastNameFromRecord_(liRecord);
    if (!liLastName) continue;

    if (noLiLastName === liLastName) {
      matches.push(liRecord);
    }
  }

  Logger.log(`  Pre-filter: ${matches.length} records share last name "${noLiLastName}"`);

  // If too many last name matches (common names), return top 50
  return matches.slice(0, 50);
}

/**
 * Extract last name from a person record
 * Uses HM Name field, falls back to parsing the NO_LI key
 *
 * @param {Object} record - Person record
 * @returns {string} - Lowercase last name
 */
function extractLastNameFromRecord_(record) {
  if (record.name) {
    // Strip credentials — only when preceded by comma/space (not embedded in names like "Garcia")
    let clean = record.name
      .replace(/[,\s]+(CPA|MBA|CFA|EA|CFE|CGMA|CMA|ACCA|CIA|JD|PhD|Jr|Sr|III|II)\.?\s*$/gi, '')
      .replace(/[,\s]+(CPA|MBA|CFA|EA|CFE|CGMA|CMA|ACCA|CIA|JD|PhD|Jr|Sr|III|II)([,\s])/gi, '$2')
      .trim();

    // "First Last" format — take last word
    const words = clean.split(/\s+/);
    return words[words.length - 1].toLowerCase();
  }

  // Fallback: parse from NO_LI key (NO_LI-first-last or NO_LI-first-last-domain)
  if (record.key.startsWith('NO_LI-')) {
    const parts = record.key.replace('NO_LI-', '').split('-');
    // If 2 parts: first-last
    // If 3+ parts: first-last-domain (take second part)
    if (parts.length >= 2) {
      return parts[1].toLowerCase();
    }
  }

  return '';
}

// ============================================
// GEMINI IDENTITY MATCHING
// ============================================

/**
 * Use Gemini to confirm identity matches between NO_LI and LinkedIn records
 *
 * @param {Object} noLiRecord - The NO_LI record
 * @param {Array<Object>} candidates - Pre-filtered LinkedIn candidates
 * @param {string} apiKey - Gemini API key
 * @returns {Array<Object>} - Matches with confidence scores [{record, confidence, reason}]
 */
function matchNoLiWithGemini_(noLiRecord, candidates, apiKey) {
  // If only 1 candidate with exact name match, skip Gemini — auto 99%
  if (candidates.length === 1) {
    const noLiNorm = normalizeName_(noLiRecord.name);
    const liNorm = normalizeName_(candidates[0].name);
    if (noLiNorm === liNorm) {
      Logger.log('  Exact 1:1 name match — skipping Gemini (99%)');
      return [{ record: candidates[0], confidence: 99, reason: 'Exact name match, single candidate' }];
    }
  }

  const candidateList = candidates.map((c, i) => {
    return `${i + 1}. ${c.name} | Title: ${c.title || 'Unknown'} | Company: ${c.company || 'Unknown'} | Key: ${c.key}`;
  }).join('\n');

  const prompt = `You are matching a Bullhorn-imported person record (no LinkedIn) to LinkedIn-sourced person records.

BULLHORN RECORD (NO LINKEDIN):
Name: ${noLiRecord.name}
Title: ${noLiRecord.title || 'Unknown'}
Company: ${noLiRecord.company || 'Unknown'}
Key: ${noLiRecord.key}

LINKEDIN-SOURCED CANDIDATES:
${candidateList}

INSTRUCTIONS:
1. Determine if any candidate is the SAME PERSON as the Bullhorn record
2. Name is the primary signal — same first + last name = very likely same person
3. Title and company are secondary signals (people change jobs)
4. Return TOP 3 BEST MATCHES with confidence scores (0-100)

Return ONLY a JSON array:
[
  {"candidate_number": 1, "confidence": 97, "reason": "Same name, same person"},
  {"candidate_number": 3, "confidence": 75, "reason": "Same last name, different first name"}
]

SCORING:
- 95+ = Same person (auto-merge)
- 70-94 = Possible match (needs human review)
- <70 = Different person (exclude from results)
- Return empty array [] if no matches above 70%

Return ONLY the JSON array.`;

  try {
    const url = `${GEMINI_API_URL}?key=${apiKey}`;

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

    if (json.usageMetadata) {
      Logger.log(`  Gemini tokens: In=${json.usageMetadata.promptTokenCount || 0}, Out=${json.usageMetadata.candidatesTokenCount || 0}`);
    }

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const text = json.candidates[0].content.parts[0].text.trim();
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const results = JSON.parse(cleanText);

      return results.map(r => ({
        record: candidates[r.candidate_number - 1],
        confidence: r.confidence,
        reason: r.reason
      })).filter(r => r.record); // Filter out invalid indices
    }

    Logger.log('  WARNING: No candidates in Gemini response');
    return [];

  } catch (error) {
    Logger.log(`  ERROR in Gemini matching: ${error.message}`);
    return [];
  }
}

// Merge logic, status management, and review tab moved to 96c_HM_Dedup_Merge.gs:
// mergeNoLiToLinkedIn_, cascadeKeyUpdate_, markDedupStatus_,
// markDedupStatusByKey_, writeToHMDedupReview_
