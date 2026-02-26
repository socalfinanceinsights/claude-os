/**
 * 95a_Enrich_Company_Gemini.gs
 * @execution batch
 *
 * Gemini enrichment for Company Name + Domain on HM_Person_Master
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 */

/**
 * Manual enrichment function with UI dialogs
 * For menu/manual execution
 */
function Enrich_Company_With_Gemini() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const hmSheet = ss.getSheetByName(CONFIG.sheetHM);

  if (!hmSheet) {
    ui.alert('Error', 'HM_Person_Master sheet not found', ui.ButtonSet.OK);
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

  const lastRow = hmSheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('No Data', 'No people found in HM_Person_Master', ui.ButtonSet.OK);
    return;
  }

  // Run headless enrichment
  const result = enrichCompanyHeadless_(apiKey);

  // Show results
  ui.alert(
    '✅ Enrichment Complete',
    `Processed: ${result.processed} records\\n` +
    `Skipped: ${result.skipped} (already enriched or no name)\\n` +
    (result.errors > 0 ? `Errors: ${result.errors}\\n` : '') +
    (result.remaining > 0 ? `\\nRemaining: ${result.remaining} records (run again to continue)\\n` : '') +
    `\\nCheck execution log for details.`,
    ui.ButtonSet.OK
  );

  Logger.log(`✅ Company enrichment complete: ${result.processed} enriched, ${result.errors} errors, ${result.remaining} remaining`);
}

/**
 * Headless enrichment function for enrichment chain
 * Returns stats without UI dialogs
 *
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - {processed: number, remaining: number, errors: number, skipped: number}
 */
function enrichCompanyHeadless_(apiKey) {
  const ss = getSpreadsheet_();
  const hmSheet = ss.getSheetByName(CONFIG.sheetHM);

  if (!hmSheet) {
    Logger.log('ERROR: HM_Person_Master sheet not found');
    return { processed: 0, remaining: 0, errors: 1, skipped: 0 };
  }

  const lastRow = hmSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data in HM_Person_Master');
    return { processed: 0, remaining: 0, errors: 0, skipped: 0 };
  }

  // Read all person records (cols A-P: Key, LinkedIn, Name, Title, Company, Domain, Email, Phone, Source, Source_Date, ... Last_Enrichment)
  const data = hmSheet.getRange(2, 1, lastRow - 1, 16).getValues();

  // Find rows that need enrichment
  const toEnrich = [];
  let totalRecords = 0;
  let alreadyEnriched = 0;
  let skippedNoName = 0;

  for (let i = 0; i < data.length; i++) {
    const name = String(data[i][CONFIG.hmPersonCols.name] || '').trim();
    const company = String(data[i][CONFIG.hmPersonCols.company] || '').trim();
    const domain = String(data[i][CONFIG.hmPersonCols.domain] || '').trim();
    const lastUpdateDate = data[i][CONFIG.hmPersonCols.lastUpdateDate];
    const lastEnrichment = data[i][CONFIG.hmPersonCols.lastEnrichment];
    const liPersonal = String(data[i][16] || '').trim(); // Q: LI_Personal (0-indexed = 16)

    // Skip personal LinkedIn connections
    if (liPersonal === 'YES') continue;

    if (!name) {
      skippedNoName++;
      continue;
    }

    totalRecords++;

    // Eligibility logic:
    // 1. Never enriched (Last_Enrichment blank) AND (Company OR Domain is blank)
    // 2. New data arrived (Last_Update_Date > Last_Enrichment) AND (Company OR Domain is blank)
    const needsEnrichment = (!company || !domain);
    const neverEnriched = !lastEnrichment;
    const hasNewerData = lastUpdateDate && lastEnrichment && new Date(lastUpdateDate) > new Date(lastEnrichment);

    if (needsEnrichment && (neverEnriched || hasNewerData)) {
      toEnrich.push(i + 2); // Store actual row number (1-indexed, +1 for header)
    } else if (company && domain) {
      alreadyEnriched++;
    }
  }

  Logger.log(`Found ${totalRecords} total records: ${alreadyEnriched} already have company+domain, ${toEnrich.length} need enrichment, ${skippedNoName} skipped (no name)`);

  if (toEnrich.length === 0) {
    return { processed: 0, remaining: 0, errors: 0, skipped: skippedNoName };
  }

  // Limit to first 50 per run (safe for automated triggers)
  const MAX_PER_RUN = 50;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  const remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`Processing ${toEnrichThisRun.length} records this run (${remaining} remaining for next run)`);

  // Process records
  let enrichedCount = 0;
  let errorCount = 0;

  for (let idx = 0; idx < toEnrichThisRun.length; idx++) {
    const rowNum = toEnrichThisRun[idx];

    try {
      const rowData = hmSheet.getRange(rowNum, 1, 1, 16).getValues()[0];

      const name = String(rowData[CONFIG.hmPersonCols.name] || '').trim();
      const source = String(rowData[CONFIG.hmPersonCols.originalSource] || '').trim();
      const company = String(rowData[CONFIG.hmPersonCols.company] || '').trim();
      const domain = String(rowData[CONFIG.hmPersonCols.domain] || '').trim();

      const context = {
        name: name,
        source: source
      };

      const result = inferCompanyWithGemini_(context, apiKey);
      Logger.log(`  Row ${rowNum} (${context.name}): Company="${result.company}", Domain="${result.domain}"`);

      // Write to blank cells only
      if (!company && result.company) {
        hmSheet.getRange(rowNum, CONFIG.hmPersonCols.company + 1).setValue(result.company);
      }
      if (!domain && result.domain) {
        hmSheet.getRange(rowNum, CONFIG.hmPersonCols.domain + 1).setValue(result.domain);
      }

      // CRITICAL: Stamp Last_Enrichment on EVERY attempt (prevents infinite loops)
      hmSheet.getRange(rowNum, CONFIG.hmPersonCols.lastEnrichment + 1).setValue(isoNow_());

      enrichedCount++;

      // Rate limiting: 1-second pause every 20 records
      if ((idx + 1) % 20 === 0 && idx < toEnrichThisRun.length - 1) {
        Utilities.sleep(1000);
      }

    } catch (err) {
      Logger.log(`  Error enriching row ${rowNum}: ${err.toString()}`);
      errorCount++;
    }
  }

  SpreadsheetApp.flush();

  return {
    processed: enrichedCount,
    remaining: remaining,
    errors: errorCount,
    skipped: skippedNoName
  };
}

// Gemini API caller moved to 95a1_Company_Gemini_Caller.gs:
// inferCompanyWithGemini_
