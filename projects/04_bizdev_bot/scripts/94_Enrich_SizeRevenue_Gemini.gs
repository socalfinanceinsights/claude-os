/**
 * GEMINI ENRICHMENT: Size/Revenue Normalization
 *
 * PURPOSE:
 * Normalize raw size/revenue data from imports to standardized values matching Size_Mapping and Revenue_Mapping
 *
 * PATTERN:
 * Same as Industry_Normalization - reads raw data, enriches with Gemini, writes to normalized columns
 *
 * USAGE:
 * Menu → Maintenance → Enrich Size/Revenue with Gemini (manual trigger)
 * Or call: Enrich_SizeRevenue_With_Gemini()
 */

/**
 * Main enrichment function - processes companies with blank normalized size/revenue
 * USER-FACING (called from menu)
 */
function Enrich_SizeRevenue_With_Gemini() {
  const ss = getSpreadsheet_();
  const normSheet = ss.getSheetByName(CONFIG.sheetSizeRevenueNorm);

  if (!normSheet) {
    SpreadsheetApp.getUi().alert(`❌ Error: ${CONFIG.sheetSizeRevenueNorm} tab not found`);
    return;
  }

  // Find companies with blank normalized columns (F or G)
  const lastRow = normSheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('✅ No data to enrich');
    return;
  }

  const data = normSheet.getRange(2, 1, lastRow - 1, 7).getValues(); // A-G

  const toEnrich = [];
  for (let i = 0; i < data.length; i++) {
    const domain = data[i][0];           // A: Company_Domain
    const source = data[i][1];           // B: Source
    const sizeRaw = data[i][3];          // D: CompanySize_RAW
    const revenueRaw = data[i][4];       // E: CompanyRevenue_RAW
    const sizeNorm = data[i][5];         // F: CompanySizeNorm
    const revenueNorm = data[i][6];      // G: CompanyRevenueNorm

    // Skip if both normalized columns already populated
    if (sizeNorm && revenueNorm) continue;

    // Process even if no raw data (will get "Unknown / Undisclosed")
    toEnrich.push({
      rowNum: i + 2,
      domain: domain,
      source: source,
      sizeRaw: sizeRaw || '',
      revenueRaw: revenueRaw || '',
      sizeNorm: sizeNorm || '',
      revenueNorm: revenueNorm || ''
    });
  }

  if (toEnrich.length === 0) {
    SpreadsheetApp.getUi().alert('✅ All size/revenue data already normalized!');
    return;
  }

  Logger.log(`Found ${toEnrich.length} companies needing size/revenue normalization`);

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
      const result = normalizeSizeRevenue_(item, apiKey);

      // Write normalized values to columns F & G
      if (result.sizeNorm) {
        normSheet.getRange(item.rowNum, 6).setValue(result.sizeNorm); // F: CompanySizeNorm
      }
      if (result.revenueNorm) {
        normSheet.getRange(item.rowNum, 7).setValue(result.revenueNorm); // G: CompanyRevenueNorm
      }

      enrichedCount++;
      Logger.log(`Row ${item.rowNum}: ${item.domain} → Size: ${result.sizeNorm}, Revenue: ${result.revenueNorm}`);
    }

    Utilities.sleep(2000); // Rate limit between batches
  }

  const ui = SpreadsheetApp.getUi();
  ui.alert(
    `✅ Size/Revenue Enrichment Complete!`,
    `Enriched ${enrichedCount} companies\n` +
    `Remaining: ${toEnrich.length - enrichedCount}\n\n` +
    `Run again to process more.`,
    ui.ButtonSet.OK
  );
}

// Gemini callers and response parsers moved to 94a_SizeRevenue_Gemini_Caller.gs:
// normalizeSizeRevenue_, buildNormalizationPrompt_, parseNormalizationResponse_
