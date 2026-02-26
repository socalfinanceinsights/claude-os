/**
 * BD TRACKER - LUSHA IMPORT
 * Version: 2.0.0 (Refactored)
 *
 * CONTAINS:
 * - Lusha CSV header validation
 * - Lusha data processing with proper upsert logic
 * - HM_Person_Master and Company_Master updates
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 */

/** ==========================================================================
 *  MAIN LUSHA IMPORT ORCHESTRATOR
 *  ========================================================================== */

/**
 * Run Lusha Import: Validate Headers & Process Rows
 * USER-FACING FUNCTION (called from menu)
 *
 * Two-phase process:
 * 1. Validate headers match Lusha export format exactly
 * 2. Process unprocessed rows and upsert to Master tables
 */
function Run_Lusha_ValidateAndProcess() {
  try {
    const ss = getSpreadsheet_();

    // Phase 1: Validate headers
    const qa = lushaValidateHeadersAndQA_();

    if (qa.halted) {
      ss.toast('❌ Import HALTED: Header mismatch detected. Check QA_LandingHeaders sheet for details.', 'Lusha Import', 10);
      logError_('LUSHA_IMPORT', 'HEADER_MISMATCH', 'Lusha header validation failed', qa.mismatches.join('; '));
      return;
    }

    // Phase 2: Process rows
    const result = lushaProcessRows_();

    if (result.errors > 0) {
      ss.toast(
        `⚠️ Lusha Import: Processed ${result.processed} rows | HM Added: ${result.hmAdded} | Co Added: ${result.coAdded} | Errors: ${result.errors}`,
        'Lusha Complete (with errors)', 10
      );
    } else {
      ss.toast(
        `✅ Lusha Import: Processed ${result.processed} rows | HM Added: ${result.hmAdded} | Co Added: ${result.coAdded}`,
        'Lusha Complete', 10
      );
    }

  } catch (e) {
    logError_('LUSHA_IMPORT', 'IMPORT_ERROR', 'Run_Lusha_ValidateAndProcess', e.toString());
    SpreadsheetApp.getUi().alert(`Error during Lusha import: ${e.message}`);
  }
}

/** ==========================================================================
 *  HEADER VALIDATION
 *  ========================================================================== */

/**
 * Validate Lusha_Inserts headers match expected format
 * Logs results to QA_LandingHeaders sheet
 *
 * @returns {Object} - {halted: boolean, mismatches: Array<string>}
 */
function lushaValidateHeadersAndQA_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(LUSHA_CFG.sheetName);

  if (!sh) {
    throw new Error(`Sheet "${LUSHA_CFG.sheetName}" not found`);
  }

  // Verify headers
  const verification = verifyHeaders_(sh, LUSHA_CFG.expectedHeaders, 56);

  // Log to QA sheet
  let qaSh = ss.getSheetByName(LUSHA_CFG.qaSheet);
  if (!qaSh) {
    qaSh = ss.insertSheet(LUSHA_CFG.qaSheet);
    qaSh.appendRow(['Run_ID', 'Tab', 'Source', 'Missing_Required', 'Unknown_Extras', 'Halted', 'Rows_Processed', 'Rows_Errors', 'Timestamp']);
  }

  const timestamp = isoNow_();
  const halted = !verification.isValid;
  const mismatches = verification.mismatches.join('; ');

  qaSh.appendRow([
    timestamp,
    LUSHA_CFG.sheetName,
    'Lusha',
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
 *  ROW PROCESSING (UPSERT LOGIC)
 *  ========================================================================== */

/**
 * Process Lusha rows and upsert to HM_Person_Master and Company_Master
 * Only processes rows where "Processed" column != "Yes"
 *
 * UPSERT LOGIC:
 * - HM_Person_Master: Upsert by composite key (update if exists, insert if new)
 * - Company_Master: "Blanks Only" upsert (only fill empty cells, never overwrite)
 *
 * @returns {Object} - {processed: number, hmAdded: number, coAdded: number, errors: number}
 */
function lushaProcessRows_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(LUSHA_CFG.sheetName);
  const hm = ss.getSheetByName(LUSHA_CFG.hmSheet);
  const co = ss.getSheetByName(LUSHA_CFG.coSheet);

  if (!sh) throw new Error(`Sheet "${LUSHA_CFG.sheetName}" not found`);
  if (!hm) throw new Error(`Sheet "${LUSHA_CFG.hmSheet}" not found`);
  if (!co) throw new Error(`Sheet "${LUSHA_CFG.coSheet}" not found`);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data rows in Lusha_Inserts');
    return { processed: 0, hmAdded: 0, coAdded: 0, errors: 0 };
  }

  // Batch read data (columns 1-56) and ops (columns 62-66)
  const dataRange = sh.getRange(2, 1, lastRow - 1, 56);
  const data = dataRange.getValues();

  const opsRange = sh.getRange(2, LUSHA_CFG.ops.runId + 1, lastRow - 1, 5);
  const opsData = opsRange.getValues();

  // Read existing HM_Person_Master keys + Last_Update_Date for dedup and stale check
  const hmLastRow = hm.getLastRow();
  const hmKeySet = new Set();
  const hmKeyToRow = new Map();  // key → row number (1-indexed)
  const hmKeyToDate = new Map(); // key → Last_Update_Date value

  const hmRowToDomain = new Map(); // row number (1-indexed) → existing Company_Domain value
  if (hmLastRow > 1) {
    const hmKeys = hm.getRange(2, 1, hmLastRow - 1, 1).getValues();
    const hmDates = hm.getRange(2, 14, hmLastRow - 1, 1).getValues(); // Column N
    const hmDomains = hm.getRange(2, 6, hmLastRow - 1, 1).getValues(); // Column F
    for (let r = 0; r < hmKeys.length; r++) {
      const k = String(hmKeys[r][0]).trim();
      if (k) {
        hmKeySet.add(k);
        hmKeyToRow.set(k, r + 2);
        hmKeyToDate.set(k, hmDates[r][0]);
        hmRowToDomain.set(r + 2, String(hmDomains[r][0]).trim());
      }
    }
  }

  // Read existing Company_Master domains for deduplication
  const coLastRow = co.getLastRow();
  const existingCoDomains = coLastRow > 1
    ? co.getRange(2, 1, coLastRow - 1, 1).getValues().flat().map(d => String(d).trim().toLowerCase())
    : [];
  const coDomainSet = new Set(existingCoDomains);

  // Accumulators
  const hmToAdd = [];
  const hmToUpdate = []; // v2.2: Stale record upserts
  const coToAdd = [];
  const contactInfoToAdd = []; // NEW v2.1: Accumulate contact info rows
  const industriesToLog = []; // Track industry data for normalization
  const sizeRevenueToLog = []; // Track size/revenue data for normalization
  let processedCount = 0;
  let errorCount = 0;

  const runId = isoNow_();
  const cols = LUSHA_CFG.cols;

  // Process each row
  for (let i = 0; i < data.length; i++) {
    try {
      // Skip if already processed
      if (String(opsData[i][2]).toUpperCase() === 'YES') {
        continue;
      }

      const row = data[i];

      // Extract and clean data
      const firstName = String(row[cols.firstName] || '').trim();
      const lastName = String(row[cols.lastName] || '').trim();
      const title = String(row[cols.title] || '').trim();
      const linkedInRaw = String(row[cols.linkedIn] || '').trim();
      const companyName = String(row[cols.companyName] || '').trim();
      const domainRaw = String(row[cols.companyDomain] || '').trim();

      // Clean LinkedIn and Domain
      const linkedIn = cleanLinkedInUrl_(linkedInRaw);
      const domain = cleanDomain_(domainRaw);

      // Skip if missing critical data
      if (!firstName && !lastName && !linkedIn) {
        opsData[i][0] = runId;
        opsData[i][1] = 'Lusha';
        opsData[i][2] = 'Yes';
        opsData[i][3] = 'YES';
        opsData[i][4] = 'Missing name and LinkedIn';
        errorCount++;
        continue;
      }

      // Generate composite key
      const key = generatePersonKey_(linkedIn, firstName, lastName, domain);

      // Extract contact info for HM_ContactInfo (v2.1)
      const workEmail = String(row[cols.email] || '').trim();
      const directEmail = String(row[cols.directEmail] || '').trim();
      const addEmail1 = String(row[cols.additionalEmail1] || '').trim();
      const addEmail2 = String(row[cols.additionalEmail2] || '').trim();

      const phone1 = String(row[cols.phone1] || '').trim();
      const phone1Type = String(row[cols.phone1Type] || '').trim().toLowerCase();
      const phone2 = String(row[cols.phone2] || '').trim();
      const phone2Type = String(row[cols.phone2Type] || '').trim().toLowerCase();

      // Determine primary email (prefer Work Email > Direct Email > Additional 1 > Additional 2)
      const primaryEmail = workEmail || directEmail || addEmail1 || addEmail2 || '';

      // Determine primary phone (prefer Mobile > Direct > Office)
      let primaryPhone = '';
      if (phone1 && phone1Type.includes('mobile')) primaryPhone = phone1;
      else if (phone2 && phone2Type.includes('mobile')) primaryPhone = phone2;
      else if (phone1 && phone1Type.includes('direct')) primaryPhone = phone1;
      else if (phone2 && phone2Type.includes('direct')) primaryPhone = phone2;
      else primaryPhone = phone1 || phone2 || '';

      const fullName = `${firstName} ${lastName}`.trim();

      if (!hmKeySet.has(key)) {
        // NEW RECORD — insert
        hmToAdd.push([
          key,              // A: Composite Key
          linkedIn,         // B: LinkedIn URL
          fullName,         // C: HM Name
          title,            // D: HM Title
          companyName,      // E: Company
          domain,           // F: Company Domain
          primaryEmail,     // G: Primary_Email
          primaryPhone,     // H: Primary_Phone
          'Lusha',          // I: Original_Source
          runId,            // J: Original_Source_Date
          '',               // K: Active Campaign ID (skip)
          '',               // L: Dedup_Status (skip)
          'Lusha',          // M: Last_Update_Source
          runId             // N: Last_Update_Date
        ]);
        hmKeySet.add(key);

      } else {
        // EXISTING RECORD — upsert only if stale (>90 days since last update)
        const existingRow = hmKeyToRow.get(key);
        const lastUpdate = hmKeyToDate.get(key);

        if (existingRow && isStaleRecord_(lastUpdate, LUSHA_UPSERT_STALE_DAYS)) {
          hmToUpdate.push({
            row: existingRow,
            title: title,
            company: companyName,
            domain: domain,
            email: primaryEmail,
            phone: primaryPhone,
            key: key
          });
        }
      }

      // Append all emails to HM_ContactInfo (v2.1)
      if (workEmail) contactInfoToAdd.push([key, 'Work Email', workEmail, domain, 'Lusha', runId, '']);
      if (directEmail) contactInfoToAdd.push([key, 'Direct Email', directEmail, domain, 'Lusha', runId, '']);
      if (addEmail1) contactInfoToAdd.push([key, 'Additional Email', addEmail1, domain, 'Lusha', runId, '']);
      if (addEmail2) contactInfoToAdd.push([key, 'Additional Email', addEmail2, domain, 'Lusha', runId, '']);

      // Append all phones to HM_ContactInfo (v2.1)
      if (phone1) {
        const channelType = phone1Type.includes('mobile') ? 'Mobile Phone' :
                            phone1Type.includes('direct') ? 'Direct Phone' : 'Office Phone';
        contactInfoToAdd.push([key, channelType, phone1, domain, 'Lusha', runId, '']);
      }

      if (phone2) {
        const channelType = phone2Type.includes('mobile') ? 'Mobile Phone' :
                            phone2Type.includes('direct') ? 'Direct Phone' : 'Office Phone';
        contactInfoToAdd.push([key, channelType, phone2, domain, 'Lusha', runId, '']);
      }

      // Prepare Company row (A-L: Domain, Name, URL, LinkedIn, blank ICP, City, State, Country, Industry, SubIndustry, Size, Revenue)
      // Only add if domain doesn't exist and domain is valid
      if (domain && !coDomainSet.has(domain)) {
        const companyUrl = String(row[cols.companyWebsite] || '').trim();
        const companyLinkedIn = String(row[cols.companyLinkedIn] || '').trim();
        const city = String(row[cols.companyCity] || '').trim();
        const state = String(row[cols.companyState] || '').trim();
        const country = String(row[cols.companyCountry] || '').trim();
        const industry = String(row[cols.industry] || '').trim();
        const subIndustry = String(row[cols.subIndustry] || '').trim();
        const sizeRaw = String(row[cols.companySize] || '').trim();
        const size = "'" + fixDateConvertedSize_(sizeRaw); // Fix date conversion + force text
        const revenue = String(row[cols.companyRevenue] || '').trim();
      const formattedNow = Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy');

        coToAdd.push([
          domain,           // 0 = A: Company Domain (PK)
          companyName,      // 1 = B: Company
          '',               // 2 = C: Company Description (Lusha Contact doesn't have)
          '',               // 3 = D: Company_Year_Founded (Lusha Contact doesn't have)
          '',               // 4 = E: IPO_Date (Lusha Contact doesn't have)
          companyUrl,       // 5 = F: Company URL
          companyLinkedIn,  // 6 = G: Company LinkedIn URL
          '',               // 7 = H: Company ICP Total (formula from ICP_Score)
          city,             // 8 = I: HQ City
          '',               // 9 = J: Region (formula from CountyRegion_Lookup)
          state,            // 10 = K: HQ State
          country,          // 11 = L: HQ Country
          '',               // 12 = M: Industry (formula from Industry_Normalization)
          '',               // 13 = N: Sub-Industry (formula from Industry_Normalization)
          '',               // 14 = O: SIC (Lusha Contact doesn't have)
          '',               // 15 = P: NAIC (Lusha Contact doesn't have)
          '',               // 16 = Q: Specialties (Lusha Contact doesn't have)
          '',               // 17 = R: CompanySizeNorm (formula from Size_Revenue_Normalization)
          '',               // 18 = S: CompanyRevenueNorm (formula from Size_Revenue_Normalization)
          '',               // 19 = T: Last Funding Type (Lusha Contact doesn't have)
          '',               // 20 = U: Last Funding Date (Lusha Contact doesn't have)
          '',               // 21 = V: Last Funding Amount (Lusha Contact doesn't have)
          '',               // 22 = W: Number of Funding Rounds (Lusha Contact doesn't have)
          '',               // 23 = X: Total Funding Amount (Lusha Contact doesn't have)
          '',               // 24 = Y: Growth Stage (formula-driven)
          '',               // 25 = Z: Months_Since_Funding (formula-driven)
          '',               // 26 = AA: Ownership (formula from Ownership_Normalization)
          'Lusha ' + Utilities.formatDate(new Date(), CONFIG.timezone, 'MM/dd/yyyy HH:mm') // 27 = AB: Last_Updated
        ]);

        coDomainSet.add(domain); // Track in current session

        // Log industry data for normalization
        if (industry) {
          industriesToLog.push({
            domain: domain,
            primaryIndustry: industry,
            subIndustry: subIndustry
          });
        }

        // Log size/revenue data for normalization
        if (size || revenue) {
          sizeRevenueToLog.push({
            domain: domain,
            companySize: size,
            companyRevenue: revenue
          });
        }
      }

      // Mark row as processed
      opsData[i][0] = runId;
      opsData[i][1] = 'Lusha';
      opsData[i][2] = 'Yes';
      opsData[i][3] = '';
      opsData[i][4] = '';
      processedCount++;

    } catch (rowError) {
      // Log row-level error
      opsData[i][0] = runId;
      opsData[i][1] = 'Lusha';
      opsData[i][2] = 'Yes';
      opsData[i][3] = 'YES';
      opsData[i][4] = rowError.toString().substring(0, 100); // Truncate error message
      errorCount++;

      Logger.log(`Error processing Lusha row ${i+2}: ${rowError.toString()}`);
    }
  }

  // Batch write operations status back to Lusha_Inserts
  opsRange.setValues(opsData);

  // Append new HM records
  let hmAddedCount = 0;
  if (hmToAdd.length > 0) {
    const hmStartRow = getFirstEmptyRowA_(hm);
    ensureSheetHasRows_(hm, hmStartRow + hmToAdd.length - 1);
    hm.getRange(hmStartRow, 1, hmToAdd.length, 14).setValues(hmToAdd);
    hmAddedCount = hmToAdd.length;
    Logger.log(`✓ Added ${hmAddedCount} new records to HM_Person_Master`);
  }

  // Upsert stale HM records (v2.2)
  let hmUpdatedCount = 0;
  if (hmToUpdate.length > 0) {
    for (const update of hmToUpdate) {
      // Write Company_Domain (col F) if currently blank
      if (update.domain && !hmRowToDomain.get(update.row)) {
        hm.getRange(update.row, 6, 1, 1).setValues([[update.domain]]);
      }
      // Update Title (D) and Company (E)
      hm.getRange(update.row, 4, 1, 2).setValues([[update.title, update.company]]);
      // Update Primary_Email (G) and Primary_Phone (H) — only if Lusha has data
      if (update.email || update.phone) {
        hm.getRange(update.row, 7, 1, 2).setValues([[update.email || '', update.phone || '']]);
      }
      // Update Last_Update_Source (M) and Last_Update_Date (N)
      hm.getRange(update.row, 13, 1, 2).setValues([['Lusha', runId]]);
    }
    hmUpdatedCount = hmToUpdate.length;
    Logger.log(`✓ Updated ${hmUpdatedCount} stale records in HM_Person_Master (>${LUSHA_UPSERT_STALE_DAYS} days old)`);
  }

  // Append new Company records
  let coAddedCount = 0;
  if (coToAdd.length > 0) {
    const coStartRow = getFirstEmptyRowA_(co);
    ensureSheetHasRows_(co, coStartRow + coToAdd.length - 1);
    co.getRange(coStartRow, 1, coToAdd.length, 28).setValues(coToAdd);
    coAddedCount = coToAdd.length;
    Logger.log(`✓ Added ${coAddedCount} new records to Company_Master`);
  }

  // Append contact info to HM_ContactInfo (v2.1)
  let contactInfoAddedCount = 0;
  if (contactInfoToAdd.length > 0) {
    try {
      contactInfoAddedCount = appendToContactInfo_(contactInfoToAdd);
      Logger.log(`✓ Added ${contactInfoAddedCount} contact channels to HM_ContactInfo`);
    } catch (e) {
      Logger.log(`Warning: Failed to append to HM_ContactInfo: ${e.toString()}`);
    }
  }

  // Auto-populate BD_Contacts with new HM keys (Bug #1 fix)
  if (hmAddedCount > 0) {
    try {
      Utilities.sleep(2000); // Wait 2 seconds for Sheets service to recover
      const newKeys = hmToAdd.map(row => row[0]); // Extract composite keys
      addKeysToBDContacts_(newKeys);
      Logger.log(`✓ Auto-seeded ${newKeys.length} keys to BD_Contacts`);
    } catch (e) {
      Logger.log(`Warning: Failed to auto-seed BD_Contacts: ${e.toString()}`);
    }
  }

  // Log industry data to normalization table (Bug #8, #9 fix)
  if (industriesToLog.length > 0) {
    try {
      Utilities.sleep(2000); // Wait 2 seconds for Sheets service to recover
      logIndustryNormalization_(industriesToLog, 'Lusha');
    } catch (e) {
      Logger.log(`Warning: Failed to log industry normalization: ${e.toString()}`);
    }
  }

  // Log size/revenue data to normalization table
  if (sizeRevenueToLog.length > 0) {
    try {
      Utilities.sleep(2000); // Wait 2 seconds for Sheets service to recover
      logSizeRevenueNormalization_(sizeRevenueToLog, 'Lusha');
    } catch (e) {
      Logger.log(`Warning: Failed to log size/revenue normalization: ${e.toString()}`);
    }
  }

  // Log operation summary
  persistRunLog_('LushaImport', {
    processed: processedCount,
    hmAdded: hmAddedCount,
    hmUpdated: hmUpdatedCount,
    coAdded: coAddedCount,
    errors: errorCount,
    runId: runId
  });

  // --- PIPELINE HOOKS (v3.0 Enrichment Blitz) ---
  // Backfill contact info from HM_ContactInfo → HM_Person_Master
  if (hmAddedCount > 0 || hmToUpdate.length > 0) {
    try {
      const allKeys = hmToAdd.map(row => row[0]).concat(hmToUpdate.map(u => u.key));
      backfillContactInfoForKeys_(allKeys);
      Logger.log(`✓ Backfilled contact info for ${allKeys.length} keys`);
    } catch (e) {
      Logger.log(`Warning: Failed to backfill contact info: ${e.toString()}`);
    }
  }

  // Enrichment chain removed from auto-trigger (2026-02-16 audit)
  // Lusha provides clean data — Gemini enrichment no longer needed on import
  // Run manually from menu if needed: ICP Tools > Run Enrichment Chain

  return {
    processed: processedCount,
    hmAdded: hmAddedCount,
    coAdded: coAddedCount,
    errors: errorCount
  };
}
