/**
 * 94a_SizeRevenue_Gemini_Caller.gs
 * BD TRACKER - Size/Revenue Normalization Gemini API Callers
 * @execution batch
 * Version: 1.0.0
 *
 * CONTAINS:
 * - normalizeSizeRevenue_: Gemini API call for size/revenue normalization
 * - buildNormalizationPrompt_: Builds the Gemini prompt
 * - parseNormalizationResponse_: Parses Gemini output
 *
 * SPLIT FROM: 94_Enrich_SizeRevenue_Gemini.gs (lines 112-305)
 * CALLED BY: 94_Enrich_SizeRevenue_Gemini.gs (Enrich_SizeRevenue_With_Gemini)
 * DEPENDENCIES: 00_Brain_Config.gs (GEMINI_API_URL)
 */

/**
 * Call Gemini to normalize size/revenue data
 *
 * @param {Object} context - {domain, source, sizeRaw, revenueRaw, sizeNorm, revenueNorm}
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - {sizeNorm, revenueNorm}
 */
function normalizeSizeRevenue_(context, apiKey) {
  const prompt = buildNormalizationPrompt_(context);

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

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());

    if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
      Logger.log(`Warning: Empty response for ${context.domain}`);
      Logger.log(`API Response: ${JSON.stringify(json)}`);
      return {
        sizeNorm: context.sizeNorm || 'Unknown / Undisclosed',
        revenueNorm: context.revenueNorm || 'Revenue Unknown / Undisclosed'
      };
    }

    const text = json.candidates[0].content.parts[0].text.trim();

    if (json.usageMetadata) {
      Logger.log(`  Tokens - Input: ${json.usageMetadata.promptTokenCount}, Output: ${json.usageMetadata.candidatesTokenCount}`);
    }

    return parseNormalizationResponse_(text, context);

  } catch (e) {
    Logger.log(`Error normalizing ${context.domain}: ${e.toString()}`);
    return {
      sizeNorm: context.sizeNorm || 'Unknown / Undisclosed',
      revenueNorm: context.revenueNorm || 'Revenue Unknown / Undisclosed'
    };
  }
}

/**
 * Build Gemini prompt for size/revenue normalization
 *
 * @param {Object} context - {domain, source, sizeRaw, revenueRaw}
 * @returns {string} - Prompt string
 */
function buildNormalizationPrompt_(context) {
  const prompt = `Normalize company size and revenue data to match standardized categories.

Company: ${context.domain}
Source: ${context.source}

Raw Data:
- Company Size: "${context.sizeRaw}"
- Company Revenue: "${context.revenueRaw}"

VALID SIZE CATEGORIES (use EXACTLY these values):
- "Employees < 20"
- "Employees 20–99"
- "Employees 100–249"
- "Employees 250–499"
- "Employees 500–999"
- "Employees 1,000–4,999"
- "Employees 5,000-10,000"
- "Employees >10,000"
- "Unknown / Undisclosed"

VALID REVENUE CATEGORIES (use EXACTLY these values):
- "Revenue < $1M"
- "Revenue $1M - $9.99M"
- "Revenue $10M - $49.99M"
- "Revenue $50M - $99.99M"
- "Revenue $100M - $499.99M"
- "Revenue $500M - $999.99M"
- "Revenue $1B - $2.99B"
- "Revenue >= $3B"
- "Revenue Unknown / Undisclosed"

NORMALIZATION RULES:
1. Map raw size to the appropriate employee range category
2. Map raw revenue to the appropriate revenue range category
3. Use "Unknown / Undisclosed" ONLY if data is truly missing (blank/empty)
4. For ranges that span multiple categories, use the category that best represents the UPPER bound (benefit of doubt)
5. Common mappings (use these as examples):
   - SIZE: "1-10" → "Employees < 20"
   - SIZE: "11-50" → "Employees 20–99"
   - SIZE: "51-200" → "Employees 100–249"
   - SIZE: "101-250" → "Employees 100–249"
   - SIZE: "201-500" → "Employees 250–499"
   - SIZE: "251-500" → "Employees 250–499"
   - SIZE: "501-1000" → "Employees 500–999"
   - SIZE: "1001-5000" → "Employees 1,000–4,999"
   - SIZE: "5001-10000" → "Employees 5,000-10,000"
   - SIZE: "10001+" → "Employees >10,000"
   - REVENUE: "$1M to $10M" → "Revenue $10M - $49.99M" (upper bound)
   - REVENUE: "$10M-$50M" → "Revenue $10M - $49.99M"
   - REVENUE: "$100M to $500M" → "Revenue $100M - $499.99M"
   - REVENUE: "$1B to $10B" → "Revenue >= $3B" (midpoint ~$5B)
   - REVENUE: "$500M to $1B" → "Revenue $500M - $999.99M"

OUTPUT FORMAT (use EXACTLY this format):
SIZE: [one of the valid size categories]
REVENUE: [one of the valid revenue categories]

Example:
SIZE: Employees 100–249
REVENUE: Revenue $10M - $49.99M`;

  return prompt;
}

/**
 * Parse Gemini response to extract normalized size/revenue
 * Validates against allowed values and falls back to defaults
 *
 * @param {string} text - Gemini response text
 * @param {Object} context - Original context (for fallback defaults)
 * @returns {Object} - {sizeNorm, revenueNorm}
 */
function parseNormalizationResponse_(text, context) {
  let sizeNorm = context.sizeNorm || 'Unknown / Undisclosed';
  let revenueNorm = context.revenueNorm || 'Revenue Unknown / Undisclosed';

  const sizeMatch = text.match(/SIZE:\s*(.+)/i);
  if (sizeMatch) {
    sizeNorm = sizeMatch[1].trim();
  }

  const revenueMatch = text.match(/REVENUE:\s*(.+)/i);
  if (revenueMatch) {
    revenueNorm = revenueMatch[1].trim();
  }

  const validSizes = [
    'Employees < 20',
    'Employees 20–99',
    'Employees 100–249',
    'Employees 250–499',
    'Employees 500–999',
    'Employees 1,000–4,999',
    'Employees 5,000-10,000',
    'Employees >10,000',
    'Unknown / Undisclosed'
  ];

  const validRevenues = [
    'Revenue < $1M',
    'Revenue $1M - $9.99M',
    'Revenue $10M - $49.99M',
    'Revenue $50M - $99.99M',
    'Revenue $100M - $499.99M',
    'Revenue $500M - $999.99M',
    'Revenue $1B - $2.99B',
    'Revenue >= $3B',
    'Revenue Unknown / Undisclosed'
  ];

  if (!validSizes.includes(sizeNorm)) {
    Logger.log(`Warning: Invalid size normalization "${sizeNorm}" for ${context.domain}, using default`);
    sizeNorm = 'Unknown / Undisclosed';
  }

  if (!validRevenues.includes(revenueNorm)) {
    Logger.log(`Warning: Invalid revenue normalization "${revenueNorm}" for ${context.domain}, using default`);
    revenueNorm = 'Revenue Unknown / Undisclosed';
  }

  return { sizeNorm, revenueNorm };
}
