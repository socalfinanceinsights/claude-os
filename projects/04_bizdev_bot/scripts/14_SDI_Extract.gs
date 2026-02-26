/**
 * 14_SDI_Extract.gs
 * SDI Scout - Gemini Signal Extraction & Classification
 * Version: 1.0.0
 *
 * PURPOSE: Takes raw Serper results, extracts structured company signals
 *          using Gemini Flash. Validates against subtype maps.
 * DEPENDENCIES: 13_SDI_Config.gs, 00_Brain_Config.gs
 */

// ============================================
// SIGNAL EXTRACTION
// ============================================

/**
 * Extract structured company signals from Serper results using Gemini Flash.
 * Processes in batches to manage prompt size.
 *
 * @param {Array<Object>} serperResults - Array of {title, link, snippet, date, query}
 * @returns {Object} - { events: Array<Object>, approachAngles: Object<domain, string> }
 */
function extractCompanySignals_(serperResults) {
  if (!serperResults || serperResults.length === 0) {
    return { events: [], approachAngles: {} };
  }

  const apiKey = getGeminiAPIKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set in Script Properties');
  }

  const batchSize = SDI_CONFIG.extractionBatchSize;
  const totalBatches = Math.ceil(serperResults.length / batchSize);
  const allEvents = [];
  const approachAngles = {}; // domain → best approach angle

  Logger.log(`  Extracting signals: ${serperResults.length} results in ${totalBatches} batches`);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const start = batchIdx * batchSize;
    const end = Math.min(start + batchSize, serperResults.length);
    const batch = serperResults.slice(start, end);

    Logger.log(`  Extraction batch ${batchIdx + 1}/${totalBatches}: results ${start + 1}-${end}`);

    try {
      const batchEvents = extractBatch_(batch, apiKey);

      for (const event of batchEvents) {
        // Validate event_type
        if (!isValidEventType_(event.event_type)) {
          Logger.log(`    WARNING: Invalid event_type "${event.event_type}" — skipping`);
          continue;
        }

        // Validate subtype
        if (!isValidSubtype_(event.event_type, event.subtype)) {
          Logger.log(`    WARNING: Invalid subtype "${event.subtype}" for type "${event.event_type}" — skipping`);
          continue;
        }

        // Validate event_date (must be parseable)
        if (!event.event_date || isNaN(new Date(event.event_date).getTime())) {
          event.event_date = Utilities.formatDate(new Date(), CONFIG.timezone, 'yyyy-MM-dd');
        }

        allEvents.push(event);

        // Track approach angles by domain (keep first/best one)
        const domain = String(event.domain || '').toLowerCase();
        if (domain && event.approach_context && !approachAngles[domain]) {
          approachAngles[domain] = event.approach_context;
        }
      }

    } catch (e) {
      Logger.log(`    ERROR in extraction batch ${batchIdx + 1}: ${e.message}`);
      // Continue with next batch
    }

    // Rate limit between batches
    if (batchIdx < totalBatches - 1) {
      Utilities.sleep(SDI_CONFIG.geminiDelayMs);
    }
  }

  Logger.log(`  Extraction complete: ${allEvents.length} valid events from ${serperResults.length} results`);
  return { events: allEvents, approachAngles: approachAngles };
}

/**
 * Extract signals from a single batch of Serper results.
 *
 * @param {Array<Object>} batch - Batch of Serper results
 * @param {string} apiKey - Gemini API key
 * @returns {Array<Object>} - Extracted event objects
 */
function extractBatch_(batch, apiKey) {
  const prompt = buildExtractionPrompt_(batch);
  const url = SDI_CONFIG.geminiFlashEndpoint + '?key=' + apiKey;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());

  if (json.usageMetadata) {
    Logger.log(`    Extraction tokens: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}`);
  }

  if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
    Logger.log('    WARNING: Gemini returned no content for extraction batch');
    return [];
  }

  const text = json.candidates[0].content.parts[0].text.trim();
  const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    const events = JSON.parse(cleanText);
    if (!Array.isArray(events)) {
      Logger.log('    WARNING: Gemini returned non-array for extraction');
      return [];
    }
    return events;
  } catch (e) {
    Logger.log(`    ERROR parsing extraction response: ${cleanText.substring(0, 300)}`);
    return [];
  }
}
