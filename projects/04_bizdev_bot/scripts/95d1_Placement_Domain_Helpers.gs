/**
 * 95d1_Placement_Domain_Helpers.gs
 * BD TRACKER - Placement Domain Lookup Support Functions
 * @execution batch
 * Version: 1.0.0
 *
 * CONTAINS:
 * - matchHMKeys_: Match HM names from Notes field to HM_Person_Master composite keys
 * - lookupDomains_: Resolve company names to website domains
 * - resolveDomainsWithGemini_: Batch Gemini API call for domain resolution
 *
 * SPLIT FROM: 95d_Enrich_Placement_Domains.gs (lines 97-374)
 * CALLED BY: 95d_Enrich_Placement_Domains.gs (Enrich_Placement_Domains, enrichPlacementDomainsHeadless_)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, GEMINI_API_URL)
 */

// ============================================================================
// STEP 1: HM COMPOSITE KEY MATCHING
// ============================================================================

/**
 * Match HM names from Notes field to HM_Person_Master composite keys
 *
 * @param {Spreadsheet} ss
 * @param {Array<Array>} data - Placements_Log data (rows starting at row 2)
 * @param {Sheet} plSheet - Placements_Log sheet
 * @returns {Object} - {matched, unmatched, skipped}
 */
function matchHMKeys_(ss, data, plSheet) {
  const hmSheet = ss.getSheetByName(CONFIG.sheetHM);
  if (!hmSheet) {
    Logger.log('HM_Person_Master not found');
    return { matched: 0, unmatched: 0, skipped: 0 };
  }

  // Build name -> composite key map (case-insensitive)
  const hmLastRow = hmSheet.getLastRow();
  if (hmLastRow < 2) return { matched: 0, unmatched: 0, skipped: 0 };

  const hmData = hmSheet.getRange(2, 1, hmLastRow - 1, 3).getValues(); // A:C (Key, LinkedIn, Name)
  const nameMap = {};

  for (const row of hmData) {
    const key = String(row[0]).trim();
    const name = String(row[2]).trim();
    if (name && key) {
      nameMap[name.toLowerCase()] = key;
    }
  }

  Logger.log(`HM_Person_Master: ${Object.keys(nameMap).length} names loaded for matching`);

  let matched = 0;
  let unmatched = 0;
  let skipped = 0;
  const unmatchedNames = new Set();

  for (let i = 0; i < data.length; i++) {
    const existingKey = String(data[i][3]).trim(); // Col D: HM_Composite_Key
    if (existingKey) {
      skipped++;
      continue;
    }

    const hmName = String(data[i][8]).trim(); // Col I: HM_Name
    if (!hmName) continue;

    const hmNameLower = hmName.toLowerCase();

    // Try exact match first
    if (nameMap[hmNameLower]) {
      plSheet.getRange(i + 2, 4).setValue(nameMap[hmNameLower]); // Col D
      matched++;
      Logger.log(`  [${i+1}] HM "${hmName}" -> ${nameMap[hmNameLower]}`);
    } else {
      // Try matching without credentials suffix (CPA, MBA, etc.)
      const cleanName = hmNameLower.replace(/,?\s*(cpa|mba|cfa|phd|jr|sr|iii|ii)\.?$/i, '').trim();
      if (nameMap[cleanName]) {
        plSheet.getRange(i + 2, 4).setValue(nameMap[cleanName]);
        matched++;
        Logger.log(`  [${i+1}] HM "${hmName}" -> ${nameMap[cleanName]} (credential-stripped match)`);
      } else {
        unmatched++;
        unmatchedNames.add(hmName);
      }
    }
  }

  SpreadsheetApp.flush();

  Logger.log(`HM Key Matching: ${matched} matched, ${skipped} already set, ${unmatched} unmatched`);
  if (unmatchedNames.size > 0) {
    Logger.log(`Unmatched HMs (${unmatchedNames.size} unique): ${Array.from(unmatchedNames).join(', ')}`);
  }

  return { matched, unmatched, skipped };
}

// ============================================================================
// STEP 2: COMPANY DOMAIN LOOKUP (GEMINI)
// ============================================================================

/**
 * Resolve company names to website domains using Gemini
 *
 * @param {Spreadsheet} ss
 * @param {Array<Array>} data - Placements_Log data
 * @param {Sheet} plSheet - Placements_Log sheet
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - {resolved, skipped, errors}
 */
function lookupDomains_(ss, data, plSheet, apiKey) {
  // First check Company_Master for existing domains
  const coSheet = ss.getSheetByName(CONFIG.sheetCompany);
  const existingDomains = {};

  if (coSheet) {
    const coLastRow = coSheet.getLastRow();
    if (coLastRow >= 2) {
      const coData = coSheet.getRange(2, 1, coLastRow - 1, 2).getValues(); // A:B (Domain, Company)
      for (const row of coData) {
        const domain = String(row[0]).trim();
        const name = String(row[1]).trim();
        if (name && domain) {
          existingDomains[name.toLowerCase()] = domain;
        }
      }
    }
  }

  Logger.log(`Company_Master: ${Object.keys(existingDomains).length} companies loaded for domain lookup`);

  // Collect unique companies that need domain resolution
  const companiesNeedingDomains = new Set();
  const rowsByCompany = {}; // company -> [row indices]

  let skipped = 0;

  for (let i = 0; i < data.length; i++) {
    const existingDomain = String(data[i][5]).trim(); // Col F: Client_Domain
    if (existingDomain) {
      skipped++;
      continue;
    }

    const company = String(data[i][4]).trim(); // Col E: Client_Company
    if (!company) continue;

    // Check Company_Master first
    if (existingDomains[company.toLowerCase()]) {
      const domain = existingDomains[company.toLowerCase()];
      plSheet.getRange(i + 2, 6).setValue(domain); // Col F
      Logger.log(`  [${i+1}] "${company}" -> ${domain} (Company_Master match)`);
      skipped++; // Count as resolved from existing data
      continue;
    }

    companiesNeedingDomains.add(company);
    if (!rowsByCompany[company]) rowsByCompany[company] = [];
    rowsByCompany[company].push(i);
  }

  Logger.log(`${companiesNeedingDomains.size} unique companies need Gemini domain lookup`);

  if (companiesNeedingDomains.size === 0) {
    SpreadsheetApp.flush();
    return { resolved: 0, skipped, errors: 0 };
  }

  // Batch Gemini calls - send up to 10 companies per API call
  const companies = Array.from(companiesNeedingDomains);
  const MAX_COMPANIES = 30; // Safety limit per run
  const toProcess = companies.slice(0, MAX_COMPANIES);
  const BATCH_SIZE = 10;

  let resolved = 0;
  let errors = 0;

  for (let batchStart = 0; batchStart < toProcess.length; batchStart += BATCH_SIZE) {
    const batch = toProcess.slice(batchStart, batchStart + BATCH_SIZE);

    try {
      const domainMap = resolveDomainsWithGemini_(batch, apiKey);

      for (const company of batch) {
        const domain = domainMap[company] || '';
        if (domain && domain !== 'UNKNOWN') {
          const rows = rowsByCompany[company] || [];
          for (const rowIdx of rows) {
            plSheet.getRange(rowIdx + 2, 6).setValue(domain); // Col F
          }
          resolved += rows.length;
          Logger.log(`  "${company}" -> ${domain} (${rows.length} rows updated)`);
        } else {
          Logger.log(`  "${company}" -> UNKNOWN (Gemini couldn't resolve)`);
          errors++;
        }
      }
    } catch (err) {
      Logger.log(`Gemini batch error: ${err.toString()}`);
      errors += batch.length;
    }

    // Delay between batches
    if (batchStart + BATCH_SIZE < toProcess.length) {
      Utilities.sleep(1500);
    }
  }

  SpreadsheetApp.flush();

  const remaining = companies.length - toProcess.length;
  if (remaining > 0) {
    Logger.log(`${remaining} companies still need domain resolution (run again)`);
  }

  return { resolved, skipped, errors };
}

/**
 * Call Gemini to resolve multiple company names to website domains
 *
 * @param {Array<string>} companies - List of company names
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - Map of company name -> domain
 */
function resolveDomainsWithGemini_(companies, apiKey) {
  const companiesList = companies.map((c, i) => `${i + 1}. "${c}"`).join('\n');

  const prompt = `For each company below, provide their primary website domain (just the root domain, e.g., "monsterenergy.com" not "www.monsterenergy.com").

These are real companies, mostly based in Southern California / Orange County area. Many are mid-market or enterprise companies in industries like tech, healthcare, defense, consumer goods, finance, and real estate.

Companies:
${companiesList}

INSTRUCTIONS:
- Return ONLY a JSON object mapping each company name (exactly as given) to its domain
- If you're unsure about a company, use "UNKNOWN" as the value
- Do NOT include "www." prefix — just the root domain
- Use the exact company name string as the key (preserve original casing)

Example format:
{
  "Monster Energy Corporation": "monsterenergy.com",
  "Western Digital": "westerndigital.com"
}

Return ONLY the JSON object, no explanation.`;

  const url = `${GEMINI_API_URL}?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
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

  if (json.usageMetadata) {
    Logger.log(`  Gemini tokens: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}, Thoughts=${json.usageMetadata.thoughtsTokenCount || 0}`);
  }

  if (json.candidates && json.candidates[0] && json.candidates[0].content) {
    const text = json.candidates[0].content.parts[0].text.trim();

    try {
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleanText);
    } catch (parseError) {
      Logger.log(`Failed to parse Gemini domain response: ${text}`);
      return {};
    }
  }

  Logger.log('Unexpected Gemini response format for domain lookup');
  return {};
}
