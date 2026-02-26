/**
 * 95b_Enrich_Title_Gemini.gs
 * @execution batch
 *
 * Gemini enrichment for Title on HM_Person_Master
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 */

/**
 * Manual enrichment function (callable from menu or script editor)
 * Includes UI dialogs for confirmation and results reporting
 */
function Enrich_Title_With_Gemini() {
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
    ui.alert('No Data', 'No records found in HM_Person_Master', ui.ButtonSet.OK);
    return;
  }

  // Read all HM_Person_Master records
  const data = hmSheet.getRange(2, 1, lastRow - 1, 16).getValues();

  // Find rows that need enrichment
  const toEnrich = [];
  let totalRecords = 0;
  let alreadyHaveTitle = 0;
  let notEligible = 0;

  for (let i = 0; i < data.length; i++) {
    const key = data[i][CONFIG.hmPersonCols.key]; // A: Composite_Key
    const title = String(data[i][CONFIG.hmPersonCols.title] || '').trim(); // D: Title
    const lastEnrichment = data[i][CONFIG.hmPersonCols.lastEnrichment]; // P: Last_Enrichment
    const lastUpdateDate = data[i][CONFIG.hmPersonCols.lastUpdateDate]; // N: Last_Update_Date

    if (!key) continue;

    totalRecords++;

    if (title) {
      alreadyHaveTitle++;
      continue;
    }

    // Check if eligible for enrichment using Last_Enrichment pattern
    const isEligible = !lastEnrichment || (lastUpdateDate && new Date(lastUpdateDate) > new Date(lastEnrichment));

    if (!isEligible) {
      notEligible++;
      continue;
    }

    toEnrich.push(i + 2); // Store actual row number (1-indexed, +1 for header)
  }

  Logger.log(`Found ${totalRecords} total records: ${alreadyHaveTitle} have titles, ${toEnrich.length} need enrichment, ${notEligible} not eligible (already attempted)`);

  if (toEnrich.length === 0) {
    ui.alert(
      '✅ All Set',
      `Found ${totalRecords} records in HM_Person_Master.\\n` +
      `${alreadyHaveTitle} already have titles.\\n` +
      `${notEligible} were already attempted (check Last_Enrichment).\\n\\n` +
      `No enrichment needed!`,
      ui.ButtonSet.OK
    );
    return;
  }

  // Limit to first 50 per run (safe batch size)
  const MAX_PER_RUN = 50;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  const remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`Processing ${toEnrichThisRun.length} records this run (${remaining} remaining for next run)`);

  // Confirm with user
  const response = ui.alert(
    'Enrich Titles',
    `Found ${toEnrich.length} records needing title enrichment.\\n\\n` +
    `This run will process: ${toEnrichThisRun.length} records\\n` +
    `Remaining for next run: ${remaining}\\n` +
    `Estimated time: ~2-3 minutes\\n\\n` +
    `Continue?`,
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    Logger.log('User cancelled enrichment');
    return;
  }

  // Call headless function
  const result = enrichTitleHeadless_(apiKey, toEnrichThisRun, hmSheet);

  SpreadsheetApp.flush();

  ui.alert(
    '✅ Enrichment Complete',
    `Successfully enriched ${result.processed} records\\n` +
    (result.skipped > 0 ? `Skipped (missing data): ${result.skipped}\\n` : '') +
    (result.errors > 0 ? `Errors: ${result.errors}\\n` : '') +
    (remaining > 0 ? `\\nRemaining: ${remaining} records (run again to continue)\\n` : '') +
    `\\nCheck execution log for details.`,
    ui.ButtonSet.OK
  );

  Logger.log(`✅ Enrichment complete: ${result.processed} enriched, ${result.errors} errors, ${result.skipped} skipped, ${remaining} remaining`);
}

/**
 * Headless enrichment function (callable from enrichment chain)
 *
 * @param {string} apiKey - Gemini API key
 * @param {Array<number>} rowNumbers - Optional array of specific row numbers to process (1-indexed)
 * @param {Sheet} sheet - Optional pre-fetched sheet reference (optimization)
 * @returns {Object} - {processed, remaining, errors, skipped}
 */
function enrichTitleHeadless_(apiKey, rowNumbers, sheet) {
  const ss = getSpreadsheet_();
  const hmSheet = sheet || ss.getSheetByName(CONFIG.sheetHM);

  if (!hmSheet) {
    Logger.log('Error: HM_Person_Master sheet not found');
    return { processed: 0, remaining: 0, errors: 1, skipped: 0 };
  }

  const lastRow = hmSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data in HM_Person_Master');
    return { processed: 0, remaining: 0, errors: 0, skipped: 0 };
  }

  // If no specific rows provided, find all eligible rows
  let toEnrich = rowNumbers;
  if (!toEnrich) {
    const data = hmSheet.getRange(2, 1, lastRow - 1, 16).getValues();
    toEnrich = [];

    for (let i = 0; i < data.length; i++) {
      const key = data[i][CONFIG.hmPersonCols.key];
      const title = String(data[i][CONFIG.hmPersonCols.title] || '').trim();
      const lastEnrichment = data[i][CONFIG.hmPersonCols.lastEnrichment];
      const lastUpdateDate = data[i][CONFIG.hmPersonCols.lastUpdateDate];
      const liPersonal = String(data[i][16] || '').trim(); // Q: LI_Personal (0-indexed = 16)

      // Skip personal LinkedIn connections
      if (liPersonal === 'YES') continue;

      if (!key || title) continue;

      const isEligible = !lastEnrichment || (lastUpdateDate && new Date(lastUpdateDate) > new Date(lastEnrichment));
      if (isEligible) {
        toEnrich.push(i + 2);
      }
    }
  }

  if (toEnrich.length === 0) {
    Logger.log('No rows need title enrichment');
    return { processed: 0, remaining: 0, errors: 0, skipped: 0 };
  }

  // Limit to batch size
  const MAX_PER_RUN = 50;
  const toEnrichThisRun = toEnrich.slice(0, MAX_PER_RUN);
  const remaining = toEnrich.length - toEnrichThisRun.length;

  Logger.log(`Starting title enrichment: ${toEnrichThisRun.length} records (${remaining} remaining)`);

  let enrichedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  // Process with rate limiting (pause every 20 records)
  for (let i = 0; i < toEnrichThisRun.length; i++) {
    const rowNum = toEnrichThisRun[i];

    try {
      const rowData = hmSheet.getRange(rowNum, 1, 1, 16).getValues()[0];

      const name = rowData[CONFIG.hmPersonCols.name]; // C: Name
      const company = rowData[CONFIG.hmPersonCols.company]; // E: Company
      const linkedInUrl = rowData[CONFIG.hmPersonCols.linkedin]; // B: LinkedIn URL

      // Skip if missing critical data
      if (!name) {
        Logger.log(`  Row ${rowNum}: Skipped (no name)`);
        skippedCount++;
        // Still stamp Last_Enrichment to prevent infinite loop
        hmSheet.getRange(rowNum, CONFIG.hmPersonCols.lastEnrichment + 1).setValue(isoNow_());
        continue;
      }

      const context = {
        name: name,
        company: company || 'Unknown',
        linkedInUrl: linkedInUrl || ''
      };

      const result = inferTitleWithGemini_(context, apiKey);
      Logger.log(`  Row ${rowNum} (${context.name}): Title="${result.title}"`);

      // Write result (even if empty) and stamp Last_Enrichment
      hmSheet.getRange(rowNum, CONFIG.hmPersonCols.title + 1).setValue(result.title); // D: Title
      hmSheet.getRange(rowNum, CONFIG.hmPersonCols.lastEnrichment + 1).setValue(isoNow_()); // P: Last_Enrichment

      if (result.title) {
        enrichedCount++;
      } else {
        Logger.log(`    ⚠ Empty title returned for ${context.name}`);
        skippedCount++;
      }

    } catch (err) {
      Logger.log(`  Error enriching row ${rowNum}: ${err.toString()}`);
      errorCount++;
      // Stamp Last_Enrichment even on error to prevent infinite retry
      try {
        hmSheet.getRange(rowNum, CONFIG.hmPersonCols.lastEnrichment + 1).setValue(isoNow_());
      } catch (stampErr) {
        Logger.log(`  Failed to stamp Last_Enrichment on error: ${stampErr.toString()}`);
      }
    }

    // Rate limiting: pause every 20 records
    if ((i + 1) % 20 === 0 && i < toEnrichThisRun.length - 1) {
      Logger.log(`  Rate limit: processed ${i + 1} records, pausing 1 second...`);
      Utilities.sleep(1000);
    }
  }

  Logger.log(`✅ Title enrichment complete: ${enrichedCount} enriched, ${errorCount} errors, ${skippedCount} skipped, ${remaining} remaining`);

  return {
    processed: enrichedCount,
    remaining: remaining,
    errors: errorCount,
    skipped: skippedCount
  };
}

// Gemini API caller moved to 95b1_Title_Gemini_Caller.gs:
// inferTitleWithGemini_
