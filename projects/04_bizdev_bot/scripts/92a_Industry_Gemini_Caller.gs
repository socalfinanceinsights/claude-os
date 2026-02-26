/**
 * 92a_Industry_Gemini_Caller.gs
 * BD TRACKER - Industry Normalization Gemini API Caller
 * @execution batch
 * Version: 1.0.0
 *
 * CONTAINS:
 * - normalizeIndustryWithGemini_: Gemini API call for industry classification
 *
 * SPLIT FROM: 92_Enrich_Industry_Gemini.gs (lines 182-290)
 * CALLED BY: 92_Enrich_Industry_Gemini.gs (Enrich_Industry_With_Gemini)
 * DEPENDENCIES: 00_Brain_Config.gs (GEMINI_API_URL)
 */

/**
 * Call Gemini API to normalize industry classifications
 *
 * @param {Object} context - {domain, source, primaryRaw, subRaw}
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - {primary: string, sub: string}
 */
function normalizeIndustryWithGemini_(context, apiKey) {
  const INDUSTRY_MAP = [
    'Technology & Software',
    'Biotech & Life Sciences',
    'Aerospace & Defense',
    'Manufacturing & Industrial',
    'Consumer Packaged Goods (Food & Cosmetic)',
    'Consumer Goods (Apparel, Electronics)',
    'Real Estate Dev. & Construction',
    'E-commerce Businesses',
    'Healthcare Services & Hospitals',
    'Real Estate Management (REITs)',
    'Real Estate Tech & PropTech',
    'Logistics & Supply Chain',
    'Professional Services (legal, consulting, etc.)',
    'Wholesale Trade',
    'Financial Services & Insurance',
    'Transportation & Logistics (beyond 3PL)',
    'Retail Trade (brick-and-mortar)',
    'Leisure & Hospitality',
    'Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)'
  ];

  const prompt = `Normalize the following company industry data into our standardized industry classification system.

Company: ${context.domain}
Source: ${context.source}
Raw Primary Industry: ${context.primaryRaw}
Raw Sub-Industry: ${context.subRaw}

INSTRUCTIONS:
1. Analyze the raw industry data and classify the company into ONE of these EXACT primary industries:
${INDUSTRY_MAP.map((ind, i) => `   ${i + 1}. ${ind}`).join('\n')}

2. For the sub-industry, provide a brief, specific sub-category (2-4 words) that describes the company's niche within the primary industry.

3. Return ONLY a JSON object in this exact format:
{
  "primary": "exact primary industry from list above",
  "sub": "specific sub-category (2-4 words)"
}

IMPORTANT:
- The "primary" field MUST exactly match one of the 19 options above (including punctuation)
- The "sub" field should be concise and specific (examples: "SaaS Platform", "Medical Devices", "Commercial Real Estate")
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
      maxOutputTokens: 256,
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

  if (!normalizeIndustryWithGemini_.logged) {
    Logger.log('Gemini API response structure:');
    Logger.log(JSON.stringify(json, null, 2));
    normalizeIndustryWithGemini_.logged = true;
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
        primary: result.primary || '',
        sub: result.sub || ''
      };
    } catch (parseError) {
      Logger.log(`Failed to parse Gemini JSON response: ${text}`);
      return { primary: '', sub: '' };
    }
  }

  Logger.log('Unexpected Gemini response format:');
  Logger.log(JSON.stringify(json));
  return { primary: '', sub: '' };
}
