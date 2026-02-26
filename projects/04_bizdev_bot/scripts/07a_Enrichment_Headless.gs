/**
 * 07a_Enrichment_Headless.gs
 * @execution scheduled, pipeline
 *
 * Purpose: Headless enrichment functions for the Gemini enrichment chain
 * Called by Chain_Gemini_Enrichments() in 07_Enrichment_Chain.gs
 * No UI dialogs — safe for time-based triggers
 *
 * CONTAINS:
 * - enrichIndustryHeadless_()     — Industry_Normalization (up to 50 per batch)
 * - enrichOwnershipHeadless_()    — Company_Master Ownership_CB (up to 50 per batch)
 * - enrichSizeRevenueHeadless_()  — Size/Revenue normalization (up to 20 per batch)
 * - enrichRegionHeadless_()       — Region Tier 3 assessment (up to 20 per batch)
 * - logStepResult_()              — Per-step timing log
 * - logChainSummary_()            — Full chain summary + Run_Logs persistence
 * - getElapsedMinutes_()          — Elapsed time helper
 *
 * DEPENDENCIES:
 * - 00_Brain_Config.gs (CONFIG, GEMINI_API_URL)
 * - 92_Enrich_Industry_Gemini.gs (normalizeIndustryWithGemini_)
 * - 93_Enrich_Ownership_Gemini.gs (classifyOwnershipWithGemini_)
 * - 94_Enrich_SizeRevenue_Gemini.gs (normalizeSizeRevenue_)
 * - 95_Enrich_Region_Tier3_Gemini.gs (assessCAOperations_)
 *
 * SEE ALSO: 07_Enrichment_Chain.gs (orchestrator, ICP refresh, trigger schedulers)
 *
 * Version: 1.0.0 (Split from 07_Enrichment_Chain.gs v2.1.0)
 * Last Updated: 2026-02-17
 */

// ============================================================================
// HEADLESS ENRICHMENT FUNCTIONS
// ============================================================================

/**
 * Headless Industry enrichment — processes Industry_Normalization tab
 * No UI dialogs. Returns result object for chain to consume.
 *
 * @param {string} apiKey - Gemini API key
 * @returns {{processed: number, remaining: number, errors: number, skipped: boolean}}
 */
function enrichIndustryHeadless_(apiKey) {
  const result = { processed: 0, remaining: 0, errors: 0, skipped: false };
  const ss = getSpreadsheet_();
  const industrySheet = ss.getSheetByName('Industry_Normalization');

  if (!industrySheet) {
    Logger.log('  Industry: Industry_Normalization sheet not found');
    result.errors = -1;
    return result;
  }

  const lastRow = industrySheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('  Industry: No data to enrich');
    return result;
  }

  // Read all rows in one batch
  const data = industrySheet.getRange(2, 1, lastRow - 1, 8).getValues();

  // Find rows needing enrichment (NormalizedPrimaryIndustry blank)
  const toEnrich = [];
  for (let i = 0; i < data.length; i++) {
    const domain = data[i][0]; // A: Company_Domain
    const normalizedPrimary = String(data[i][5]).trim(); // F: NormalizedPrimaryIndustry
    if (domain && !normalizedPrimary) {
      toEnrich.push(i + 2);
    }
  }

  if (toEnrich.length === 0) {
    Logger.log('  Industry: All rows already enriched');
    return result;
  }

  const MAX_PER_RUN = 50;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  result.remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`  Industry: Processing ${toEnrichThisRun.length} rows (${result.remaining} remaining)`);

  for (const rowNum of toEnrichThisRun) {
    try {
      const rowData = industrySheet.getRange(rowNum, 1, 1, 8).getValues()[0];
      const context = {
        domain:     rowData[0], // A: Company_Domain
        source:     rowData[1], // B: Source
        primaryRaw: rowData[3] || 'Unknown', // D: PrimaryIndustry_RAW
        subRaw:     rowData[4] || 'Unknown'  // E: SubIndustry_RAW
      };

      const normalized = normalizeIndustryWithGemini_(context, apiKey);

      if (normalized.primary) {
        industrySheet.getRange(rowNum, 6).setValue(normalized.primary); // F: NormalizedPrimaryIndustry
        industrySheet.getRange(rowNum, 7).setValue(normalized.sub);     // G: NormalizedSubIndustry
        result.processed++;
      } else {
        Logger.log(`    ⚠ Empty industry for ${context.domain}`);
        result.errors++;
      }
    } catch (e) {
      Logger.log(`    Error row ${rowNum}: ${e.message}`);
      result.errors++;
    }
  }

  SpreadsheetApp.flush();
  return result;
}

/**
 * Headless Ownership enrichment — processes Company_Master Ownership_CB column
 * No UI dialogs. Returns result object for chain to consume.
 *
 * @param {string} apiKey - Gemini API key
 * @returns {{processed: number, remaining: number, errors: number, skipped: boolean}}
 */
function enrichOwnershipHeadless_(apiKey) {
  const result = { processed: 0, remaining: 0, errors: 0, skipped: false };
  const ss = getSpreadsheet_();
  const coSheet = ss.getSheetByName('Company_Master');

  if (!coSheet) {
    Logger.log('  Ownership: Company_Master sheet not found');
    result.errors = -1;
    return result;
  }

  const lastRow = coSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('  Ownership: No data to enrich');
    return result;
  }

  // Read all companies in one batch
  const data = coSheet.getRange(2, 1, lastRow - 1, 37).getValues();

  const toEnrich = [];
  for (let i = 0; i < data.length; i++) {
    const domain = data[i][0];                           // A: Domain
    const ownershipCB = String(data[i][30]).trim();      // AE: Ownership_CB (col 31, 0-idx 30)
    if (domain && !ownershipCB) {
      toEnrich.push(i + 2);
    }
  }

  if (toEnrich.length === 0) {
    Logger.log('  Ownership: All rows already enriched');
    return result;
  }

  const MAX_PER_RUN = 50;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  result.remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`  Ownership: Processing ${toEnrichThisRun.length} rows (${result.remaining} remaining)`);

  for (const rowNum of toEnrichThisRun) {
    try {
      const rowData = coSheet.getRange(rowNum, 1, 1, 37).getValues()[0];
      const context = {
        company:          rowData[1],  // B: Company
        industry:         rowData[27] || 'Unknown', // AB: Industry_CB
        size:             rowData[28] || 'Unknown', // AC: Company_Size_CB
        revenue:          rowData[29] || 'Unknown', // AD: Company_Revenue_Range_CB
        lastFundingType:  rowData[19] || 'None',    // T: Last Funding Type
        lastFundingAmount: rowData[21] || 'Unknown' // V: Last Funding Amount
      };

      const ownership = classifyOwnershipWithGemini_(context, apiKey);

      if (ownership) {
        coSheet.getRange(rowNum, 31).setValue(ownership); // AE: Ownership_CB
        result.processed++;
      } else {
        Logger.log(`    ⚠ Empty ownership for ${context.company}`);
        result.errors++;
      }
    } catch (e) {
      Logger.log(`    Error row ${rowNum}: ${e.message}`);
      result.errors++;
    }
  }

  SpreadsheetApp.flush();
  return result;
}

/**
 * Headless Size/Revenue enrichment — processes CONFIG.sheetSizeRevenueNorm
 * No UI dialogs. Returns result object for chain to consume.
 *
 * @param {string} apiKey - Gemini API key
 * @returns {{processed: number, remaining: number, errors: number, skipped: boolean}}
 */
function enrichSizeRevenueHeadless_(apiKey) {
  const result = { processed: 0, remaining: 0, errors: 0, skipped: false };
  const ss = getSpreadsheet_();
  const normSheet = ss.getSheetByName(CONFIG.sheetSizeRevenueNorm);

  if (!normSheet) {
    Logger.log(`  SizeRevenue: ${CONFIG.sheetSizeRevenueNorm} sheet not found`);
    result.errors = -1;
    return result;
  }

  const lastRow = normSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('  SizeRevenue: No data to enrich');
    return result;
  }

  const data = normSheet.getRange(2, 1, lastRow - 1, 7).getValues(); // A-G

  const toEnrich = [];
  for (let i = 0; i < data.length; i++) {
    const domain     = data[i][0]; // A: Company_Domain
    const sizeNorm   = data[i][5]; // F: CompanySizeNorm
    const revenueNorm = data[i][6]; // G: CompanyRevenueNorm
    if (domain && !(sizeNorm && revenueNorm)) {
      toEnrich.push({
        rowNum:     i + 2,
        domain:     domain,
        source:     data[i][1] || '',
        sizeRaw:    data[i][3] || '',
        revenueRaw: data[i][4] || '',
        sizeNorm:   sizeNorm   || '',
        revenueNorm: revenueNorm || ''
      });
    }
  }

  if (toEnrich.length === 0) {
    Logger.log('  SizeRevenue: All rows already enriched');
    return result;
  }

  const MAX_PER_RUN = 20;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  result.remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`  SizeRevenue: Processing ${toEnrichThisRun.length} rows (${result.remaining} remaining)`);

  for (const item of toEnrichThisRun) {
    try {
      const normalized = normalizeSizeRevenue_(item, apiKey);

      if (normalized.sizeNorm) {
        normSheet.getRange(item.rowNum, 6).setValue(normalized.sizeNorm);    // F
      }
      if (normalized.revenueNorm) {
        normSheet.getRange(item.rowNum, 7).setValue(normalized.revenueNorm); // G
      }

      result.processed++;
      Logger.log(`    Row ${item.rowNum}: ${item.domain} → Size: ${normalized.sizeNorm}, Revenue: ${normalized.revenueNorm}`);
    } catch (e) {
      Logger.log(`    Error row ${item.rowNum}: ${e.message}`);
      result.errors++;
    }
  }

  SpreadsheetApp.flush();
  return result;
}

/**
 * Headless Region Tier 3 enrichment — processes Company_Master Region column (J)
 * No UI dialogs. Returns result object for chain to consume.
 *
 * @param {string} apiKey - Gemini API key
 * @returns {{processed: number, remaining: number, errors: number, skipped: boolean}}
 */
function enrichRegionHeadless_(apiKey) {
  const result = { processed: 0, remaining: 0, errors: 0, skipped: false };
  const ss = getSpreadsheet_();
  const coSheet = ss.getSheetByName('Company_Master');

  if (!coSheet) {
    Logger.log('  Region: Company_Master sheet not found');
    result.errors = -1;
    return result;
  }

  const lastRow = coSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('  Region: No data to enrich');
    return result;
  }

  const data = coSheet.getRange(2, 1, lastRow - 1, 11).getValues(); // A-K

  const toEnrich = [];
  for (let i = 0; i < data.length; i++) {
    const domain  = data[i][0]; // A: Domain
    const region  = data[i][9]; // J: Region
    if (domain && !region) {
      toEnrich.push({
        rowNum:  i + 2,
        domain:  domain,
        company: data[i][1] || domain,
        city:    data[i][8] || 'Unknown', // I: HQ City
        state:   data[i][10] || 'Unknown' // K: HQ State
      });
    }
  }

  if (toEnrich.length === 0) {
    Logger.log('  Region: All rows already enriched');
    return result;
  }

  const MAX_PER_RUN = 20;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  result.remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`  Region: Processing ${toEnrichThisRun.length} rows (${result.remaining} remaining)`);

  for (const item of toEnrichThisRun) {
    try {
      const assessment = assessCAOperations_(item, apiKey);
      const regionValue = (assessment === 'California Operations') ? 'Major CA Ops' : 'Remote/International';

      coSheet.getRange(item.rowNum, 10).setValue(regionValue); // J: Region
      result.processed++;
      Logger.log(`    Row ${item.rowNum}: ${item.company} → ${regionValue}`);
    } catch (e) {
      Logger.log(`    Error row ${item.rowNum}: ${e.message}`);
      result.errors++;
    }
  }

  SpreadsheetApp.flush();
  return result;
}

// ============================================================================
// LOGGING HELPERS
// ============================================================================

/**
 * Log a single enrichment step result with elapsed time
 *
 * @param {string} stepName - Human-readable step name
 * @param {{processed: number, remaining: number, errors: number, skipped: boolean}} result
 * @param {Date} chainStartTime - When the chain started (for elapsed calc)
 */
function logStepResult_(stepName, result, chainStartTime) {
  const elapsed = getElapsedMinutes_(chainStartTime).toFixed(1);
  const status = result.skipped ? 'SKIPPED' :
                 result.errors === -1 ? 'FATAL' :
                 result.errors > 0 ? `${result.errors} errors` : 'OK';

  Logger.log(
    `  ${stepName}: processed=${result.processed}, remaining=${result.remaining}, ` +
    `status=${status}, elapsed=${elapsed}min`
  );
}

/**
 * Log full chain summary and persist to Run_Logs
 *
 * @param {{industry, ownership, sizeRevenue, region, company, title, description}} results
 * @param {Date} startTime - Chain start time
 */
function logChainSummary_(results, startTime) {
  const elapsed = getElapsedMinutes_(startTime).toFixed(1);
  const totalProcessed = results.industry.processed + results.ownership.processed +
                         results.sizeRevenue.processed + results.region.processed +
                         results.company.processed + results.title.processed +
                         results.description.processed;
  const totalRemaining = results.industry.remaining + results.ownership.remaining +
                         results.sizeRevenue.remaining + results.region.remaining +
                         results.company.remaining + results.title.remaining +
                         results.description.remaining;
  const totalErrors = [
    results.industry.errors, results.ownership.errors, results.sizeRevenue.errors,
    results.region.errors, results.company.errors, results.title.errors, results.description.errors
  ].filter(e => e > 0).reduce((a, b) => a + b, 0);

  Logger.log('--- CHAIN SUMMARY ---');
  Logger.log(`  Total elapsed: ${elapsed} min`);
  Logger.log(`  Industry:    processed=${results.industry.processed}, remaining=${results.industry.remaining}`);
  Logger.log(`  Ownership:   processed=${results.ownership.processed}, remaining=${results.ownership.remaining}`);
  Logger.log(`  SizeRevenue: processed=${results.sizeRevenue.processed}, remaining=${results.sizeRevenue.remaining}`);
  Logger.log(`  Region:      processed=${results.region.processed}, remaining=${results.region.remaining}`);
  Logger.log(`  Company:     processed=${results.company.processed}, remaining=${results.company.remaining}`);
  Logger.log(`  Title:       processed=${results.title.processed}, remaining=${results.title.remaining}`);
  Logger.log(`  Description: processed=${results.description.processed}, remaining=${results.description.remaining}`);
  Logger.log(`  TOTAL: processed=${totalProcessed}, remaining=${totalRemaining}, errors=${totalErrors}`);
  Logger.log('---------------------');

  // Persist to Run_Logs
  try {
    persistRunLog_('Enrichment_Chain', {
      action: 'Chain_Gemini_Enrichments',
      totalProcessed: totalProcessed,
      totalRemaining: totalRemaining,
      totalErrors: totalErrors,
      elapsedMinutes: parseFloat(elapsed),
      steps: {
        industry:    { processed: results.industry.processed, remaining: results.industry.remaining },
        ownership:   { processed: results.ownership.processed, remaining: results.ownership.remaining },
        sizeRevenue: { processed: results.sizeRevenue.processed, remaining: results.sizeRevenue.remaining },
        region:      { processed: results.region.processed, remaining: results.region.remaining },
        company:     { processed: results.company.processed, remaining: results.company.remaining },
        title:       { processed: results.title.processed, remaining: results.title.remaining },
        description: { processed: results.description.processed, remaining: results.description.remaining }
      },
      timestamp: isoNow_()
    });
  } catch (e) {
    Logger.log(`  Run log persistence failed: ${e.message}`);
  }
}

/**
 * Returns elapsed time in minutes since startTime
 *
 * @param {Date} startTime - Reference start time
 * @returns {number} - Elapsed minutes (float)
 */
function getElapsedMinutes_(startTime) {
  return (new Date() - startTime) / 60000;
}
