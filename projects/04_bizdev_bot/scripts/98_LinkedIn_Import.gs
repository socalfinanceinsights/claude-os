/**
 * BD TRACKER - LINKEDIN CONNECTIONS IMPORT
 * Version: 1.4.0
 *
 * CONTAINS:
 * - Import LinkedIn 1st degree connections CSV
 * - Title filtering: Manager+ level only (conservative)
 * - Upsert logic: Add new contacts, update existing (Title + Company only)
 * - Job change tracking: Logs Title/Company changes to HM_Job_Change_Log
 * - Populates HM_Person_Master (A-J with contact info)
 * - Populates HM_ContactInfo (emails if available)
 * - Updates HM_Signals_Master column G (1st-Degree = Yes)
 * - Auto-seeds BD_Contacts and HM_Signals_Master
 *
 * SOURCE FILE: 1st degree LI connections Macro.xlsm - 1st degree connections June 2025.csv
 * TOTAL RECORDS: 5,562 LinkedIn connections
 * EXPECTED AFTER FILTERING: ~1,500-2,500 (Manager+ level)
 *
 * DEPENDENCIES: 00_Brain_Config.gs, 01_Identity_Seeding.gs
 *
 * CHANGELOG v1.3.0:
 * - Added upsert logic for existing contacts (quarterly refresh support)
 * - Updates Column D (Title) and Column E (Company) for existing contacts
 * - Optimized batch updates for 100+ records
 */

/** ==========================================================================
 *  MAIN IMPORT FUNCTION
 *  ========================================================================== */

/**
 * TEST FUNCTION - Run from Script Editor
 * No UI dialogs, just logs results to console
 */
function TEST_ImportLinkedIn() {
  try {
    Logger.log('Starting LinkedIn import test...');
    const result = processLinkedInCSV_();

    Logger.log('✅ LinkedIn Import Complete:');
    Logger.log(`HM Added: ${result.hmAdded}`);
    Logger.log(`HM Updated: ${result.hmUpdated}`);
    Logger.log(`Contact Channels: ${result.contactInfoAdded}`);
    Logger.log(`Signals Updated: ${result.signalsUpdated}`);
    Logger.log(`BD Seeded: ${result.bdSeeded}`);
    Logger.log(`Filtered: ${result.filtered} (non-Manager+ titles)`);
    Logger.log(`Errors: ${result.errors}`);

    return result;
  } catch (e) {
    Logger.log(`ERROR: ${e.message}`);
    Logger.log(e.stack);
    throw e;
  }
}

/**
 * Import LinkedIn Connections CSV to Master Tables
 * USER-FACING FUNCTION (run from menu or script editor)
 *
 * Process:
 * 1. Read LinkedIn CSV from temp sheet
 * 2. Extract composite keys from LinkedIn URLs
 * 3. Insert to HM_Person_Master (A-J with email if present)
 * 4. Append to HM_ContactInfo (emails only if populated)
 * 5. Append to HM_Signals_Master (LinkedIn 1st degree connection signal)
 * 6. Auto-seed BD_Contacts
 */
function RunOnce_ImportLinkedInCSV() {
  try {
    const ss = getSpreadsheet_();
    const ui = SpreadsheetApp.getUi();

    // Confirmation dialog
    const response = ui.alert(
      'Import LinkedIn Connections?',
      'This will import LinkedIn 1st degree connections.\\n\\n' +
      'Data will be added to:\\n' +
      '- HM_Person_Master (identity + contact info)\\n' +
      '- HM_ContactInfo (emails if available)\\n' +
      '- HM_Signals_Master (connection tracking)\\n' +
      '- BD_Contacts (auto-seeded)\\n\\n' +
      'Proceed?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      ss.toast('Import cancelled by user.', 'Cancelled');
      return;
    }

    // Execute import
    const result = processLinkedInCSV_();

    // Show results
    ss.toast(
      `✅ LinkedIn Import Complete:\\n` +
      `HM Added: ${result.hmAdded}\\n` +
      `HM Updated: ${result.hmUpdated}\\n` +
      `Contact Channels: ${result.contactInfoAdded}\\n` +
      `Signals Updated: ${result.signalsUpdated}\\n` +
      `BD Seeded: ${result.bdSeeded}\\n` +
      `Filtered: ${result.filtered} (non-Manager+ titles)\\n` +
      `Errors: ${result.errors}`,
      'Import Complete',
      10
    );

  } catch (e) {
    logError_('LINKEDIN_IMPORT', 'IMPORT_ERROR', 'RunOnce_ImportLinkedInCSV', e.toString());
    SpreadsheetApp.getUi().alert(`Error during LinkedIn import: ${e.message}`);
  }
}

/** ==========================================================================
 *  CORE PROCESSING LOGIC
 *  ========================================================================== */

/**
 * Process LinkedIn CSV and populate master tables
 * Reads from temp sheet, filters to Manager+ titles, and inserts to masters
 *
 * FILTERING: Conservative Manager+ only
 * - Includes: Manager, Director, VP, C-Suite, Controller, Partner, Principal, Head of
 * - Excludes: Staff, Analyst, Associate, Consultant, Advisor, blank titles
 *
 * @returns {Object} - {hmAdded, contactInfoAdded, signalsAdded, bdSeeded, filtered, errors}
 */
function processLinkedInCSV_() {
  const ss = getSpreadsheet_();

  // Get master sheets
  const hm = ss.getSheetByName(CONFIG.sheetHM);
  if (!hm) throw new Error(`Sheet "${CONFIG.sheetHM}" not found`);

  // Read existing HM keys for deduplication AND track row positions for updates
  // Also read Title (D) and Company (E) to detect job changes
  const hmLastRow = hm.getLastRow();
  const existingHMData = hmLastRow > 1
    ? hm.getRange(2, 1, hmLastRow - 1, 5).getValues() // Read A-E
    : [];

  const hmKeySet = new Set();
  const hmKeyToRow = new Map(); // Track key → row number for updates
  const hmKeyToData = new Map(); // Track key → {title, company} for change detection

  existingHMData.forEach((row, index) => {
    const key = String(row[0]).trim();
    if (key) {
      hmKeySet.add(key);
      hmKeyToRow.set(key, index + 2); // +2 for header and 0-index
      hmKeyToData.set(key, {
        title: String(row[3] || '').trim(),    // Column D
        company: String(row[4] || '').trim()   // Column E
      });
    }
  });

  // Read LinkedIn CSV from temp sheet
  const csvData = readLinkedInCSVFromSheet_();

  // Accumulators
  const hmToAdd = [];
  const hmToUpdate = []; // Track records to update (Title and Company only)
  const jobChangesToLog = []; // Track job changes (Title/Company changes)
  const contactInfoToAdd = [];
  const signalsToAdd = [];
  let errorCount = 0;
  let filteredCount = 0;

  const runId = isoNow_();
  const source = 'LinkedIn_Connections';

  // Process each row
  for (let i = 0; i < csvData.length; i++) {
    try {
      const row = csvData[i];

      // Extract fields (CSV columns)
      const firstName = String(row[0] || '').trim();
      const lastName = String(row[1] || '').trim();
      const linkedInUrl = String(row[2] || '').trim();
      const email = String(row[3] || '').trim();
      const company = String(row[4] || '').trim();
      const position = String(row[5] || '').trim();
      const connectedOn = row[6]; // Date object or string

      // Skip if missing critical data (LinkedIn URL is required)
      if (!linkedInUrl) {
        errorCount++;
        continue;
      }

      // FILTER: Only import Manager+ level titles
      if (!isManagerOrAbove_(position)) {
        filteredCount++;
        continue;
      }

      // Clean LinkedIn URL and generate composite key
      const linkedIn = cleanLinkedInUrl_(linkedInUrl);
      const key = generatePersonKey_(linkedIn, firstName, lastName, '');

      // Prepare HM row (A-J) - Add if new, Update if exists
      if (!hmKeySet.has(key)) {
        // ADD NEW RECORD
        const fullName = `${firstName} ${lastName}`.trim();

        hmToAdd.push([
          key,                    // A: Composite Key
          linkedIn,               // B: LinkedIn URL
          fullName,               // C: HM Name
          position,               // D: HM Title
          company,                // E: Company
          '',                     // F: Company Domain (not in LinkedIn export)
          email || '',            // G: Primary_Email (if present)
          '',                     // H: Primary_Phone (not in LinkedIn export)
          source,                 // I: Original_Source (always LinkedIn_Connections)
          runId,                  // J: Original_Source_Date
          '',                     // K: Active Campaign ID (skip)
          '',                     // L: Dedup_Status (skip)
          source,                 // M: Last_Update_Source
          runId                   // N: Last_Update_Date
        ]);
        hmKeySet.add(key);

        // Append to HM_ContactInfo (only if email present)
        if (email) {
          contactInfoToAdd.push([
            key,
            'Personal Email',       // LinkedIn emails are personal
            email,
            '',                     // No company domain available
            source,
            runId,
            'LinkedIn 1st degree connection'
          ]);
        }

      } else {
        // UPDATE EXISTING RECORD
        // Only update Title (D) and Company (E) - Name rarely changes
        const rowNum = hmKeyToRow.get(key);
        const oldData = hmKeyToData.get(key);

        if (rowNum && oldData) {
          // Detect job changes (Title or Company changed)
          const titleChanged = oldData.title !== position;
          const companyChanged = oldData.company !== company;

          if (titleChanged || companyChanged) {
            jobChangesToLog.push({
              key: key,
              oldTitle: oldData.title,
              newTitle: position,
              oldCompany: oldData.company,
              newCompany: company,
              changeDate: runId,
              source: source
            });
          }

          hmToUpdate.push({
            row: rowNum,
            title: position,     // Column D: HM Title
            company: company     // Column E: Company
          });
        }
      }

      // Track ALL keys for HM_Signals_Master update (column G: 1st-Degree)
      // This includes both new imports AND existing records that match LinkedIn connections
      signalsToAdd.push(key);

    } catch (rowError) {
      errorCount++;
      Logger.log(`Error processing LinkedIn row ${i+1}: ${rowError.toString()}`);
    }
  }

  return writeLinkedInBatch_(hm, hmLastRow, hmToAdd, hmToUpdate, jobChangesToLog, contactInfoToAdd, signalsToAdd, filteredCount, errorCount);
}

// Batch write, pipeline hooks moved to 98b_LinkedIn_Write.gs: writeLinkedInBatch_
// Support functions moved to 98a_LinkedIn_Helpers.gs:
// readLinkedInCSVFromSheet_, readLinkedInCSVFromDrive_, isManagerOrAbove_,
// updateLinkedInSignals_, appendToJobChangeLog_, addLinkedInImportToMenu_
