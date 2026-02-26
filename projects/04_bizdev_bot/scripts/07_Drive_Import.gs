/**
 * BD TRACKER - DRIVE-BASED CSV IMPORT
 * Version: 1.1.0 (Split: engine moved to 07b)
 * @execution manual
 *
 * CONTAINS:
 * - Restore_Drive_Folder_IDs (setup function)
 * - Per-source import functions (LinkedIn, Lusha, LushaCompany, CrunchBase, Bullhorn)
 *
 * ARCHITECTURE:
 * User drops CSV into designated Drive folder → script reads & parses CSV →
 * validates headers → writes to existing helper tab → calls existing processor →
 * moves file to Processed folder → logs result
 *
 * DEPENDENCIES:
 * - 00_Brain_Config.gs (DRIVE_IMPORT config, CONFIG, LUSHA_CFG, etc.)
 * - 00d_CSV_Helpers.gs (CSV parsing, file movement)
 * - 02_Lusha_Import.gs, 03_Crunchbase_Import.gs, 04_Lusha_Company_Import.gs
 * - 97_Bullhorn_Import.gs, 98_LinkedIn_Import.gs
 * SEE ALSO: 07b_Drive_Import_Engine.gs (generic engine, status check)
 */

/** ==========================================================================
 *  SETUP: RESTORE DRIVE FOLDER IDS
 *  ========================================================================== */

/**
 * Restore known Drive folder IDs into ScriptProperties.
 * Run this after reverting to a backup copy of the spreadsheet,
 * which wipes ScriptProperties. Does NOT create any folders.
 */
function Restore_Drive_Folder_IDs() {
  const FOLDER_IDS = {
    'DRIVE_IMPORT_FOLDER_LINKEDIN':      'YOUR_LINKEDIN_IMPORT_FOLDER_ID',
    'DRIVE_IMPORT_FOLDER_LUSHA':         'YOUR_LUSHA_IMPORT_FOLDER_ID',
    'DRIVE_IMPORT_FOLDER_LUSHA_COMPANY': 'YOUR_LUSHA_COMPANY_IMPORT_FOLDER_ID',
    'DRIVE_IMPORT_FOLDER_CRUNCHBASE':    'YOUR_CRUNCHBASE_IMPORT_FOLDER_ID',
    'DRIVE_IMPORT_FOLDER_BULLHORN':      'YOUR_BULLHORN_IMPORT_FOLDER_ID',
    'DRIVE_IMPORT_PROCESSED_FOLDER':     'YOUR_PROCESSED_FOLDER_ID'
  };

  const props = PropertiesService.getScriptProperties();
  for (const key in FOLDER_IDS) {
    props.setProperty(key, FOLDER_IDS[key]);
    Logger.log(`  ✓ ${key}: ${FOLDER_IDS[key]}`);
  }
  Logger.log('✓ Drive folder IDs restored');

  try {
    SpreadsheetApp.getUi().alert(
      'Folder IDs Restored',
      'All 6 Drive import folder IDs have been written to ScriptProperties.\n\nNo folders were created.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) { /* headless run — no UI */ }
}

/** ==========================================================================
 *  PER-SOURCE IMPORT FUNCTIONS
 *  ========================================================================== */

/**
 * Import LinkedIn CSVs from Drive
 * @param {Object} [options] - {silent: boolean} suppress UI alerts when called from orchestrator
 * @returns {Object} - {source, filesProcessed, rowsProcessed}
 */
function Import_LinkedIn_From_Drive(options) {
  const sourceKey = 'linkedin';
  const sourceConfig = DRIVE_IMPORT.sources[sourceKey];

  return driveImportSource_(sourceKey, sourceConfig, function(helperSheet) {
    // LinkedIn processor: processLinkedInCSV_() reads from Import_LinkedIn tab
    // It has no UI dialog (internal function)
    SpreadsheetApp.flush();
    const result = processLinkedInCSV_();
    Logger.log(`  LinkedIn processor: ${result.hmAdded} added, ${result.hmUpdated} updated, ${result.filtered} filtered`);
    return result;
  }, options);
}

/**
 * Import Lusha Contact CSVs from Drive
 * @param {Object} [options] - {silent: boolean}
 * @returns {Object}
 */
function Import_Lusha_From_Drive(options) {
  const sourceKey = 'lusha';
  const sourceConfig = DRIVE_IMPORT.sources[sourceKey];

  return driveImportSource_(sourceKey, sourceConfig, function(helperSheet) {
    // Lusha processor reads from LushaContactInserts tab
    SpreadsheetApp.flush();
    Run_Lusha_ValidateAndProcess();
    return {};
  }, options);
}

/**
 * Import Lusha Company CSVs from Drive
 * @param {Object} [options] - {silent: boolean}
 * @returns {Object}
 */
function Import_LushaCompany_From_Drive(options) {
  const sourceKey = 'lushaCompany';
  const sourceConfig = DRIVE_IMPORT.sources[sourceKey];

  return driveImportSource_(sourceKey, sourceConfig, function(helperSheet) {
    // Lusha Company processor reads from LushaCompanyInserts tab
    SpreadsheetApp.flush();
    Run_LushaCompany_ValidateAndProcess();
    return {};
  }, options);
}

/**
 * Import CrunchBase CSVs from Drive
 * @param {Object} [options] - {silent: boolean}
 * @returns {Object}
 */
function Import_CrunchBase_From_Drive(options) {
  const sourceKey = 'crunchbase';
  const sourceConfig = DRIVE_IMPORT.sources[sourceKey];

  return driveImportSource_(sourceKey, sourceConfig, function(helperSheet) {
    // CrunchBase processor reads from Import CB tab
    SpreadsheetApp.flush();
    Run_Crunchbase_ValidateAndProcess();
    return {};
  }, options);
}

/**
 * Import Bullhorn CSVs from Drive
 * @param {Object} [options] - {silent: boolean}
 * @returns {Object}
 */
function Import_Bullhorn_From_Drive(options) {
  const sourceKey = 'bullhorn';
  const sourceConfig = DRIVE_IMPORT.sources[sourceKey];

  return driveImportSource_(sourceKey, sourceConfig, function(helperSheet) {
    // Bullhorn processor: processBullhornCSV_() reads from Import_Bullhorn tab
    // It has no UI dialog (internal function)
    SpreadsheetApp.flush();
    const result = processBullhornCSV_();

    // Populate orphaned records tab if any orphans found
    if (result.orphanedKeys && result.orphanedKeys.length > 0) {
      populateOrphanedRecordsTab_(result.orphanedKeys);
      Logger.log(`  Bullhorn: ${result.orphanedCount} orphaned records created`);
    }

    Logger.log(`  Bullhorn processor: ${result.matchedCount} matched, ${result.orphanedCount} orphaned, ${result.interactionsAdded} interactions`);
    return result;
  }, options);
}

// Generic import engine and status check moved to 07b_Drive_Import_Engine.gs
