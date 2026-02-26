/**
 * 95c_Enrich_CompanyDescription_Gemini.gs
 * @execution batch
 *
 * Gemini enrichment for Description on Company_Master
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 *
 * USAGE:
 * - Run via menu (manual execution with UI dialogs)
 * - Or call headless function from enrichment chain
 * - Generates 2-3 sentence company descriptions using Gemini Flash
 * - Processes max 20 companies per run (descriptions use more tokens)
 * - Uses Last_Enrichment pattern to prevent infinite loops
 *
 * SETUP:
 * - GEMINI_API_KEY must be set in Script Properties
 */

/**
 * Manual execution from menu with UI dialogs
 * Prompts user for confirmation before processing
 */
function Enrich_CompanyDescription_With_Gemini() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const companySheet = ss.getSheetByName(CONFIG.sheetCompany);

  if (!companySheet) {
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

  const lastRow = companySheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('No Data', 'No companies found in Company_Master', ui.ButtonSet.OK);
    return;
  }

  // Read company data (need at least 29 columns to include Last_Enrichment at AC/idx 28)
  const data = companySheet.getRange(2, 1, lastRow - 1, 29).getValues();

  // Find rows that need enrichment
  const toEnrich = [];
  let totalRecords = 0;
  let alreadyEnriched = 0;

  for (let i = 0; i < data.length; i++) {
    const domain = String(data[i][0]).trim(); // A: Domain
    const description = String(data[i][2]).trim(); // C: Description
    const lastUpdated = data[i][27]; // AB: Last_Updated (idx 27)
    const lastEnrichment = data[i][28]; // AC: Last_Enrichment (idx 28)

    if (domain) {
      totalRecords++;

      // Eligible if: (no enrichment timestamp) OR (Last_Updated > Last_Enrichment)
      const needsEnrichment = !description && (!lastEnrichment || (lastUpdated && lastUpdated > lastEnrichment));

      if (needsEnrichment) {
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
      `Found ${totalRecords} records in Company_Master.\n` +
      `All ${alreadyEnriched} already have descriptions or have been attempted!`,
      ui.ButtonSet.OK
    );
    return;
  }

  // Limit to first 20 needing enrichment (descriptions use more tokens)
  const MAX_PER_RUN = 20;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  const remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`Processing ${toEnrichThisRun.length} records this run (${remaining} remaining for next run)`);

  // Confirm with user
  const response = ui.alert(
    'Enrich Company Descriptions',
    `Found ${toEnrich.length} records needing description enrichment.\n\n` +
    `This run will process: ${toEnrichThisRun.length} records\n` +
    `Remaining for next run: ${remaining}\n` +
    `Estimated time: ~2-3 minutes\n\n` +
    `Continue?`,
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    Logger.log('User cancelled enrichment');
    return;
  }

  // Process in single batch (20 records)
  let enrichedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  Logger.log(`Starting enrichment: ${toEnrichThisRun.length} records`);

  for (let rowNum of toEnrichThisRun) {
    try {
      const rowData = companySheet.getRange(rowNum, 1, 1, 29).getValues()[0];

      const domain = String(rowData[0]).trim(); // A: Domain
      const companyName = String(rowData[1]).trim(); // B: Company Name

      if (!domain && !companyName) {
        Logger.log(`  Row ${rowNum}: Skipping (no domain or company name)`);
        skippedCount++;
        continue;
      }

      const context = {
        domain: domain || 'Unknown',
        companyName: companyName || 'Unknown'
      };

      const result = generateCompanyDescriptionWithGemini_(context, apiKey);
      Logger.log(`  Row ${rowNum} (${context.companyName}): Description="${result.description.substring(0, 60)}..."`);

      // Write description if returned (even if empty — prevents retry loop)
      if (result.description !== null) {
        companySheet.getRange(rowNum, 3).setValue(result.description); // C: Description
        enrichedCount++;
      } else {
        Logger.log(`  ⚠ API error for ${context.companyName}`);
        errorCount++;
      }

      // CRITICAL: Stamp Last_Enrichment on EVERY attempt (success or empty)
      companySheet.getRange(rowNum, 29).setValue(isoNow_()); // AC: Last_Enrichment (col 29, 1-based)

    } catch (err) {
      Logger.log(`  Error enriching row ${rowNum}: ${err.toString()}`);
      errorCount++;

      // CRITICAL: Stamp Last_Enrichment even on error (prevents infinite retry)
      try {
        companySheet.getRange(rowNum, 29).setValue(isoNow_());
      } catch (stampErr) {
        Logger.log(`  Failed to stamp Last_Enrichment: ${stampErr.toString()}`);
      }
    }

    // Small delay between requests
    if ((toEnrichThisRun.indexOf(rowNum) + 1) % 20 === 0) {
      Utilities.sleep(1000);
    }
  }

  SpreadsheetApp.flush();

  ui.alert(
    '✅ Enrichment Complete',
    `Successfully enriched ${enrichedCount} records\n` +
    (skippedCount > 0 ? `Skipped: ${skippedCount}\n` : '') +
    (errorCount > 0 ? `Errors: ${errorCount}\n` : '') +
    (remaining > 0 ? `\nRemaining: ${remaining} records (run again to continue)\n` : '') +
    `\nCheck execution log for details.`,
    ui.ButtonSet.OK
  );

  Logger.log(`✅ Enrichment complete: ${enrichedCount} enriched, ${skippedCount} skipped, ${errorCount} errors, ${remaining} remaining`);
}

// Headless enrichment and Gemini caller moved to 95c1_CompanyDesc_Gemini_Caller.gs:
// enrichCompanyDescriptionHeadless_, generateCompanyDescriptionWithGemini_
