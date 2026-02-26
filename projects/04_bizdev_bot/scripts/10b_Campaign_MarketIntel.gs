/**
 * 10b_Campaign_MarketIntel.gs
 * @execution manual
 * Market intelligence via Serper + Gemini
 * Input: array of unique company domains
 * Output: map of domain -> intel object
 */

/**
 * Fetch market intelligence for company domains via Serper + Gemini
 * @param {string[]} domains - Array of unique company domain strings
 * @returns {Object} - Map of domain -> { events: [...], summary: "..." }
 */
function fetchMarketIntel(domains) {
  if (!domains || domains.length === 0) {
    return {};
  }

  var serperKey = getSerperAPIKey();
  if (!serperKey) {
    logCampaignError('Serper API key not configured — skipping market intel');
    return {};
  }

  // Step 1: Fetch Serper results for each domain
  var serperResults = {};
  var domainsQueried = 0;

  for (var d = 0; d < domains.length; d++) {
    var domain = domains[d];
    if (!domain || !domain.trim()) continue;

    try {
      var response = UrlFetchApp.fetch('https://google.serper.dev/search', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-API-KEY': serperKey },
        payload: JSON.stringify({
          q: '"' + domain + '" news OR announcement OR funding OR hire',
          num: MARKET_INTEL_CONFIG.maxResultsPerDomain
        }),
        muteHttpExceptions: true
      });

      if (response.getResponseCode() === 200) {
        var result = JSON.parse(response.getContentText());
        if (result.organic && result.organic.length > 0) {
          serperResults[domain] = result.organic;
          domainsQueried++;
        }
      }
    } catch (error) {
      logCampaignError('Serper fetch failed for ' + domain + ': ' + error.message);
      // Non-blocking: skip this domain
    }
  }

  if (domainsQueried === 0) {
    logCampaignAction('Market intel: no Serper results found for any domain');
    return {};
  }

  // Step 2: Call Gemini to extract structured intel
  try {
    var geminiKey = getGeminiAPIKey();
    if (!geminiKey) {
      logCampaignError('Gemini API key not configured — returning empty intel');
      return {};
    }

    // Format Serper results for Gemini
    var userPrompt = 'Analyze the following search results by domain:\n\n';
    var domainKeys = Object.keys(serperResults);
    for (var i = 0; i < domainKeys.length; i++) {
      var dk = domainKeys[i];
      userPrompt += '[' + dk + ']\n';
      var items = serperResults[dk];
      for (var j = 0; j < items.length; j++) {
        userPrompt += '[' + (j + 1) + '] Title: ' + (items[j].title || '') + ' Snippet: ' + (items[j].snippet || '') + ' URL: ' + (items[j].link || '') + '\n';
      }
      userPrompt += '\n';
    }

    var extractionPrompt = 'You are a market intelligence analyst for an executive recruiting firm focused on accounting and finance in Southern California.\n\nAnalyze the search results and extract recruiting-relevant events. Only include:\n- Leadership changes (CFO, Controller, VP Finance hires/departures)\n- Infrastructure/Compliance events (SOX, ERP migration, audit changes)\n- Capital events (funding, IPO, acquisition, restructuring)\n\nFor each domain, return:\n{\n  "domains": {\n    "<domain>": {\n      "events": [\n        {\n          "event_type": "Leadership|Infrastructure|Capital",\n          "headline": "short headline",\n          "recruiting_angle": "why this matters for placing candidates",\n          "linkedin_hook": "1-line hook under 200 chars"\n        }\n      ],\n      "summary": "1-2 sentence recruiting-relevant summary"\n    }\n  }\n}\n\nIf no relevant events found for a domain, return empty events array.\nReturn ONLY the JSON object, no additional text.';

    var geminiPayload = {
      system_instruction: {
        parts: [{ text: extractionPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: MARKET_INTEL_CONFIG.extractionTemp,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 8192
      }
    };

    var geminiResponse = UrlFetchApp.fetch(
      GEMINI_API_URL + '?key=' + geminiKey,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(geminiPayload),
        muteHttpExceptions: true
      }
    );

    if (geminiResponse.getResponseCode() !== 200) {
      logCampaignError('Gemini API error: ' + geminiResponse.getResponseCode());
      return {};
    }

    var geminiResult = JSON.parse(geminiResponse.getContentText());
    var extractedText = geminiResult.candidates[0].content.parts[0].text;
    var extracted = JSON.parse(extractedText);

    var intelMap = extracted.domains || {};

    // Count total events
    var totalEvents = 0;
    var intelKeys = Object.keys(intelMap);
    for (var k = 0; k < intelKeys.length; k++) {
      totalEvents += (intelMap[intelKeys[k]].events || []).length;
    }

    logCampaignAction('Market intel: ' + domainsQueried + ' domains queried, ' + totalEvents + ' events extracted');

    return intelMap;

  } catch (error) {
    logCampaignError('Gemini extraction failed: ' + error.message);
    return {};
  }
}
