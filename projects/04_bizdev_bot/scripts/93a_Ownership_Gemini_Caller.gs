/**
 * 93a_Ownership_Gemini_Caller.gs
 * BD TRACKER - Ownership Classification Gemini API Caller
 * @execution batch
 * Version: 1.0.0
 *
 * CONTAINS:
 * - classifyOwnershipWithGemini_: Gemini API call for ownership classification
 *
 * SPLIT FROM: 93_Enrich_Ownership_Gemini.gs (lines 179-261)
 * CALLED BY: 93_Enrich_Ownership_Gemini.gs (Enrich_Ownership_With_Gemini)
 * DEPENDENCIES: 00_Brain_Config.gs (GEMINI_API_URL)
 */

/**
 * Call Gemini API to classify company ownership type
 * Returns one of: PE-backed, Private, Public, Venture-backed, Non-profit, Unclear
 *
 * @param {Object} context - {company, industry, size, revenue, lastFundingType, lastFundingAmount}
 * @param {string} apiKey - Gemini API key
 * @returns {string} - Ownership classification
 */
function classifyOwnershipWithGemini_(context, apiKey) {
  const prompt = `Classify the ownership type for this company based on the following data:

Company: ${context.company}
Industry: ${context.industry}
Size: ${context.size}
Revenue: ${context.revenue}
Last Funding Type: ${context.lastFundingType}
Last Funding Amount: ${context.lastFundingAmount}

Classify the ownership as ONE of these exact options (return the exact text):
- PE-backed
- Private
- Public
- Venture-backed
- Non-profit
- Unclear

Guidelines:
- Public: IPO, publicly traded companies
- PE-backed: Private Equity owned
- Venture-backed: VC-funded startups with Series A/B/C funding
- Private: Privately held, bootstrapped, no external funding
- Non-profit: Non-profit organizations, foundations, charities
- Unclear: Cannot determine from available data

Return ONLY ONE of the exact classifications above, no explanation.`;

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

  if (!classifyOwnershipWithGemini_.logged) {
    Logger.log('Gemini API response structure:');
    Logger.log(JSON.stringify(json, null, 2));
    classifyOwnershipWithGemini_.logged = true;
  }

  if (json.usageMetadata) {
    Logger.log(`  Token usage: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}, Thoughts=${json.usageMetadata.thoughtsTokenCount || 0}, Total=${json.usageMetadata.totalTokenCount || 0}`);
  }

  if (json.candidates && json.candidates[0] && json.candidates[0].content) {
    const text = json.candidates[0].content.parts[0].text.trim();
    return text;
  }

  Logger.log('Unexpected Gemini response format:');
  Logger.log(JSON.stringify(json));
  return '';
}
