/**
 * GEMINI ENRICHMENT: Region Tier 3 Assessment
 *
 * PURPOSE:
 * Assess California operations presence for companies with blank Region column
 *
 * PATTERN:
 * Same as Industry/Size/Revenue normalization - reads Company_Master, enriches with Gemini
 *
 * USAGE:
 * Menu → Maintenance → Enrich Region Tier 3 with Gemini (manual trigger)
 * Or call: Enrich_Region_Tier3_With_Gemini()
 */

/**
 * Main enrichment function - processes companies with blank Region (Column J)
 * USER-FACING (called from menu)
 */
function Enrich_Region_Tier3_With_Gemini() {
  const ss = getSpreadsheet_();
  const coSheet = ss.getSheetByName('Company_Master');

  if (!coSheet) {
    SpreadsheetApp.getUi().alert('❌ Error: Company_Master tab not found');
    return;
  }

  // Find companies with blank Column J (Region)
  const lastRow = coSheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('✅ No data to enrich');
    return;
  }

  const data = coSheet.getRange(2, 1, lastRow - 1, 11).getValues(); // A-K

  const toEnrich = [];
  for (let i = 0; i < data.length; i++) {
    const domain = data[i][0];      // A: Domain
    const company = data[i][1];     // B: Company
    const city = data[i][8];        // I: HQ City
    const state = data[i][10];      // K: HQ State
    const region = data[i][9];      // J: Region

    if (domain && !region) {
      toEnrich.push({
        rowNum: i + 2,
        domain: domain,
        company: company,
        city: city || 'Unknown',
        state: state || 'Unknown'
      });
    }
  }

  if (toEnrich.length === 0) {
    SpreadsheetApp.getUi().alert('✅ All companies have Region assigned!');
    return;
  }

  Logger.log(`Found ${toEnrich.length} companies needing Tier 3 region assessment`);

  // Process in batches
  const BATCH_SIZE = 20;
  const MAX_PER_RUN = 20; // Reduced to stay under 6-minute timeout
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);

  let enrichedCount = 0;
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    SpreadsheetApp.getUi().alert('❌ Error: GEMINI_API_KEY not found in Script Properties');
    return;
  }

  for (let i = 0; i < toEnrichThisRun.length; i += BATCH_SIZE) {
    const batch = toEnrichThisRun.slice(i, i + BATCH_SIZE);

    for (const item of batch) {
      const assessment = assessCAOperations_(item, apiKey);

      let regionValue = "";
      if (assessment === "California Operations") {
        regionValue = "Major CA Ops";
      } else {
        regionValue = "Remote/International";
      }

      coSheet.getRange(item.rowNum, 10).setValue(regionValue); // J: Region
      enrichedCount++;

      Logger.log(`Row ${item.rowNum}: ${item.company} → ${regionValue}`);
    }

    Utilities.sleep(2000); // Rate limit between batches
  }

  const ui = SpreadsheetApp.getUi();
  ui.alert(
    `✅ Region Tier 3 Enrichment Complete!`,
    `Enriched ${enrichedCount} companies\n` +
    `Remaining: ${toEnrich.length - enrichedCount}\n\n` +
    `Run again to process more.`,
    ui.ButtonSet.OK
  );
}

/**
 * Call Gemini to assess California operations presence
 *
 * @param {Object} context - {domain, company, city, state}
 * @param {string} apiKey - Gemini API key
 * @returns {string} - "California Operations" or "No California Presence"
 */
function assessCAOperations_(context, apiKey) {
  const prompt = `Analyze company ${context.company} (domain: ${context.domain}).
HQ Location: ${context.city}, ${context.state}

Question: Does this company have major operations in California, California-based executives, or strong California business presence?

Guidelines:
- Look for: CA offices, CA-based leadership, CA customer base, CA operations
- Ignore: Brief mentions, historical references, minor partnerships

Return ONLY one of these exact phrases (no explanation):
- "California Operations"
- "No California Presence"`;

  const url = `${GEMINI_API_URL}?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 5000  // Safety ceiling to prevent runaway costs
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

    // Log full response for debugging
    if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
      Logger.log(`Warning: Empty response for ${context.domain}`);
      Logger.log(`API Response: ${JSON.stringify(json)}`);
      return "No California Presence"; // Default to safe option
    }

    const text = json.candidates[0].content.parts[0].text.trim();

    // Log token usage if available
    if (json.usageMetadata) {
      Logger.log(`  Tokens - Input: ${json.usageMetadata.promptTokenCount}, Output: ${json.usageMetadata.candidatesTokenCount}`);
    }

    // Validate response
    if (text.includes("California Operations")) {
      return "California Operations";
    } else {
      return "No California Presence";
    }

  } catch (e) {
    Logger.log(`Error assessing ${context.domain}: ${e.toString()}`);
    return "No California Presence"; // Default to safe option
  }
}
