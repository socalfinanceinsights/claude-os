/**
 * GEMINI INDUSTRY ENRICHMENT
 *
 * Standalone script to enrich Industry_Normalization with Gemini classifications
 *
 * USAGE:
 * - Run after importing companies (Crunchbase, Lusha, etc.)
 * - Processes max 50 companies per run (safe for automated triggers)
 * - Automatically resumes where it left off if interrupted
 * - Can be run multiple times safely (skips already-enriched rows)
 * - Ideal for automated triggers every 15-30 minutes
 *
 * SETUP:
 * - Add GEMINI_API_KEY to Script Properties (Project Settings > Script Properties)
 */

function Enrich_Industry_With_Gemini() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const industrySheet = ss.getSheetByName('Industry_Normalization');

  if (!industrySheet) {
    ui.alert('Error', 'Industry_Normalization sheet not found', ui.ButtonSet.OK);
    return;
  }

  // Check for API key
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    ui.alert(
      'API Key Missing',
      'GEMINI_API_KEY not found in Script Properties.\\n\\n' +
      'Setup:\\n' +
      '1. Click Project Settings (gear icon)\\n' +
      '2. Scroll to Script Properties\\n' +
      '3. Add: GEMINI_API_KEY = your-api-key',
      ui.ButtonSet.OK
    );
    return;
  }

  const lastRow = industrySheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('No Data', 'No companies found in Industry_Normalization', ui.ButtonSet.OK);
    return;
  }

  // Read all industry records
  const data = industrySheet.getRange(2, 1, lastRow - 1, 8).getValues();

  // Find rows that need enrichment (where NormalizedPrimaryIndustry is blank)
  const toEnrich = [];
  let totalRecords = 0;
  let alreadyEnriched = 0;

  for (let i = 0; i < data.length; i++) {
    const domain = data[i][0]; // A: Company_Domain
    const normalizedPrimary = String(data[i][5]).trim(); // F: NormalizedPrimaryIndustry

    if (domain) {
      totalRecords++;
      if (!normalizedPrimary) {
        toEnrich.push(i + 2); // Store actual row number (1-indexed, +1 for header)
      } else {
        alreadyEnriched++;
      }
    }
  }

  Logger.log(`Found ${totalRecords} total records: ${alreadyEnriched} already enriched, ${toEnrich.length} need enrichment`);

  if (toEnrich.length === 0) {
    ui.alert(
      '✅ All Set',
      `Found ${totalRecords} records in Industry_Normalization.\\n` +
      `All ${alreadyEnriched} already have normalized industries!`,
      ui.ButtonSet.OK
    );
    return;
  }

  // Limit to first 50 needing enrichment (safe for automated triggers)
  const MAX_PER_RUN = 50;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  const remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`Processing ${toEnrichThisRun.length} records this run (${remaining} remaining for next run)`);

  // Confirm with user
  const response = ui.alert(
    'Enrich Industries',
    `Found ${toEnrich.length} records needing industry normalization.\\n\\n` +
    `This run will process: ${toEnrichThisRun.length} records\\n` +
    `Remaining for next run: ${remaining}\\n` +
    `Estimated time: ~3-4 minutes\\n\\n` +
    `Continue?`,
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    Logger.log('User cancelled enrichment');
    return;
  }

  // Process in batches of 20
  const BATCH_SIZE = 20;
  const totalBatches = Math.ceil(toEnrichThisRun.length / BATCH_SIZE);
  let enrichedCount = 0;
  let errorCount = 0;

  Logger.log(`Starting enrichment: ${toEnrichThisRun.length} records in ${totalBatches} batches`);

  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const batchStart = batchNum * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, toEnrichThisRun.length);
    const batchRows = toEnrichThisRun.slice(batchStart, batchEnd);

    Logger.log(`Batch ${batchNum + 1}/${totalBatches}: Processing ${batchRows.length} records...`);

    for (let rowNum of batchRows) {
      try {
        const rowData = industrySheet.getRange(rowNum, 1, 1, 8).getValues()[0];

        const domain = rowData[0]; // A: Company_Domain
        const source = rowData[1]; // B: Source
        const primaryRaw = rowData[3]; // D: PrimaryIndustry_RAW
        const subRaw = rowData[4]; // E: SubIndustry_RAW

        const context = {
          domain: domain,
          source: source,
          primaryRaw: primaryRaw || 'Unknown',
          subRaw: subRaw || 'Unknown'
        };

        const normalized = normalizeIndustryWithGemini_(context, apiKey);
        Logger.log(`    Row ${rowNum} (${context.domain}): Primary="${normalized.primary}", Sub="${normalized.sub}"`);

        if (normalized.primary) {
          industrySheet.getRange(rowNum, 6).setValue(normalized.primary); // F: NormalizedPrimaryIndustry
          industrySheet.getRange(rowNum, 7).setValue(normalized.sub); // G: NormalizedSubIndustry
          enrichedCount++;
        } else {
          Logger.log(`    ⚠ Empty industry returned for ${context.domain}`);
        }

      } catch (err) {
        Logger.log(`  Error enriching row ${rowNum}: ${err.toString()}`);
        errorCount++;
      }
    }

    Logger.log(`  ✓ Batch ${batchNum + 1}/${totalBatches} complete`);

    // Small delay between batches
    if (batchNum < totalBatches - 1) {
      Utilities.sleep(1000);
    }
  }

  SpreadsheetApp.flush();

  ui.alert(
    '✅ Enrichment Complete',
    `Successfully enriched ${enrichedCount} records\\n` +
    (errorCount > 0 ? `Errors: ${errorCount}\\n` : '') +
    (remaining > 0 ? `\\nRemaining: ${remaining} records (run again to continue)\\n` : '') +
    `\\nCheck execution log for details.`,
    ui.ButtonSet.OK
  );

  Logger.log(`✅ Enrichment complete: ${enrichedCount} enriched, ${errorCount} errors, ${remaining} remaining`);
}

// Gemini API caller moved to 92a_Industry_Gemini_Caller.gs:
// normalizeIndustryWithGemini_
