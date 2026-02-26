/**
 * BD TRACKER - CRUNCHBASE IMPORT
 * Version: 2.0.0 (Skeleton)
 *
 * CONTAINS:
 * - Crunchbase CSV header validation
 * - Crunchbase data processing (skeleton for future implementation)
 * - Company_Master updates (*_CB columns only)
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 *
 * STATUS: SKELETON - Ready for implementation when needed
 * NOTE: This importer writes ONLY to the *_CB columns (O-AB) in Company_Master
 *       It never overwrites manual data in columns A-N
 */

/** ==========================================================================
 *  MAIN CRUNCHBASE IMPORT ORCHESTRATOR
 *  ========================================================================== */

/**
 * Run Crunchbase Import: Validate Headers & Process Rows
 * USER-FACING FUNCTION (future menu item)
 *
 * Two-phase process:
 * 1. Validate headers match Crunchbase export format exactly
 * 2. Process unprocessed rows and update Company_Master (*_CB columns)
 */
function Run_Crunchbase_ValidateAndProcess() {
  try {
    const ss = getSpreadsheet_();

    // Phase 1: Validate headers
    const qa = crunchbaseValidateHeadersAndQA_();

    if (qa.halted) {
      ss.toast('❌ Import HALTED: Header mismatch detected. Check QA_LandingHeaders sheet for details.', 'Crunchbase Import', 10);
      logError_('CRUNCHBASE_IMPORT', 'HEADER_MISMATCH', 'Crunchbase header validation failed', qa.mismatches.join('; '));
      return;
    }

    // Phase 2: Process rows (TO BE IMPLEMENTED)
    const result = crunchbaseProcessRows_();

    if (result.errors > 0) {
      ss.toast(
        `⚠️ Crunchbase Import: Processed ${result.processed} rows | Updated: ${result.coUpdated} | Added: ${result.coAdded} | Errors: ${result.errors}`,
        'Crunchbase Complete (with errors)', 10
      );
    } else {
      ss.toast(
        `✅ Crunchbase Import: Processed ${result.processed} rows | Updated: ${result.coUpdated} | Added: ${result.coAdded}`,
        'Crunchbase Complete', 10
      );
    }

    // Enrichment chain removed from auto-trigger (2026-02-16 audit)
    // Run manually from menu if needed: ICP Tools > Run Enrichment Chain

  } catch (e) {
    logError_('CRUNCHBASE_IMPORT', 'IMPORT_ERROR', 'Run_Crunchbase_ValidateAndProcess', e.toString());
    SpreadsheetApp.getUi().alert(`Error during Crunchbase import: ${e.message}`);
  }
}

/** ==========================================================================
 *  HEADER VALIDATION
 *  ========================================================================== */

/**
 * Validate Import CB headers match expected format
 * Logs results to QA_LandingHeaders sheet
 *
 * @returns {Object} - {halted: boolean, mismatches: Array<string>}
 */
function crunchbaseValidateHeadersAndQA_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(CRUNCHBASE_CFG.sheetName);

  if (!sh) {
    throw new Error(`Sheet "${CRUNCHBASE_CFG.sheetName}" not found`);
  }

  // Verify headers
  const verification = verifyHeaders_(sh, CRUNCHBASE_CFG.expectedHeaders, 15);

  // Log to QA sheet
  let qaSh = ss.getSheetByName(CRUNCHBASE_CFG.qaSheet);
  if (!qaSh) {
    qaSh = ss.insertSheet(CRUNCHBASE_CFG.qaSheet);
    qaSh.appendRow(['Run_ID', 'Tab', 'Source', 'Missing_Required', 'Unknown_Extras', 'Halted', 'Rows_Processed', 'Rows_Errors', 'Timestamp']);
  }

  const timestamp = isoNow_();
  const halted = !verification.isValid;
  const mismatches = verification.mismatches.join('; ');

  qaSh.appendRow([
    timestamp,
    CRUNCHBASE_CFG.sheetName,
    'Crunchbase',
    mismatches,
    '',
    halted ? 'YES' : 'NO',
    '',
    '',
    timestamp
  ]);

  Logger.log(halted ? `❌ Header validation FAILED: ${mismatches}` : '✓ Header validation passed');

  return {
    halted: halted,
    mismatches: verification.mismatches
  };
}

/** ==========================================================================
 *  ROW PROCESSING (TO BE IMPLEMENTED)
 *  ========================================================================== */

/**
 * Process Crunchbase rows and update Company_Master (*_CB columns)
 * Only processes rows where "Processed" column != "Yes"
 *
 * LOGIC:
 * 1. Extract domain from Website or LinkedIn URL
 * 2. Match against Company_Master by domain
 * 3. Update ONLY *_CB columns (18-33):
 *    - Company_CB (18)
 *    - Company URL_CB (19)
 *    - Company LinkedIn URL_CB (20)
 *    - HQ City_CB (21)
 *    - HQ State_CB (22)
 *    - HQ Country_CB (23)
 *    - Industry_CB (24)
 *    - Company Size_CB (25)
 *    - Company Revenue Range_CB (26)
 *    - Growth Stage_CB (27) - Not in CB data
 *    - Ownership_CB (28) - Not in CB data
 *    - Last Funding Type_CB (29)
 *    - Last Funding Date_CB (30)
 *    - Last Funding Amount_CB (31)
 *    - Number of Funding Rounds_CB (32)
 *    - Last_Updated_CB (33)
 *
 * @returns {Object} - {processed: number, coUpdated: number, errors: number}
 */
function crunchbaseProcessRows_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(CRUNCHBASE_CFG.sheetName);
  const co = ss.getSheetByName(CRUNCHBASE_CFG.coSheet);

  if (!sh) throw new Error(`Sheet "${CRUNCHBASE_CFG.sheetName}" not found`);
  if (!co) throw new Error(`Sheet "${CRUNCHBASE_CFG.coSheet}" not found`);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data rows in Import CB');
    return { processed: 0, coUpdated: 0, errors: 0 };
  }

  // Batch read data (columns 1-15) and ops (columns 21-25)
  const dataRange = sh.getRange(2, 1, lastRow - 1, 15);
  const data = dataRange.getValues();

  const opsRange = sh.getRange(2, CRUNCHBASE_CFG.ops.runId + 1, lastRow - 1, 5);
  const opsData = opsRange.getValues();

  // Read existing Company_Master domains and full data
  const coLastRow = co.getLastRow();
  let coData = [];

  if (coLastRow >= 2) {
    // Read all Company_Master data (need columns A through AK = 37 columns)
    coData = co.getRange(2, 1, coLastRow - 1, 28).getValues();
  } else {
    // Company_Master is empty - we'll add all companies as new
    Logger.log('Company_Master is empty - all companies will be added as new rows');
  }

  // Build domain → row index map
  const domainToRowIndex = {};
  for (let i = 0; i < coData.length; i++) {
    const domain = String(coData[i][0]).trim().toLowerCase();
    if (domain) {
      domainToRowIndex[domain] = i;
    }
  }

  // Accumulators
  let processedCount = 0;
  let updatedCount = 0;
  let addedCount = 0;
  let errorCount = 0;

  const runId = isoNow_();
  const cols = CRUNCHBASE_CFG.cols;
  const coToAdd = []; // Track new companies to add
  const industriesToLog = []; // Track industry data for normalization
  const sizeRevenueToLog = []; // Track size/revenue data for normalization

  // Process each Crunchbase row
  for (let i = 0; i < data.length; i++) {
    try {
      // Skip if already processed
      if (String(opsData[i][2]).toUpperCase() === 'YES') {
        continue;
      }

      const row = data[i];

      // Extract domain from Website or LinkedIn
      const websiteRaw = String(row[cols.website] || '').trim();
      const linkedInRaw = String(row[cols.linkedIn] || '').trim();

      let domain = cleanDomain_(websiteRaw);
      if (!domain) {
        domain = cleanDomain_(linkedInRaw);
      }

      if (!domain) {
        opsData[i][0] = runId;
        opsData[i][1] = 'Crunchbase';
        opsData[i][2] = 'Yes';
        opsData[i][3] = 'YES';
        opsData[i][4] = 'Could not extract domain';
        errorCount++;
        continue;
      }

      // Extract and clean data
      const orgName = String(row[cols.orgName] || '').trim();
      const website = websiteRaw;
      const linkedIn = linkedInRaw;
      const industriesRaw = String(row[cols.industries] || '').trim();
      const numEmployeesRaw = String(row[cols.numEmployees] || '').trim();
      const numEmployees = "'" + fixDateConvertedSize_(numEmployeesRaw); // Fix date conversion + force text
      const revenueRange = String(row[cols.revenueRange] || '').trim();
      const lastFundingType = String(row[cols.lastFundingType] || '').trim();
      const lastFundingDateRaw = String(row[cols.lastFundingDate] || '').trim();
      const lastFundingAmount = String(row[cols.lastFundingAmount] || '').trim();
      const numRounds = String(row[cols.numRounds] || '').trim();

      // Parse HQ Location: "Denver, Colorado, United States" → City, State, Country
      const hqLocation = String(row[cols.hqLocation] || '').trim();
      const hqParts = hqLocation.split(',').map(p => p.trim());
      const hqCity = hqParts[0] || '';
      const hqState = hqParts[1] || '';
      const hqCountry = hqParts[2] || '';

      // Parse industries: "Biotechnology, Medical, Therapeutics" → Industry + Sub
      const industryList = industriesRaw ? industriesRaw.split(',').map(s => s.trim()) : [];
      const industry = industryList[0] || '';
      const subIndustry = industryList.slice(1).join(', ');

      // Format dates (Bug #6, #7)
      let formattedFundingDate = '';
      if (lastFundingDateRaw) {
        const dateObj = new Date(lastFundingDateRaw);
        if (!isNaN(dateObj)) {
          formattedFundingDate = Utilities.formatDate(dateObj, CONFIG.timezone, 'MM/dd/yyyy');
        }
      }

      const formattedNow = Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy');

      // Match against Company_Master
      const rowIndex = domainToRowIndex[domain];

      if (rowIndex === undefined) {
        // Company NOT found - ADD NEW COMPANY
        const newRow = new Array(28).fill(''); // 28 columns (A-AB) - final structure

        // Base columns (A-AB): Populate from CB data
        newRow[0] = domain; // A: Domain (PK)
        newRow[1] = orgName; // B: Company
        newRow[2] = ''; // C: Company Description (CB doesn't have)
        newRow[3] = ''; // D: Company_Year_Founded (CB doesn't have)
        newRow[4] = ''; // E: IPO_Date (CB doesn't have)
        newRow[5] = website; // F: Company URL
        newRow[6] = linkedIn; // G: Company LinkedIn URL
        newRow[7] = ''; // H: Company ICP Total (formula-driven from ICP_Score)
        newRow[8] = hqCity; // I: HQ City
        newRow[9] = ''; // J: Region (formula-driven from CountyRegion_Lookup)
        newRow[10] = hqState; // K: HQ State
        newRow[11] = hqCountry; // L: HQ Country
        newRow[12] = ''; // M: Industry (formula from Industry_Normalization)
        newRow[13] = ''; // N: Sub-Industry (formula from Industry_Normalization)
        newRow[14] = ''; // O: SIC (CB doesn't have)
        newRow[15] = ''; // P: NAIC (CB doesn't have)
        newRow[16] = ''; // Q: Specialties (CB doesn't have)
        newRow[17] = ''; // R: CompanySizeNorm (formula from Size_Revenue_Normalization)
        newRow[18] = ''; // S: CompanyRevenueNorm (formula from Size_Revenue_Normalization)
        newRow[19] = lastFundingType; // T: Last Funding Type
        newRow[20] = formattedFundingDate; // U: Last Funding Date
        newRow[21] = lastFundingAmount; // V: Last Funding Amount
        newRow[22] = numRounds; // W: Number of Funding Rounds
        newRow[23] = ''; // X: Total Funding Amount (CB doesn't have)
        newRow[24] = ''; // Y: Growth Stage (formula-driven)
        newRow[25] = ''; // Z: Months_Since_Funding (formula-driven)
        newRow[26] = ''; // AA: Ownership (formula from Ownership_Normalization)
        newRow[27] = 'CB ' + Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy HH:mm'); // AB: Last_Updated

        coToAdd.push(newRow);
        addedCount++;

        // Mark row as processed
        opsData[i][0] = runId;
        opsData[i][1] = 'Crunchbase';
        opsData[i][2] = 'Yes';
        opsData[i][3] = '';
        opsData[i][4] = 'New company added';
        processedCount++;

      } else {
        // Company FOUND - UPDATE EXISTING (NEW LOGIC: Write to base, recency wins)

        // Write to BASE columns (B-AB) - update with CB data
        if (orgName) coData[rowIndex][1] = orgName; // B: Company
        if (website) coData[rowIndex][5] = website; // F: Company URL
        if (linkedIn) coData[rowIndex][6] = linkedIn; // G: Company LinkedIn URL
        if (hqCity) coData[rowIndex][8] = hqCity; // I: HQ City
        if (hqState) coData[rowIndex][10] = hqState; // K: HQ State
        if (hqCountry) coData[rowIndex][11] = hqCountry; // L: HQ Country
        // M & N are formulas from Industry_Normalization - don't write
        // R & S are formulas from Size_Revenue_Normalization - don't write
        if (lastFundingType) coData[rowIndex][19] = lastFundingType; // T: Last Funding Type
        if (formattedFundingDate) coData[rowIndex][20] = formattedFundingDate; // U: Last Funding Date
        if (lastFundingAmount) coData[rowIndex][21] = lastFundingAmount; // V: Last Funding Amount
        if (numRounds) coData[rowIndex][22] = numRounds; // W: Number of Funding Rounds
        // AA is formula from Ownership_Normalization - don't write
        coData[rowIndex][27] = 'CB ' + Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy HH:mm'); // AB: Last_Updated

        updatedCount++;

        // Mark row as processed
        opsData[i][0] = runId;
        opsData[i][1] = 'Crunchbase';
        opsData[i][2] = 'Yes';
        opsData[i][3] = '';
        opsData[i][4] = '';
        processedCount++;
      }

      // Log industry data for normalization (both new and updated companies)
      if (domain && industriesRaw) {
        industriesToLog.push({
          domain: domain,
          primaryIndustry: industry,
          subIndustry: subIndustry
        });
      }

      // Log size/revenue data for normalization (both new and updated companies)
      if (domain && (numEmployees || revenueRange)) {
        sizeRevenueToLog.push({
          domain: domain,
          companySize: numEmployeesRaw,  // Use raw value before fixDateConvertedSize_
          companyRevenue: revenueRange
        });
      }

    } catch (rowError) {
      // Log row-level error
      opsData[i][0] = runId;
      opsData[i][1] = 'Crunchbase';
      opsData[i][2] = 'Yes';
      opsData[i][3] = 'YES';
      opsData[i][4] = rowError.toString().substring(0, 100);
      errorCount++;

      Logger.log(`Error processing CB row ${i+2}: ${rowError.toString()}`);
    }
  }

  // Batch write operations status back to Import CB
  opsRange.setValues(opsData);

  // Batch write updated Company_Master data
  if (updatedCount > 0) {
    co.getRange(2, 1, coData.length, 28).setValues(coData);
    Logger.log(`✓ Updated ${updatedCount} companies in Company_Master`);
  }

  // Append new companies to Company_Master
  let newCompanyStartRow = 0;
  if (coToAdd.length > 0) {
    newCompanyStartRow = getFirstEmptyRowA_(co);
    ensureSheetHasRows_(co, newCompanyStartRow + coToAdd.length - 1);
    co.getRange(newCompanyStartRow, 1, coToAdd.length, 28).setValues(coToAdd);
    Logger.log(`✓ Added ${coToAdd.length} new companies to Company_Master`);
  }

  // NOTE: Ownership enrichment is now a separate manual step
  // Run "Enrich_Ownership_With_Gemini()" from the menu after importing
  if (coToAdd.length > 0) {
    Logger.log(`ℹ️ ${coToAdd.length} companies imported. Run Enrich_Ownership_With_Gemini() to classify ownership.`);
  }

  // Append new company domains to ICP_Score tab
  if (coToAdd.length > 0) {
    try {
      const icpSheet = ss.getSheetByName('ICP_Score');
      if (icpSheet) {
        const icpLastRow = getFirstEmptyRowA_(icpSheet);
        const domainsToAdd = coToAdd.map(row => [row[0], row[1]]); // Domain (A), Company (B)
        ensureSheetHasRows_(icpSheet, icpLastRow + domainsToAdd.length - 1);
        icpSheet.getRange(icpLastRow, 1, domainsToAdd.length, 2).setValues(domainsToAdd);
        Logger.log(`✓ Added ${domainsToAdd.length} domains to ICP_Score`);
      }
    } catch (e) {
      Logger.log(`Warning: Failed to update ICP_Score: ${e.toString()}`);
    }
  }

  // Log industry data to normalization table (Bug #9 fix)
  // Log industry data for normalization (separate from company rows)
  if (industriesToLog.length > 0) {
    try {
      Utilities.sleep(2000); // Wait for Sheets service to recover
      logIndustryNormalization_(industriesToLog, 'Crunchbase');
    } catch (e) {
      Logger.log(`Warning: Failed to log industry normalization: ${e.toString()}`);
    }
  }

  // Log size/revenue data to normalization table
  if (sizeRevenueToLog.length > 0) {
    try {
      Utilities.sleep(2000); // Wait for Sheets service to recover
      logSizeRevenueNormalization_(sizeRevenueToLog, 'Crunchbase');
    } catch (e) {
      Logger.log(`Warning: Failed to log size/revenue normalization: ${e.toString()}`);
    }
  }

  // Log operation summary
  persistRunLog_('CrunchbaseImport', {
    processed: processedCount,
    coUpdated: updatedCount,
    coAdded: addedCount,
    errors: errorCount,
    runId: runId
  });

  return {
    processed: processedCount,
    coUpdated: updatedCount,
    coAdded: addedCount,
    errors: errorCount
  };
}

/** ==========================================================================
 *  HELPER FUNCTIONS (FOR FUTURE IMPLEMENTATION)
 *  ========================================================================== */

/**
 * Parse funding amount string (e.g., "$5,000,000" -> 5000000)
 * Handles various formats: $5M, $5.5M, $5,000,000
 *
 * @param {string} amountStr - Raw funding amount string
 * @returns {number} - Parsed amount as number (or 0 if invalid)
 */
function parseFundingAmount_(amountStr) {
  if (!amountStr) return 0;

  const str = String(amountStr).toUpperCase().trim();

  // Remove $ and commas
  let cleaned = str.replace(/[$,]/g, '');

  // Handle M (million) and B (billion) suffixes
  if (cleaned.includes('M')) {
    const value = parseFloat(cleaned.replace('M', ''));
    return value * 1000000;
  } else if (cleaned.includes('B')) {
    const value = parseFloat(cleaned.replace('B', ''));
    return value * 1000000000;
  }

  return parseFloat(cleaned) || 0;
}

/**
 * Calculate months since funding date
 * Used for recency decay scoring
 *
 * @param {Date|string} fundingDate - Funding date
 * @returns {number} - Months since funding (rounded)
 */
function monthsSinceFunding_(fundingDate) {
  if (!fundingDate) return 9999; // Very old if no date

  const fundDate = new Date(fundingDate);
  const now = new Date();

  const diffMs = now - fundDate;
  const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44); // Average month length

  return Math.round(diffMonths);
}

// NOTE: enrichOwnershipWithGemini_ and classifyOwnershipWithGemini_ moved to 93_Enrich_Ownership_Gemini.gs
// The enrichment chain in 07_Enrichment_Chain.gs calls the headless version automatically
