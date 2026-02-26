/**
 * GEMINI OWNERSHIP ENRICHMENT
 *
 * Standalone script to enrich Ownership_CB column with Gemini classifications
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

function Enrich_Ownership_With_Gemini() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const co = ss.getSheetByName('Company_Master');

  if (!co) {
    ui.alert('Error', 'Company_Master sheet not found', ui.ButtonSet.OK);
    return;
  }

  // Check for API key
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    ui.alert(
      'API Key Missing',
      'GEMINI_API_KEY not found in Script Properties.\n\n' +
      'Setup:\n' +
      '1. Click Project Settings (gear icon)\n' +
      '2. Scroll to Script Properties\n' +
      '3. Add: GEMINI_API_KEY = your-api-key',
      ui.ButtonSet.OK
    );
    return;
  }

  const lastRow = co.getLastRow();
  if (lastRow < 2) {
    ui.alert('No Data', 'No companies found in Company_Master', ui.ButtonSet.OK);
    return;
  }

  // Read all companies
  const data = co.getRange(2, 1, lastRow - 1, 37).getValues();

  // Find rows that need enrichment (where Ownership_CB is blank)
  const toEnrich = [];
  let totalCompanies = 0;
  let alreadyEnriched = 0;

  for (let i = 0; i < data.length; i++) {
    const domain = data[i][0]; // A: Domain
    const ownershipCB = String(data[i][30]).trim(); // AE: Ownership_CB (column 31, 0-indexed = 30)

    if (domain) {
      totalCompanies++;
      if (!ownershipCB) {
        toEnrich.push(i + 2); // Store actual row number (1-indexed, +1 for header)
      } else {
        alreadyEnriched++;
      }
    }
  }

  Logger.log(`Found ${totalCompanies} total companies: ${alreadyEnriched} already enriched, ${toEnrich.length} need enrichment`);

  if (toEnrich.length === 0) {
    ui.alert(
      '✅ All Set',
      `Found ${totalCompanies} companies in Company_Master.\n` +
      `All ${alreadyEnriched} already have Ownership_CB populated!`,
      ui.ButtonSet.OK
    );
    return;
  }

  // Limit to first 50 needing enrichment (safe for automated triggers)
  const MAX_PER_RUN = 50;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  const remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`Processing ${toEnrichThisRun.length} companies this run (${remaining} remaining for next run)`);

  // Confirm with user
  const response = ui.alert(
    'Enrich Ownership',
    `Found ${toEnrich.length} companies needing Ownership classification.\n\n` +
    `This run will process: ${toEnrichThisRun.length} companies\n` +
    `Remaining for next run: ${remaining}\n` +
    `Estimated time: ~3-4 minutes\n\n` +
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

  Logger.log(`Starting enrichment: ${toEnrichThisRun.length} companies in ${totalBatches} batches`);

  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const batchStart = batchNum * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, toEnrichThisRun.length);
    const batchRows = toEnrichThisRun.slice(batchStart, batchEnd);

    Logger.log(`Batch ${batchNum + 1}/${totalBatches}: Processing ${batchRows.length} companies...`);

    for (let rowNum of batchRows) {
      try {
        const rowData = co.getRange(rowNum, 1, 1, 37).getValues()[0];

        const domain = rowData[0]; // A: Domain
        const companyName = rowData[1]; // B: Company
        const industry = rowData[27]; // AB: Industry_CB
        const size = rowData[28]; // AC: Company_Size_CB
        const revenue = rowData[29]; // AD: Company_Revenue_Range_CB
        const lastFundingType = rowData[19]; // T: Last Funding Type
        const lastFundingAmount = rowData[21]; // V: Last Funding Amount

        const context = {
          company: companyName,
          industry: industry || 'Unknown',
          size: size || 'Unknown',
          revenue: revenue || 'Unknown',
          lastFundingType: lastFundingType || 'None',
          lastFundingAmount: lastFundingAmount || 'Unknown'
        };

        const ownership = classifyOwnershipWithGemini_(context, apiKey);
        Logger.log(`    Row ${rowNum} (${context.company}): "${ownership}"`);

        if (ownership) {
          co.getRange(rowNum, 31).setValue(ownership); // AE: Ownership_CB
          enrichedCount++;
        } else {
          Logger.log(`    ⚠ Empty ownership returned for ${context.company}`);
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
    `Successfully enriched ${enrichedCount} companies\n` +
    (errorCount > 0 ? `Errors: ${errorCount}\n` : '') +
    (remaining > 0 ? `\nRemaining: ${remaining} companies (run again to continue)\n` : '') +
    `\nCheck execution log for details.`,
    ui.ButtonSet.OK
  );

  Logger.log(`✅ Enrichment complete: ${enrichedCount} enriched, ${errorCount} errors, ${remaining} remaining`);
}

// Gemini API caller moved to 93a_Ownership_Gemini_Caller.gs:
// classifyOwnershipWithGemini_
