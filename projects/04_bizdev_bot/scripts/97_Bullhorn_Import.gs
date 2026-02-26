/**
 * BD TRACKER - BULLHORN INTERACTION NOTES IMPORT
 * Version: 2.1.1 (Fixed duplicate key bug + NO_LI fallback pattern)
 *
 * CONTAINS:
 * - Import Bullhorn interaction notes (2018-2026)
 * - Smart name matching to existing HM_Person_Master (LinkedIn records)
 * - Creates orphaned records for unmatched names
 * - Populates HM_Interaction_History (full note audit trail)
 * - Populates HM_Orphaned_Records (for manual review)
 *
 * NOTE: HM_Signals_Master is NO LONGER written by this script.
 * It is now a formula-driven person summary table that aggregates from HM_Interaction_History.
 *
 * FIXES in v2.1.1:
 * - Fixed generateSimpleKey_ to follow NO_LI-{first}-{last} pattern (not just name without spaces)
 * - Added composite key collision detection to prevent duplicate keys in HM_Person_Master
 *
 * SOURCE FILE: Client Download from BH 1.28.26.csv
 * RECORDS: 3,430 interaction notes
 *
 * WORKFLOW:
 * 1. Import LinkedIn connections FIRST (creates base HM_Person_Master)
 * 2. Run this Bullhorn import (matches by name, creates orphans for non-matches)
 * 3. Use 96_Orphan_Reconciliation.gs to find potential matches for orphans
 * 4. Manually review and merge orphans
 *
 * DEPENDENCIES: 00_Brain_Config.gs, 01_Identity_Seeding.gs
 */

/** ==========================================================================
 *  MAIN IMPORT FUNCTION
 *  ========================================================================== */

/**
 * TEST FUNCTION - Import Bullhorn without UI prompts
 * Run this from Apps Script editor for testing
 * Logs results to execution log instead of showing alerts
 */
function TEST_ImportBullhorn() {
  try {
    Logger.log('=== BULLHORN IMPORT TEST ===');
    Logger.log('Starting import...');

    // Execute import
    const result = processBullhornCSV_();

    // Populate orphaned records tab for review
    if (result.orphanedKeys.length > 0) {
      populateOrphanedRecordsTab_(result.orphanedKeys);
    }

    // Log results
    Logger.log('=== IMPORT COMPLETE ===');
    Logger.log(`✅ Names Matched: ${result.matchedCount}`);
    Logger.log(`✅ Orphaned (No Match): ${result.orphanedCount}`);
    Logger.log(`✅ Interactions Stored: ${result.interactionsAdded}`);
    Logger.log(`✅ Errors: ${result.errors}`);

    if (result.orphanedCount > 0) {
      Logger.log(`\n⚠️ ${result.orphanedCount} names could not be matched to existing LinkedIn records.`);
      Logger.log('These have been added to HM_Orphaned_Records tab.');
      Logger.log('NEXT STEP: Use 96_Orphan_Reconciliation.gs to find matches.');
    }

    return result;

  } catch (e) {
    Logger.log(`❌ ERROR: ${e.toString()}`);
    logError_('BULLHORN_IMPORT', 'IMPORT_ERROR', 'TEST_ImportBullhorn', e.toString());
    throw e;
  }
}

/**
 * Import Bullhorn Interaction Notes to Master Tables
 * USER-FACING FUNCTION (run from menu or script editor)
 *
 * Process:
 * 1. Read Bullhorn CSV from temp sheet
 * 2. Match person names to existing HM_Person_Master (from LinkedIn import)
 * 3. If match found → Link to existing record (don't create duplicate)
 * 4. If no match → Create orphaned record (no LinkedIn URL)
 * 5. Store full notes in HM_Interaction_History
 * 6. Populate HM_Orphaned_Records for manual review
 */
function RunOnce_ImportBullhornCSV() {
  try {
    const ss = getSpreadsheet_();
    const ui = SpreadsheetApp.getUi();

    // Confirmation dialog
    const response = ui.alert(
      'Import Bullhorn Interaction Notes?',
      'This will import 3,430 interaction notes from Bullhorn (2018-2026).\\n\\n' +
      'IMPORTANT: Make sure you\'ve imported LinkedIn connections FIRST.\\n\\n' +
      'Data will be added to:\\n' +
      '- HM_Interaction_History (full notes)\\n' +
      '- HM_Orphaned_Records (unmatched names for review)\\n\\n' +
      'This may take 2-3 minutes.\\n\\n' +
      'Proceed?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      ss.toast('Import cancelled by user.', 'Cancelled');
      return;
    }

    // Execute import
    const result = processBullhornCSV_();

    // Populate orphaned records tab for review
    if (result.orphanedKeys.length > 0) {
      populateOrphanedRecordsTab_(result.orphanedKeys);
    }

    // Show results
    ss.toast(
      `✅ Bullhorn Import Complete:\\n` +
      `Names Matched: ${result.matchedCount}\\n` +
      `Orphaned (No Match): ${result.orphanedCount}\\n` +
      `Interactions Stored: ${result.interactionsAdded}\\n` +
      `Errors: ${result.errors}`,
      'Import Complete',
      15
    );

    // Show orphan guidance if any
    if (result.orphanedCount > 0) {
      ui.alert(
        'Orphaned Records Detected',
        `${result.orphanedCount} names could not be matched to existing LinkedIn records.\\n\\n` +
        'These have been added to HM_Orphaned_Records tab.\\n\\n' +
        'NEXT STEP: Use menu "🔍 Find Potential Matches for Orphans" to get match suggestions.\\n\\n' +
        'Then manually review and merge as needed.',
        ui.ButtonSet.OK
      );
    }

  } catch (e) {
    logError_('BULLHORN_IMPORT', 'IMPORT_ERROR', 'RunOnce_ImportBullhornCSV', e.toString());
    SpreadsheetApp.getUi().alert(`Error during Bullhorn import: ${e.message}`);
  }
}

/** ==========================================================================
 *  CORE PROCESSING LOGIC
 *  ========================================================================== */

/**
 * Process Bullhorn CSV and populate master tables
 * Reads from temp sheet, matches names, stores interactions
 *
 * @returns {Object} - {matchedCount, orphanedCount, orphanedKeys, interactionsAdded, errors}
 */
function processBullhornCSV_() {
  const ss = getSpreadsheet_();

  // Get master sheets
  const hm = ss.getSheetByName(CONFIG.sheetHM);
  if (!hm) throw new Error(`Sheet "${CONFIG.sheetHM}" not found`);

  // Build name lookup map from existing HM_Person_Master
  const nameLookup = buildNameLookupMap_(hm);
  Logger.log(`Built name lookup with ${nameLookup.size} existing records`);

  // Build existing keys set for collision detection (Bug Fix v2.1.1)
  const existingKeys = buildExistingKeysSet_(hm);
  Logger.log(`Built existing keys set with ${existingKeys.size} keys`);

  // Read Bullhorn CSV from temp sheet
  const csvData = readBullhornCSVFromSheet_();

  // Accumulators
  const hmToAdd = []; // New orphaned records
  const interactionsToAdd = [];
  const orphanedKeys = []; // Track orphaned composite keys for review
  let matchedCount = 0;
  let orphanedCount = 0;
  let errorCount = 0;

  const runId = isoNow_();
  const source = 'Bullhorn_Import';

  // Process each note
  for (let i = 0; i < csvData.length; i++) {
    try {
      const row = csvData[i];

      // Extract fields
      const department = String(row[0] || '').trim();
      const noteAuthor = String(row[1] || '').trim();
      const dateNoteAdded = row[2]; // Date
      const type = String(row[3] || '').trim();
      const noteAction = String(row[4] || '').trim();
      const aboutName = String(row[5] || '').trim();
      const status = String(row[6] || '').trim();
      const noteBody = String(row[7] || '').trim();

      // Skip if missing critical data
      if (!aboutName || !dateNoteAdded) {
        errorCount++;
        continue;
      }

      // Match to existing HM_Person_Master by name
      const normalizedName = normalizeName_(aboutName);
      let compositeKey = nameLookup.get(normalizedName);

      if (compositeKey) {
        // MATCH FOUND! Use existing composite key (from LinkedIn)
        matchedCount++;
      } else {
        // NO MATCH - Create orphaned record (no LinkedIn URL)
        // Generate unique key with collision detection (Bug Fix v2.1.1)
        compositeKey = generateSimpleKey_(normalizedName, existingKeys);

        // Check if we already created this orphan in this import batch
        if (!nameLookup.has(normalizedName)) {
          hmToAdd.push([
            compositeKey,        // A: Composite Key
            '',                  // B: LinkedIn URL (blank - orphaned)
            aboutName,           // C: HM Name
            '',                  // D: HM Title (blank)
            '',                  // E: Company (blank)
            '',                  // F: Company Domain (blank)
            '',                  // G: Primary_Email (blank)
            '',                  // H: Primary_Phone (blank)
            source,              // I: Original_Source
            runId,               // J: Original_Source_Date
            '',                  // K: Active Campaign ID (skip)
            '',                  // L: Dedup_Status (skip)
            source,              // M: Last_Update_Source
            runId                // N: Last_Update_Date
          ]);

          // Add to lookup to avoid duplicates within this import
          nameLookup.set(normalizedName, compositeKey);
          existingKeys.add(compositeKey); // Add to collision detection set
          orphanedKeys.push(compositeKey);
          orphanedCount++;
        }
      }

      // Add to HM_Interaction_History (full note)
      interactionsToAdd.push([
        compositeKey,
        dateNoteAdded,
        type,
        noteAction,
        status,
        noteBody,
        noteAuthor,
        department,
        source
      ]);

    } catch (rowError) {
      errorCount++;
      Logger.log(`Error processing Bullhorn row ${i+1}: ${rowError.toString()}`);
    }
  }

  // Batch write to HM_Person_Master (orphaned records only)
  let hmAddedCount = 0;
  if (hmToAdd.length > 0) {
    const hmStartRow = getFirstEmptyRowA_(hm);
    ensureSheetHasRows_(hm, hmStartRow + hmToAdd.length - 1);
    hm.getRange(hmStartRow, 1, hmToAdd.length, 14).setValues(hmToAdd);
    hmAddedCount = hmToAdd.length;
    Logger.log(`✓ Added ${hmAddedCount} orphaned records to HM_Person_Master`);
  }

  // Batch write to HM_Interaction_History
  let interactionsAddedCount = 0;
  if (interactionsToAdd.length > 0) {
    interactionsAddedCount = appendToInteractionHistory_(interactionsToAdd);
    Logger.log(`✓ Added ${interactionsAddedCount} interaction notes to HM_Interaction_History`);
  }

  // Log operation summary
  persistRunLog_('BullhornImport', {
    matchedCount: matchedCount,
    orphanedCount: orphanedCount,
    interactionsAdded: interactionsAddedCount,
    errors: errorCount,
    runId: runId,
    source: source
  });

  return {
    matchedCount: matchedCount,
    orphanedCount: orphanedCount,
    orphanedKeys: orphanedKeys,
    interactionsAdded: interactionsAddedCount,
    errors: errorCount
  };
}

// Support functions moved to 97a_Bullhorn_Helpers.gs:
// populateOrphanedRecordsTab_, readBullhornCSVFromSheet_,
// buildNameLookupMap_, buildExistingKeysSet_, generateSimpleKey_,
// appendToInteractionHistory_, formatDate_, addBullhornImportToMenu_
