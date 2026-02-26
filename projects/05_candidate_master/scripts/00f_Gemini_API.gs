/**
 * @file 00f_Gemini_API.gs
 * Core Gemini API enrichment — batch candidate enrichment via Gemini Flash
 *
 * PURPOSE: enrichCandidateWithGemini — used by 90_Gemini_Batch_Enrichment.gs
 * DEPENDENCIES: 00a_Config.gs (constants)
 * API KEY: Stored in PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')
 *
 * DeepDive extraction, historical title extraction, screening matrix generation,
 * and candidate ranking: see 00g_Gemini_Screening_API.gs
 *
 * @execution manual
 */

/**
 * Enrich candidate with Gemini using ALL available data (notes, location)
 * Used by batch enrichment to extract skills, quality tier, and normalize location
 * @param {Object} candidateData - { full_name, notes_summary, location }
 * @returns {Object|null} - { key_skills, quality_tier, normalized_location } or null
 */
function enrichCandidateWithGemini(candidateData) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('WARNING: GEMINI_API_KEY not set in Script Properties. Skipping enrichment.');
    return null;
  }

  const prompt = `Analyze this candidate profile and extract structured data:

CANDIDATE: ${candidateData.full_name}
RAW LOCATION: ${candidateData.location || 'Not specified'}
NOTES SUMMARY: ${candidateData.notes_summary || 'No notes available'}

INSTRUCTIONS:
1. Extract the MOST RECENT job title and company name from the notes (ignore historical positions unless it's the most recent mention)
2. Extract key accounting/finance technical skills mentioned (GL, bank recs, JE's, variance analysis, internal audit, SOX, forensic accounting, NetSuite, SAP, etc.)
3. Determine quality tier based on:
   - Big 4 experience (PwC, EY, Deloitte, KPMG) = A tier
   - CPA status (Active CPA, 4/4 CPA = higher tier)
   - Strong progression/titles = A/B tier
   - Weak/gaps = C tier
4. Normalize location to standard format:
   - "South OC", "southern Orange County", "south part of OC" -> "Orange County (South)"
   - "North OC" -> "Orange County (North)"
   - "OC", "Orange County" -> "Orange County"
   - "South LA", "southern LA" -> "Los Angeles (South)"
   - "LA", "Los Angeles" -> "Los Angeles"
   - "SD", "San Diego" -> "San Diego"
   - Specific cities stay as-is: "Irvine", "Costa Mesa", etc.

5. Extract compensation target if EXPLICITLY stated for this candidate (e.g., "looking for $120k", "currently at $95k", "offered $110k"). Do NOT extract comp from job posting ranges or unrelated numbers.

6. Return ONLY a JSON object in this exact format:
{
  "current_title": "most recent job title or null if not found",
  "current_company": "most recent company name or null if not found",
  "key_skills": "comma-separated list of technical skills or null if not found",
  "quality_tier": "A/B/C based on Big 4/CPA/progression or null if not enough data",
  "normalized_location": "standardized location string or null if not found",
  "comp_target": "salary figure like 120k or null if not explicitly stated for this candidate"
}

IMPORTANT:
- Return null for any field you cannot determine from the data
- For current_title/current_company, use the MOST RECENT mention (look for date-stamped notes)
- Keep key_skills focused on technical accounting/finance skills only (no soft skills)
- Keep quality_tier to single letter: "A", "B", or "C"
- Normalize location consistently
- Return ONLY the JSON object, no explanation or markdown

CRITICAL RULES (DO NOT HALLUCINATE):
- LOCATION: Only extract location if the candidate's city/region is EXPLICITLY stated in the notes or RAW LOCATION field. Do NOT infer location from recruiter signatures, area codes (949, 858, etc.), company addresses, or "Your Company Name". If no candidate location is explicitly mentioned, return null.
- COMP: Only extract comp_target if a dollar amount or salary figure is EXPLICITLY tied to the candidate's compensation expectations, current salary, or offer amount. Do NOT extract comp from job listing salary ranges, role descriptions, or unrelated dollar amounts. If unclear who the comp belongs to, return null.
- When in doubt, return null. False data is worse than missing data.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.1
        // NO maxOutputTokens limit - run tests first to see actual usage
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

    // Log token usage for analysis
    if (json.usageMetadata) {
      Logger.log(`  Enrichment token usage: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}, Total=${json.usageMetadata.totalTokenCount || 0}`);
    }

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const text = json.candidates[0].content.parts[0].text.trim();

      // Remove markdown code blocks if present
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleanText);

      return {
        current_title: result.current_title || null,
        current_company: result.current_company || null,
        key_skills: result.key_skills || null,
        quality_tier: result.quality_tier || null,
        normalized_location: result.normalized_location || null,
        comp_target: result.comp_target || null
      };

    } else {
      Logger.log('WARNING: Gemini API returned no candidates. Response: ' + responseText);
      return null;
    }

  } catch (error) {
    Logger.log(`ERROR enriching candidate with Gemini: ${error.message}`);
    return null;
  }
}

// DeepDive extraction, historical title extraction, screening matrix generation,
// and candidate ranking: see 00g_Gemini_Screening_API.gs
