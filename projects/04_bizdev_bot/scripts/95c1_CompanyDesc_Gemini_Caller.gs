/**
 * 95c1_CompanyDesc_Gemini_Caller.gs
 * BD TRACKER - Company Description Gemini Caller & Headless Enrichment
 * @execution batch
 * Version: 1.0.0
 *
 * CONTAINS:
 * - enrichCompanyDescriptionHeadless_: Headless enrichment for chain orchestration
 * - generateCompanyDescriptionWithGemini_: Gemini API call for company descriptions
 *
 * SPLIT FROM: 95c_Enrich_CompanyDescription_Gemini.gs (lines 191-404)
 * CALLED BY: 95c_Enrich_CompanyDescription_Gemini.gs (Enrich_CompanyDescription_With_Gemini)
 *            90_Gemini_Batch_Enrichment.gs (enrichment chain)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, GEMINI_API_URL, isoNow_)
 */

/**
 * Headless function for enrichment chain
 * Returns processing stats for chain orchestration
 *
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - {processed, remaining, errors, skipped}
 */
function enrichCompanyDescriptionHeadless_(apiKey) {
  const ss = getSpreadsheet_();
  const companySheet = ss.getSheetByName(CONFIG.sheetCompany);

  if (!companySheet) {
    Logger.log('ERROR: Company_Master sheet not found');
    return { processed: 0, remaining: 0, errors: 1, skipped: 0 };
  }

  const lastRow = companySheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No companies found in Company_Master');
    return { processed: 0, remaining: 0, errors: 0, skipped: 0 };
  }

  // Read company data (need at least 29 columns to include Last_Enrichment)
  const data = companySheet.getRange(2, 1, lastRow - 1, 29).getValues();

  // Find rows that need enrichment
  const toEnrich = [];

  for (let i = 0; i < data.length; i++) {
    const domain = String(data[i][0]).trim(); // A: Domain
    const description = String(data[i][2]).trim(); // C: Description
    const lastUpdated = data[i][27]; // AB: Last_Updated (idx 27)
    const lastEnrichment = data[i][28]; // AC: Last_Enrichment (idx 28)

    if (domain) {
      // Eligible if: (no enrichment timestamp) OR (Last_Updated > Last_Enrichment)
      const needsEnrichment = !description && (!lastEnrichment || (lastUpdated && lastUpdated > lastEnrichment));

      if (needsEnrichment) {
        toEnrich.push(i + 2); // Store actual row number
      }
    }
  }

  Logger.log(`Company Description enrichment: ${toEnrich.length} records need processing`);

  if (toEnrich.length === 0) {
    return { processed: 0, remaining: 0, errors: 0, skipped: 0 };
  }

  // Limit to first 20 per run
  const MAX_PER_RUN = 20;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  const remaining = toEnrich.length - toEnrichThisRun.length;

  let enrichedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let rowNum of toEnrichThisRun) {
    try {
      const rowData = companySheet.getRange(rowNum, 1, 1, 29).getValues()[0];

      const domain = String(rowData[0]).trim();
      const companyName = String(rowData[1]).trim();

      if (!domain && !companyName) {
        skippedCount++;
        continue;
      }

      const context = {
        domain: domain || 'Unknown',
        companyName: companyName || 'Unknown'
      };

      const result = generateCompanyDescriptionWithGemini_(context, apiKey);

      // Write description (even if empty — prevents retry loop)
      if (result.description !== null) {
        companySheet.getRange(rowNum, 3).setValue(result.description);
        enrichedCount++;
      } else {
        errorCount++;
      }

      // CRITICAL: Stamp Last_Enrichment on EVERY attempt
      companySheet.getRange(rowNum, 29).setValue(isoNow_());

    } catch (err) {
      Logger.log(`  Error enriching row ${rowNum}: ${err.toString()}`);
      errorCount++;

      // CRITICAL: Stamp Last_Enrichment even on error
      try {
        companySheet.getRange(rowNum, 29).setValue(isoNow_());
      } catch (stampErr) {
        Logger.log(`  Failed to stamp Last_Enrichment: ${stampErr.toString()}`);
      }
    }

    // Rate limiting
    if ((toEnrichThisRun.indexOf(rowNum) + 1) % 20 === 0) {
      Utilities.sleep(1000);
    }
  }

  SpreadsheetApp.flush();

  Logger.log(`Company Description enrichment complete: ${enrichedCount} processed, ${errorCount} errors, ${remaining} remaining`);

  return {
    processed: enrichedCount,
    remaining: remaining,
    errors: errorCount,
    skipped: skippedCount
  };
}

/**
 * Call Gemini API to generate company description
 * Returns {description: string} or {description: null} on API error
 *
 * @param {Object} context - {domain, companyName}
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - {description: string|null}
 */
function generateCompanyDescriptionWithGemini_(context, apiKey) {
  const prompt = `Generate a brief 2-3 sentence description of the following company.

Company Name: ${context.companyName}
Domain: ${context.domain}

INSTRUCTIONS:
1. Write a 2-3 sentence description of what the company does
2. Focus on: the company's primary business, its industry, and approximate size/scope if determinable
3. Keep it factual and professional — no marketing language
4. If you cannot find reliable information about this company, return an empty string

Return ONLY a JSON object in this exact format:
{
  "description": "2-3 sentence company description"
}

IMPORTANT:
- If you cannot find information, return: {"description": ""}
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
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 }
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
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);

    if (!generateCompanyDescriptionWithGemini_.logged) {
      Logger.log('Gemini API response structure:');
      Logger.log(JSON.stringify(json, null, 2));
      generateCompanyDescriptionWithGemini_.logged = true;
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
          description: result.description || ''
        };
      } catch (parseError) {
        Logger.log(`Failed to parse Gemini JSON response: ${text}`);
        return { description: '' };
      }
    }

    Logger.log('Unexpected Gemini response format:');
    Logger.log(JSON.stringify(json));
    return { description: '' };

  } catch (err) {
    Logger.log(`API request failed: ${err.toString()}`);
    return { description: null }; // Signal API error (different from "no data found")
  }
}
