/**
 * 14_SDI_Search.gs
 * SDI Scout - Search Query Generation & Execution
 * Version: 1.0.0
 *
 * PURPOSE: Takes candidate profile, generates smart Serper queries via Gemini,
 *          executes them, returns deduplicated results.
 * DEPENDENCIES: 13_SDI_Config.gs, 00_Brain_Config.gs
 */

// ============================================
// QUERY GENERATION (Gemini-powered)
// ============================================

/**
 * Generate 3-5 Serper search queries from a candidate profile using Gemini Flash.
 *
 * @param {string} candidateProfile - Free-text candidate profile
 * @param {string} geo - Geographic focus
 * @param {number} timeWindowDays - Lookback window
 * @returns {Array<string>} - Array of query strings
 */
function generateSearchQueries_(candidateProfile, geo, timeWindowDays) {
  const apiKey = getGeminiAPIKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set in Script Properties');
  }

  const prompt = buildQueryGenerationPrompt_(candidateProfile, geo, timeWindowDays);
  const url = SDI_CONFIG.geminiFlashEndpoint + '?key=' + apiKey;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());

  if (json.usageMetadata) {
    Logger.log(`  Query generation tokens: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}`);
  }

  if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
    Logger.log('WARNING: Gemini returned no content for query generation');
    throw new Error('Gemini failed to generate search queries');
  }

  const text = json.candidates[0].content.parts[0].text.trim();
  const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    const queries = JSON.parse(cleanText);
    if (!Array.isArray(queries) || queries.length === 0) {
      throw new Error('Gemini returned empty or non-array queries');
    }
    Logger.log(`  Generated ${queries.length} search queries`);
    return queries.slice(0, SDI_CONFIG.serperQueriesPerRun);
  } catch (e) {
    Logger.log(`ERROR parsing query generation response: ${cleanText.substring(0, 300)}`);
    throw new Error('Failed to parse Gemini query response: ' + e.message);
  }
}

// ============================================
// SERPER EXECUTION
// ============================================

/**
 * Execute Serper search queries and return deduplicated results.
 *
 * @param {Array<string>} queries - Array of query strings
 * @returns {Array<Object>} - Array of {title, link, snippet, date, query} deduplicated by URL
 */
function executeSerperQueries_(queries) {
  const apiKey = getSerperAPIKey();
  if (!apiKey) {
    throw new Error('SERPER_API_KEY not set in Script Properties');
  }

  const allResults = [];
  const seenUrls = new Set();

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    Logger.log(`  Serper query ${i + 1}/${queries.length}: "${query}"`);

    try {
      const results = executeOneSerperQuery_(query, apiKey);

      for (const result of results) {
        const normalizedUrl = normalizeUrl_(result.link);
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);

        allResults.push({
          title: result.title || '',
          link: result.link || '',
          snippet: result.snippet || '',
          date: result.date || '',
          query: query
        });
      }

      Logger.log(`    Got ${results.length} results (${allResults.length} total unique)`);
    } catch (e) {
      Logger.log(`    ERROR on query "${query}": ${e.message}`);
      // Continue with next query
    }

    // Rate limit between queries
    if (i < queries.length - 1) {
      Utilities.sleep(SDI_CONFIG.serperDelayMs);
    }
  }

  Logger.log(`  Serper total: ${allResults.length} unique results from ${queries.length} queries`);
  return allResults;
}

/**
 * Execute a single Serper search query.
 *
 * @param {string} query - Search query
 * @param {string} apiKey - Serper API key
 * @returns {Array<Object>} - Array of organic results
 */
function executeOneSerperQuery_(query, apiKey) {
  const payload = {
    q: query,
    num: SDI_CONFIG.serperResultsPerQuery
  };

  const response = UrlFetchApp.fetch(SDI_CONFIG.serperEndpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-API-KEY': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(`Serper returned HTTP ${code}: ${response.getContentText().substring(0, 200)}`);
  }

  const json = JSON.parse(response.getContentText());
  return json.organic || [];
}

/**
 * Normalize URL for deduplication.
 * Strips protocol, www, trailing slash, query params.
 *
 * @param {string} url - Raw URL
 * @returns {string} - Normalized URL
 */
function normalizeUrl_(url) {
  if (!url) return '';
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '');
}
