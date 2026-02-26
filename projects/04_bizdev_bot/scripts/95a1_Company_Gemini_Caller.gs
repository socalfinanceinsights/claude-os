/**
 * 95a1_Company_Gemini_Caller.gs
 * BD TRACKER - Company/Domain Inference Gemini API Caller
 * @execution batch
 * Version: 1.0.0
 *
 * CONTAINS:
 * - inferCompanyWithGemini_: Gemini API call to infer company name and domain
 *
 * SPLIT FROM: 95a_Enrich_Company_Gemini.gs (lines 195-286)
 * CALLED BY: 95a_Enrich_Company_Gemini.gs (enrichCompanyHeadless_)
 * DEPENDENCIES: 00_Brain_Config.gs (GEMINI_API_URL)
 */

/**
 * Call Gemini API to infer company name and domain
 * Only returns a result if company can be determined with reasonable confidence
 *
 * @param {Object} context - {name: string, source: string}
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - {company: string, domain: string}
 */
function inferCompanyWithGemini_(context, apiKey) {
  const prompt = `Infer the most likely company name and domain for the following person:

Person Name: ${context.name}
Source: ${context.source}

INSTRUCTIONS:
1. Based on the person's name and the source where they were found, infer their current employer
2. Return ONLY a JSON object in this exact format:
{
  "company": "Company Name",
  "domain": "company.com"
}

IMPORTANT:
- Only return a result if you can determine the company with reasonable confidence
- If the source provides clear context (e.g., "LinkedIn - Google", "Lusha import from Apple Inc."), use that
- For the domain, return ONLY the root domain (e.g., "google.com", NOT "www.google.com" or "https://google.com")
- If you cannot determine the company with reasonable confidence, return empty strings:
  {"company": "", "domain": ""}
- Do NOT guess or make assumptions without clear evidence
- Return ONLY the JSON object, no explanation or additional text`;

  const url = `${GEMINI_API_URL}?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 5000
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

  if (!inferCompanyWithGemini_.logged) {
    Logger.log('Gemini API response structure:');
    Logger.log(JSON.stringify(json, null, 2));
    inferCompanyWithGemini_.logged = true;
  }

  if (json.usageMetadata) {
    Logger.log(`  Token usage: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}, Thoughts=${json.usageMetadata.thoughtsTokenCount || 0}, Total=${json.usageMetadata.totalTokenCount || 0}`);
  }

  if (json.candidates && json.candidates[0] && json.candidates[0].content) {
    const text = json.candidates[0].content.parts[0].text.trim();

    try {
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleanText);

      return {
        company: result.company || '',
        domain: result.domain || ''
      };
    } catch (parseError) {
      Logger.log(`Failed to parse Gemini JSON response: ${text}`);
      return { company: '', domain: '' };
    }
  }

  Logger.log('Unexpected Gemini response format:');
  Logger.log(JSON.stringify(json));
  return { company: '', domain: '' };
}
