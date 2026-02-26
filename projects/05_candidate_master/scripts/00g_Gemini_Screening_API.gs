/**
 * @file 00g_Gemini_Screening_API.gs
 * Gemini API calls for DeepDive extraction, title extraction, and job screening
 *
 * PURPOSE: extractDeepDiveWithGemini, extractHistoricalTitlesWithGemini (used by 05_Enrichment.gs),
 *          generateScreeningMatrixWithGemini and rankCandidatesWithGemini (used by 06_Job_Screening.gs)
 * DEPENDENCIES: 00a_Config.gs (constants)
 * API KEY: Stored in PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')
 *
 * Core batch enrichment: see 00f_Gemini_API.gs
 *
 * @execution manual
 */

// ============================================
// DEEPDIVE ENRICHMENT (Gemini Pro)
// ============================================

/**
 * Extract structured data from DeepDive.md content using Gemini Pro
 * FULL extraction — used when NO Tags.json exists for this candidate
 * @param {string} content - Full DeepDive.md file content
 * @returns {Object|null} - { tech_stack, key_skills, quality_tier, historical_titles } or null
 */
function extractDeepDiveWithGemini(content) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('WARNING: GEMINI_API_KEY not set. Skipping DeepDive extraction.');
    return null;
  }

  const prompt = `Extract structured candidate data from this interview analysis document.

DOCUMENT:
${content}

INSTRUCTIONS:
Extract the following fields from the document. The document uses numbered categories with Quote/Paraphrase/Context blocks.

Return ONLY a JSON object:
{
  "tech_stack": "semicolon-separated list of ERPs, software tools, systems (e.g. NetSuite; Excel; SAP; QuickBooks) or null",
  "key_skills": "semicolon-separated list of technical accounting/finance skills (e.g. GL Accounting; Month-End Close; SOX Compliance; Revenue Recognition) or null",
  "quality_tier": "A, B, or C based on: A = Big 4 experience OR active CPA + strong progression, B = CPA pending or solid mid-market experience, C = limited experience or weak signals. Return null if insufficient data",
  "historical_titles": "semicolon-separated list of past role titles with companies, newest first (e.g. Senior Accountant at Deloitte; Staff Accountant at BDO) or null"
}

RULES:
- Return null for any field you cannot determine from the document
- tech_stack: Only software/systems/ERPs. No soft skills.
- key_skills: Only technical accounting/finance skills. No software (that goes in tech_stack).
- quality_tier: Single letter A, B, or C. Big 4 = automatic A consideration. CPA = strong A/B signal.
- historical_titles: Include company names when mentioned. Newest/most senior first.
- Do NOT hallucinate. If a field is not discussed, return null.
- Return ONLY valid JSON. No explanation, no markdown code blocks.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRO_MODEL}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeout: 60000
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);

    if (json.usageMetadata) {
      Logger.log(`  DeepDive extraction tokens: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}`);
    }

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const text = json.candidates[0].content.parts[0].text.trim();
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleanText);

      return {
        tech_stack: result.tech_stack || null,
        key_skills: result.key_skills || null,
        quality_tier: result.quality_tier || null,
        historical_titles: result.historical_titles || null
      };
    } else {
      Logger.log('WARNING: Gemini Pro returned no content for DeepDive. Response: ' + responseText.substring(0, 500));
      return null;
    }

  } catch (error) {
    Logger.log(`ERROR extracting DeepDive with Gemini: ${error.message}`);
    return null;
  }
}

/**
 * Extract ONLY historical titles from DeepDive.md — used when Tags.json already provides other fields
 * Lighter prompt, lower cost than full extraction
 * @param {string} content - Full DeepDive.md file content
 * @returns {Object|null} - { historical_titles, quality_tier } or null
 */
function extractHistoricalTitlesWithGemini(content) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('WARNING: GEMINI_API_KEY not set. Skipping title extraction.');
    return null;
  }

  const prompt = `Extract career history and quality assessment from this interview analysis document.

DOCUMENT:
${content}

Return ONLY a JSON object:
{
  "historical_titles": "semicolon-separated list of past role titles with companies, newest first (e.g. Senior Accountant at Deloitte; Staff Accountant at BDO) or null",
  "quality_tier": "A, B, or C. A = Big 4 (PwC/EY/Deloitte/KPMG) experience OR active CPA + strong career progression. B = CPA pending or solid mid-market. C = limited experience. null if insufficient data"
}

RULES:
- historical_titles: Include company names when mentioned. Most recent/senior first.
- Do NOT hallucinate. If career history is not discussed, return null.
- Return ONLY valid JSON. No markdown.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRO_MODEL}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeout: 60000
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);

    if (json.usageMetadata) {
      Logger.log(`  Title extraction tokens: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}`);
    }

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const text = json.candidates[0].content.parts[0].text.trim();
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleanText);

      return {
        historical_titles: result.historical_titles || null,
        quality_tier: result.quality_tier || null
      };
    } else {
      Logger.log('WARNING: Gemini Pro returned no content for title extraction. Response: ' + responseText.substring(0, 500));
      return null;
    }

  } catch (error) {
    Logger.log(`ERROR extracting titles with Gemini: ${error.message}`);
    return null;
  }
}

// ============================================
// JOB SCREENING - MATRIX GENERATION (Gemini Pro)
// ============================================

/**
 * Generate a screening matrix from JD + client notes using Gemini Pro
 * ONE call per job — produces the criteria all candidates are scored against
 *
 * @param {string} jdText - Full job description text
 * @param {string} clientNotes - Recruiter's notes about the role/client
 * @returns {Object|null} - Screening matrix JSON or null on failure
 */
function generateScreeningMatrixWithGemini(jdText, clientNotes) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('ERROR: GEMINI_API_KEY not set. Cannot generate screening matrix.');
    return null;
  }

  const prompt = `You are a recruiting strategist for an executive search firm specializing in Accounting & Finance in Southern California.

TASK: Generate a screening matrix for the following job.

JOB DESCRIPTION:
${jdText}

CLIENT NOTES:
${clientNotes || 'None provided'}

GENERATE a JSON screening matrix with this exact schema:
{
  "role_title": "exact title from JD",
  "company": "company/client name from JD or client notes",
  "role_level": "Staff|Senior|Manager|Director|VP|C-Suite",
  "specialization": "General Accounting|Tax|Audit|FP&A|Systems|Mixed",
  "location_requirement": "city/region and remote status from JD",
  "comp_range": "salary range from JD (informational only, NOT used for screening)",
  "industry": "industry from JD or client notes",
  "must_have": ["array of non-negotiable requirements from JD"],
  "strong_signals": ["array of differentiators that boost match score"],
  "disqualifiers": [
    {"rule": "short_id", "description": "why this is a structural mismatch"}
  ],
  "title_tier_map": {
    "ideal": ["titles at the right level for this role"],
    "adjacent": ["titles one step below or lateral moves"],
    "below_level": ["titles clearly too junior"],
    "above_level": ["titles clearly too senior"]
  }
}

CONSTRAINTS:
- comp_range is INFORMATIONAL ONLY. NEVER create disqualifiers based on compensation.
- quality_tier (A/B/C) must NOT appear in any rule. It is display-only data.
- DO NOT create rules requiring data we don't have:
  NO tenure/hopper rules (no job history dates available)
  NO education rules (no degree data available)
  NO years-of-experience rules (cannot calculate from our data)
- ONLY create rules based on: job title, company name, skills tags, location, and notes summary text.
- disqualifiers should be STRUCTURAL mismatches only (wrong function entirely, clearly wrong level). Keep them narrow and conservative. When in doubt, do NOT disqualify.
- must_have should contain 3-6 items max.
- strong_signals should contain 3-8 items max.
- disqualifiers should contain 1-4 rules max.

Return ONLY valid JSON. No explanation, no markdown code blocks.`;

  try {
    // Use Gemini Pro for strategic reasoning
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRO_MODEL}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeout: 60000  // 60 seconds for Pro model
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);

    if (json.usageMetadata) {
      Logger.log(`  Matrix generation token usage: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}, Total=${json.usageMetadata.totalTokenCount || 0}`);
    }

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const text = json.candidates[0].content.parts[0].text.trim();
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const matrix = JSON.parse(cleanText);

      // Validate required fields
      if (!matrix.role_title || !matrix.must_have || !matrix.title_tier_map) {
        Logger.log('WARNING: Matrix missing required fields. Raw: ' + cleanText.substring(0, 500));
        return null;
      }

      Logger.log(`  Matrix generated: ${matrix.role_title} (${matrix.role_level})`);
      Logger.log(`  Must-haves: ${matrix.must_have.length}, Signals: ${(matrix.strong_signals || []).length}, Disqualifiers: ${(matrix.disqualifiers || []).length}`);

      return matrix;

    } else {
      Logger.log('WARNING: Gemini Pro returned no content. Response: ' + responseText.substring(0, 500));
      return null;
    }

  } catch (error) {
    Logger.log(`ERROR generating screening matrix: ${error.message}`);
    return null;
  }
}

// ============================================
// JOB SCREENING - BATCH RANKING (Gemini Flash)
// ============================================

/**
 * Rank a batch of candidates against a screening matrix using Gemini Flash
 * ONE call per batch of ~25 candidates
 *
 * @param {Array<Object>} candidates - Array of candidate profile objects
 * @param {Object} matrix - Screening matrix from generateScreeningMatrixWithGemini
 * @returns {Array<Object>|null} - Array of ranking results or null on failure
 */
function rankCandidatesWithGemini(candidates, matrix) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('ERROR: GEMINI_API_KEY not set. Cannot rank candidates.');
    return null;
  }

  // Build compact candidate profiles for the prompt
  const candidateProfiles = candidates.map(c => ({
    uid: c.uid,
    name: c.full_name,
    title: c.current_title || 'Unknown',
    company: c.current_company || 'Unknown',
    skills: c.key_skills ? c.key_skills.substring(0, 200) : 'None listed',
    location: c.location || 'Unknown',
    comp: c.comp_target || 'Unknown',
    notes_snippet: c.notes_summary ? c.notes_summary.substring(0, 300) : 'No notes'
  }));

  const prompt = `You are ranking candidates against a job screening matrix.

SCREENING MATRIX:
${JSON.stringify(matrix, null, 0)}

CANDIDATES TO RANK (${candidateProfiles.length} candidates):
${JSON.stringify(candidateProfiles, null, 0)}

DATA NOTES:
- "skills" represents cumulative career tags (append-only). If "CPA" or "NetSuite" appears, treat it as a confirmed permanent capability regardless of when it was tagged.
- "notes_snippet" is truncated recruiter context. Use for historical signals and context clues.
- "comp" is shown for context but must NOT affect the match score.
- quality_tier is NOT provided. Do NOT penalize for missing quality data.

For each candidate, calculate match_pct (0-100):
- 0 = disqualified (structural mismatch per disqualifiers list). Set disqualified=true.
- 1-40 = weak match (missing most must_haves)
- 41-70 = moderate match (some must_haves, few strong_signals)
- 71-85 = good match (most must_haves, some strong_signals)
- 86-100 = strong match (all must_haves + multiple strong_signals)

RETURN a JSON array with one object per candidate:
[{"uid":"string","match_pct":number,"match_reasons":["strings"],"concerns":["strings"],"disqualified":boolean,"disqualify_reason":"string or null"}]

CONSTRAINTS:
- NEVER penalize for missing comp data or unknown location.
- Candidates with very little data (no title, no skills, no notes): score 30-50 with concern "limited data for reliable scoring".
- match_reasons: 2-4 short phrases explaining the score.
- concerns: 0-3 short phrases about what to investigate. Empty array if none.
- Return ONLY valid JSON array. No explanation, no markdown code blocks.`;

  try {
    // Use 2.0 Flash for ranking — no thinking tokens, ~3-5s per batch vs ~55s with 2.5 Flash
    // Matrix generation still uses Pro for strategic reasoning. This is mechanical classification.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 }
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);

    if (json.usageMetadata) {
      Logger.log(`  Ranking token usage: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}, Total=${json.usageMetadata.totalTokenCount || 0}`);
    }

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const text = json.candidates[0].content.parts[0].text.trim();
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const results = JSON.parse(cleanText);

      if (!Array.isArray(results)) {
        Logger.log('WARNING: Gemini returned non-array for ranking. Raw: ' + cleanText.substring(0, 300));
        return null;
      }

      return results;

    } else {
      Logger.log('WARNING: Gemini Flash returned no content for ranking. Response: ' + responseText.substring(0, 500));
      return null;
    }

  } catch (error) {
    Logger.log(`ERROR ranking candidates with Gemini: ${error.message}`);
    return null;
  }
}
