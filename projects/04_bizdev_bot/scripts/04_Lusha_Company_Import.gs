/**
 * BD TRACKER - LUSHA COMPANY IMPORT
 * Version: 1.0.0
 * Date: 2026-02-04
 *
 * CONTAINS:
 * - Lusha Company CSV header validation
 * - Lusha Company data processing
 * - Company_Master updates (*_Lusha columns only)
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 *
 * NOTE: This importer writes ONLY to the *_Lusha columns (BP-CK) in Company_Master
 *       It never overwrites manual data in columns A-N
 */

/** ==========================================================================
 *  MAIN LUSHA COMPANY IMPORT ORCHESTRATOR
 *  ========================================================================== */

/**
 * Run Lusha Company Import: Validate Headers & Process Rows
 * USER-FACING FUNCTION (called from menu)
 *
 * Two-phase process:
 * 1. Validate headers match Lusha Company export format exactly
 * 2. Process unprocessed rows and update Company_Master (*_Lusha columns)
 */
function Run_LushaCompany_ValidateAndProcess() {
  try {
    const ss = getSpreadsheet_();

    // Phase 1: Validate headers
    const qa = lushaCompanyValidateHeadersAndQA_();

    if (qa.halted) {
      ss.toast('❌ Import HALTED: Header mismatch detected. Check QA_LandingHeaders sheet for details.', 'Lusha Company Import', 10);
      logError_('LUSHA_COMPANY_IMPORT', 'HEADER_MISMATCH', 'Lusha Company header validation failed', qa.mismatches.join('; '));
      return;
    }

    // Phase 2: Process rows
    const result = lushaCompanyProcessRows_();

    if (result.errors > 0) {
      ss.toast(
        `⚠️ Lusha Company Import: Processed ${result.processed} rows | Updated: ${result.coUpdated} | Added: ${result.coAdded} | Errors: ${result.errors}`,
        'Lusha Company Complete (with errors)', 10
      );
    } else {
      ss.toast(
        `✅ Lusha Company Import: Processed ${result.processed} rows | Updated: ${result.coUpdated} | Added: ${result.coAdded}`,
        'Lusha Company Complete', 10
      );
    }

    // Enrichment chain removed from auto-trigger (2026-02-16 audit)
    // Lusha provides clean data — Gemini enrichment no longer needed on import
    // Run manually from menu if needed: ICP Tools > Run Enrichment Chain

  } catch (e) {
    logError_('LUSHA_COMPANY_IMPORT', 'IMPORT_ERROR', 'Run_LushaCompany_ValidateAndProcess', e.toString());
    SpreadsheetApp.getUi().alert(`Error during Lusha Company import: ${e.message}`);
  }
}

/** ==========================================================================
 *  HEADER VALIDATION
 *  ========================================================================== */

/**
 * Validate LushaCompanyInserts headers match expected format
 * Logs results to QA_LandingHeaders sheet
 *
 * @returns {Object} - {halted: boolean, mismatches: Array<string>}
 */
function lushaCompanyValidateHeadersAndQA_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(LUSHA_COMPANY_CFG.sheetName);

  if (!sh) {
    throw new Error(`Sheet "${LUSHA_COMPANY_CFG.sheetName}" not found`);
  }

  // Verify headers (30 columns)
  const verification = verifyHeaders_(sh, LUSHA_COMPANY_CFG.expectedHeaders, 30);

  // Log to QA sheet
  let qaSh = ss.getSheetByName(LUSHA_COMPANY_CFG.qaSheet);
  if (!qaSh) {
    qaSh = ss.insertSheet(LUSHA_COMPANY_CFG.qaSheet);
    qaSh.appendRow(['Run_ID', 'Tab', 'Source', 'Missing_Required', 'Unknown_Extras', 'Halted', 'Rows_Processed', 'Rows_Errors', 'Timestamp']);
  }

  const timestamp = isoNow_();
  const halted = !verification.isValid;
  const mismatches = verification.mismatches.join('; ');

  qaSh.appendRow([
    timestamp,
    LUSHA_COMPANY_CFG.sheetName,
    'Lusha_Company',
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
 *  ROW PROCESSING
 *  ========================================================================== */

/**
 * Process Lusha Company rows and update Company_Master (*_Lusha columns)
 * Only processes rows where "Processed" column != "Yes"
 *
 * LOGIC:
 * 1. Extract domain from Company Domain field
 * 2. Match against Company_Master by domain
 * 3. Update ONLY *_Lusha columns (BP-CK = indices 67-88):
 *    - Company_Lusha (BP/67)
 *    - Company_URL_Lusha (BQ/68)
 *    - Company_LinkedIn_URL_Lusha (BR/69)
 *    - Company_Description_Lusha (BS/70)
 *    - Company_Year_Founded_Lusha (BT/71)
 *    - HQ_City_Lusha (BU/72)
 *    - HQ_State_Lusha (BV/73)
 *    - HQ_Country_Lusha (BW/74)
 *    - Industry_Lusha (BX/75)
 *    - Sub_Industry_Lusha (BY/76)
 *    - SIC_Lusha (BZ/77)
 *    - NAIC_Lusha (CA/78)
 *    - Specialties_Lusha (CB/79)
 *    - Company_Size_Lusha (CC/80)
 *    - Company_Revenue_Lusha (CD/81)
 *    - Total_Funding_Amount_Lusha (CE/82)
 *    - Total_Number_of_Rounds_Lusha (CF/83)
 *    - Last_Funding_Type_Lusha (CG/84)
 *    - Last_Funding_Date_Lusha (CH/85)
 *    - Last_Funding_Amount_Lusha (CI/86)
 *    - IPO_Date_Lusha (CJ/87)
 *    - Last_Updated_Lusha (CK/88)
 *
 * @returns {Object} - {processed: number, coUpdated: number, coAdded: number, errors: number}
 */
function lushaCompanyProcessRows_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(LUSHA_COMPANY_CFG.sheetName);
  const co = ss.getSheetByName(LUSHA_COMPANY_CFG.coSheet);

  if (!sh) throw new Error(`Sheet "${LUSHA_COMPANY_CFG.sheetName}" not found`);
  if (!co) throw new Error(`Sheet "${LUSHA_COMPANY_CFG.coSheet}" not found`);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data rows in LushaCompanyInserts');
    return { processed: 0, coUpdated: 0, coAdded: 0, errors: 0 };
  }

  // Batch read data (columns 1-30) and ops (columns 31-35)
  const dataRange = sh.getRange(2, 1, lastRow - 1, 30);
  const data = dataRange.getValues();

  const opsRange = sh.getRange(2, LUSHA_COMPANY_CFG.ops.runId + 1, lastRow - 1, 5);
  const opsData = opsRange.getValues();

  // Read existing Company_Master domains and full data
  const coLastRow = co.getLastRow();
  if (coLastRow < 2) {
    Logger.log('No companies in Company_Master to update');
    return { processed: 0, coUpdated: 0, coAdded: 0, errors: 0 };
  }

  // Read all Company_Master data (need columns A through AK = 37 columns)
  const coData = co.getRange(2, 1, coLastRow - 1, 28).getValues();

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
  const cols = LUSHA_COMPANY_CFG.cols;
  const coToAdd = []; // Track new companies to add
  const industriesToLog = []; // Track industry data for normalization
  const sizeRevenueToLog = []; // Track size/revenue data for normalization

  // Process each Lusha Company row
  for (let i = 0; i < data.length; i++) {
    try {
      // Skip if already processed
      if (String(opsData[i][2]).toUpperCase() === 'YES') {
        continue;
      }

      const row = data[i];

      // Extract domain from Company Domain field
      const domainRaw = String(row[cols.companyDomain] || '').trim();
      const domain = cleanDomain_(domainRaw);

      if (!domain) {
        opsData[i][0] = runId;
        opsData[i][1] = 'Lusha_Company';
        opsData[i][2] = 'Yes';
        opsData[i][3] = 'YES';
        opsData[i][4] = 'Missing domain';
        errorCount++;
        continue;
      }

      // Extract and clean data
      const companyName = String(row[cols.companyName] || '').trim();
      const companyWebsite = String(row[cols.companyWebsite] || '').trim();
      const linkedIn = String(row[cols.linkedIn] || '').trim();
      const description = String(row[cols.companyDescription] || '').trim();
      const yearFounded = String(row[cols.yearFounded] || '').trim();
      const city = String(row[cols.city] || '').trim();
      const state = String(row[cols.state] || '').trim();
      const country = String(row[cols.country] || '').trim();
      const mainIndustry = String(row[cols.mainIndustry] || '').trim();
      const subIndustry = String(row[cols.subIndustry] || '').trim();
      const sic = String(row[cols.sic] || '').trim();
      const naic = String(row[cols.naic] || '').trim();
      const specialties = String(row[cols.specialties] || '').trim();
      const numEmployeesRaw = String(row[cols.numEmployees] || '').trim();
      const numEmployees = "'" + fixDateConvertedSize_(numEmployeesRaw); // Fix date conversion + force text
      const revenue = String(row[cols.revenue] || '').trim();
      const totalFundingAmount = String(row[cols.totalFundingAmount] || '').trim();
      const totalRounds = String(row[cols.totalRounds] || '').trim();
      const lastRoundType = String(row[cols.lastRoundType] || '').trim();
      const lastRoundDateRaw = String(row[cols.lastRoundDate] || '').trim();
      const lastRoundAmount = String(row[cols.lastRoundAmount] || '').trim();
      const ipoDateRaw = String(row[cols.ipoDate] || '').trim();

      // Format dates
      let formattedLastRoundDate = '';
      if (lastRoundDateRaw) {
        const dateObj = new Date(lastRoundDateRaw);
        if (!isNaN(dateObj)) {
          formattedLastRoundDate = Utilities.formatDate(dateObj, CONFIG.timezone, 'MM/dd/yyyy');
        }
      }

      let formattedIPODate = '';
      if (ipoDateRaw) {
        const dateObj = new Date(ipoDateRaw);
        if (!isNaN(dateObj)) {
          formattedIPODate = Utilities.formatDate(dateObj, CONFIG.timezone, 'MM/dd/yyyy');
        }
      }

      const formattedNow = Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy');

      // Match against Company_Master
      const rowIndex = domainToRowIndex[domain];

      if (rowIndex === undefined) {
        // Company NOT found - ADD NEW COMPANY
        const newRow = new Array(28).fill(''); // 28 columns (A-AB) - final structure

        // Base columns (A-AB): Populate from Lusha data
        newRow[0] = domain; // A: Domain (PK)
        newRow[1] = companyName; // B: Company
        newRow[2] = description; // C: Company Description
        newRow[3] = yearFounded; // D: Company_Year_Founded
        newRow[4] = formattedIPODate; // E: IPO_Date
        newRow[5] = companyWebsite; // F: Company URL
        newRow[6] = linkedIn; // G: Company LinkedIn URL
        newRow[7] = ''; // H: Company ICP Total (formula from ICP_Score)
        newRow[8] = city; // I: HQ City
        newRow[9] = ''; // J: Region (formula from CountyRegion_Lookup)
        newRow[10] = state; // K: HQ State
        newRow[11] = country; // L: HQ Country
        newRow[12] = ''; // M: Industry (formula from Industry_Normalization)
        newRow[13] = ''; // N: Sub-Industry (formula from Industry_Normalization)
        newRow[14] = sic; // O: SIC
        newRow[15] = naic; // P: NAIC
        newRow[16] = specialties; // Q: Specialties
        newRow[17] = ''; // R: CompanySizeNorm (formula from Size_Revenue_Normalization)
        newRow[18] = ''; // S: CompanyRevenueNorm (formula from Size_Revenue_Normalization)
        newRow[19] = lastRoundType; // T: Last Funding Type
        newRow[20] = formattedLastRoundDate; // U: Last Funding Date
        newRow[21] = lastRoundAmount; // V: Last Funding Amount
        newRow[22] = totalRounds; // W: Number of Funding Rounds
        newRow[23] = totalFundingAmount; // X: Total Funding Amount
        newRow[24] = ''; // Y: Growth Stage (formula-driven)
        newRow[25] = ''; // Z: Months_Since_Funding (formula-driven)
        newRow[26] = ''; // AA: Ownership (formula from Ownership_Normalization)
        newRow[27] = 'Lusha ' + Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy HH:mm'); // AB: Last_Updated

        coToAdd.push(newRow);
        addedCount++;

        // Mark row as processed
        opsData[i][0] = runId;
        opsData[i][1] = 'Lusha_Company';
        opsData[i][2] = 'Yes';
        opsData[i][3] = '';
        opsData[i][4] = 'New company added';
        processedCount++;

      } else {
        // Company FOUND - UPDATE EXISTING (NEW LOGIC: Write to base, recency wins)

        // Write to BASE columns (B-AA) - recency wins
        if (companyName) coData[rowIndex][1] = companyName; // B: Company
        if (description) coData[rowIndex][2] = description; // C: Company Description
        if (yearFounded) coData[rowIndex][3] = yearFounded; // D: Company_Year_Founded
        if (formattedIPODate) coData[rowIndex][4] = formattedIPODate; // E: IPO_Date
        if (companyWebsite) coData[rowIndex][5] = companyWebsite; // F: Company URL
        if (linkedIn) coData[rowIndex][6] = linkedIn; // G: Company LinkedIn URL
        if (city) coData[rowIndex][8] = city; // I: HQ City
        if (state) coData[rowIndex][10] = state; // K: HQ State
        if (country) coData[rowIndex][11] = country; // L: HQ Country
        // M & N are formulas from Industry_Normalization - don't write
        if (sic) coData[rowIndex][14] = sic; // O: SIC
        if (naic) coData[rowIndex][15] = naic; // P: NAIC
        if (specialties) coData[rowIndex][16] = specialties; // Q: Specialties
        // R & S are formulas from Size_Revenue_Normalization - don't write
        if (lastRoundType) coData[rowIndex][19] = lastRoundType; // T: Last Funding Type
        if (formattedLastRoundDate) coData[rowIndex][20] = formattedLastRoundDate; // U: Last Funding Date
        if (lastRoundAmount) coData[rowIndex][21] = lastRoundAmount; // V: Last Funding Amount
        if (totalRounds) coData[rowIndex][22] = totalRounds; // W: Number of Funding Rounds
        if (totalFundingAmount) coData[rowIndex][23] = totalFundingAmount; // X: Total Funding Amount
        // AA is formula from Ownership_Normalization - don't write
        coData[rowIndex][27] = 'Lusha ' + Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy HH:mm'); // AB: Last_Updated

        updatedCount++;

        // Mark row as processed
        opsData[i][0] = runId;
        opsData[i][1] = 'Lusha_Company';
        opsData[i][2] = 'Yes';
        opsData[i][3] = '';
        opsData[i][4] = '';
        processedCount++;
      }

      // Log industry data for normalization (both new and updated companies)
      if (domain && mainIndustry) {
        industriesToLog.push({
          domain: domain,
          primaryIndustry: mainIndustry,
          subIndustry: subIndustry
        });
      }

      // Log size/revenue data for normalization (both new and updated companies)
      if (domain && (numEmployees || revenue)) {
        sizeRevenueToLog.push({
          domain: domain,
          companySize: numEmployees,
          companyRevenue: revenue
        });
      }

    } catch (rowError) {
      // Log row-level error
      opsData[i][0] = runId;
      opsData[i][1] = 'Lusha_Company';
      opsData[i][2] = 'Yes';
      opsData[i][3] = 'YES';
      opsData[i][4] = rowError.toString().substring(0, 100);
      errorCount++;

      Logger.log(`Error processing Lusha Company row ${i+2}: ${rowError.toString()}`);
    }
  }

  // Batch write operations status back to LushaCompanyInserts
  opsRange.setValues(opsData);

  // Batch write updated Company_Master data
  if (updatedCount > 0) {
    co.getRange(2, 1, coData.length, 28).setValues(coData);
    Logger.log(`✓ Updated ${updatedCount} companies in Company_Master`);
  }

  // Append new companies to Company_Master
  if (coToAdd.length > 0) {
    const coStartRow = getFirstEmptyRowA_(co);
    ensureSheetHasRows_(co, coStartRow + coToAdd.length - 1);
    co.getRange(coStartRow, 1, coToAdd.length, 28).setValues(coToAdd);
    Logger.log(`✓ Added ${coToAdd.length} new companies to Company_Master`);
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

  // Log industry data to normalization table
  if (industriesToLog.length > 0) {
    try {
      Utilities.sleep(2000); // Wait for Sheets service to recover
      logIndustryNormalization_(industriesToLog, 'Lusha_Company');
    } catch (e) {
      Logger.log(`Warning: Failed to log industry normalization: ${e.toString()}`);
    }
  }

  // Log size/revenue data to normalization table
  if (sizeRevenueToLog.length > 0) {
    try {
      Utilities.sleep(2000); // Wait for Sheets service to recover
      logSizeRevenueNormalization_(sizeRevenueToLog, 'Lusha_Company');
    } catch (e) {
      Logger.log(`Warning: Failed to log size/revenue normalization: ${e.toString()}`);
    }
  }

  // Log operation summary
  persistRunLog_('LushaCompanyImport', {
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
