/**
 * BD TRACKER - SMART IMPORT PROCESSORS
 * Version: 1.0.0 (Split from 06_Smart_Import_Setup.gs)
 * @execution manual
 *
 * CONTAINS:
 * - Per-source processor functions (LinkedIn, Lusha, LushaCompany, Bullhorn, CrunchBase, Generic)
 * - Called by routeImport_() in 06_Smart_Import_Setup.gs
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 * CALLED BY: 06_Smart_Import_Setup.gs (routeImport_)
 */

function processLinkedInImport_(headers, sourceSheet, targetSheet, lastRow, lastCol) {
  // Step 1: Copy data to Import_LinkedIn tab
  const data = sourceSheet.getRange(1, 1, lastRow, lastCol).getValues();
  targetSheet.clear();
  targetSheet.getRange(1, 1, lastRow, lastCol).setValues(data);
  Logger.log('  ✓ LinkedIn import copied to Import_LinkedIn');

  // Step 2: Run the actual LinkedIn import processor
  SpreadsheetApp.flush();
  RunOnce_ImportLinkedInCSV(); // Calls the main importer from 98_LinkedIn_Import.gs

  return { rowsProcessed: lastRow - 1, status: 'Imported to BD_Contacts & Company_Master' };
}

function processLushaContactImport_(headers, sourceSheet, targetSheet, lastRow, lastCol) {
  // Step 1: Copy data to LushaContactInserts tab (legacy tab is Import_HM)
  const ss = getSpreadsheet_();
  const importHMSheet = ss.getSheetByName('Import_HM');

  if (!importHMSheet) {
    throw new Error('Import_HM tab not found (required for Lusha Contact imports)');
  }

  const data = sourceSheet.getRange(1, 1, lastRow, lastCol).getValues();
  importHMSheet.clear();
  importHMSheet.getRange(1, 1, lastRow, lastCol).setValues(data);
  Logger.log('  ✓ Lusha Contact import copied to Import_HM');

  // Step 2: Run the actual Lusha Contact import processor
  SpreadsheetApp.flush();
  Run_Lusha_ValidateAndProcess(); // Calls the main importer from 02_Lusha_Import.gs

  return { rowsProcessed: lastRow - 1, status: 'Imported to BD_Contacts & Company_Master' };
}

function processLushaCompanyImport_(headers, sourceSheet, targetSheet, lastRow, lastCol) {
  // Step 1: Copy data to LushaCompanyInserts tab
  const data = sourceSheet.getRange(1, 1, lastRow, lastCol).getValues();
  targetSheet.clear();
  targetSheet.getRange(1, 1, lastRow, lastCol).setValues(data);
  Logger.log('  ✓ Lusha Company import copied to LushaCompanyInserts');

  // Step 2: Run the actual Lusha Company import processor
  SpreadsheetApp.flush();
  Run_LushaCompany_ValidateAndProcess(); // Calls the main importer from 04_Lusha_Company_Import.gs

  return { rowsProcessed: lastRow - 1, status: 'Imported to Company_Master' };
}

function processBullhornImport_(headers, sourceSheet, targetSheet, lastRow, lastCol) {
  // Bullhorn exports have 2 metadata rows before headers
  // Row 1-2: Metadata/report info (skip these)
  // Row 3: Column headers (Department, Note Author, Date Note Added, etc.)
  // Row 4+: Actual data rows

  // Check if we need to skip rows (row 3 has "Department" header)
  const row1 = sourceSheet.getRange(1, 1).getValue();
  const row3 = sourceSheet.getRange(3, 1).getValue();

  let startRow = 1;
  let dataRows = lastRow;

  // If row 3 contains "Department" (the actual header), skip rows 1-2
  if (row3 === 'Department' || row3.toString().includes('Department')) {
    startRow = 3;
    dataRows = lastRow - 2; // Exclude the 2 skipped rows from count
    Logger.log('  ✓ Detected Bullhorn metadata rows, skipping rows 1-2');
  }

  // Step 1: Copy from startRow onwards (headers + data)
  const data = sourceSheet.getRange(startRow, 1, dataRows, lastCol).getValues();
  targetSheet.clear(); // Clear target first
  targetSheet.getRange(1, 1, dataRows, lastCol).setValues(data);
  Logger.log(`  ✓ Bullhorn import copied to Import_Bullhorn (${dataRows} rows including header)`);

  // Step 2: Run the actual Bullhorn import processor
  SpreadsheetApp.flush();
  RunOnce_ImportBullhornCSV(); // Calls the main importer from 97_Bullhorn_Import.gs

  return { rowsProcessed: dataRows - 1, status: 'Imported to BD_Contacts & Company_Master' };
}

function processCrunchBaseImport_(headers, sourceSheet, targetSheet, lastRow, lastCol) {
  // Step 1: Copy data to Import CB tab
  const data = sourceSheet.getRange(1, 1, lastRow, lastCol).getValues();
  targetSheet.clear(); // Clear old data first
  targetSheet.getRange(1, 1, lastRow, lastCol).setValues(data);
  Logger.log('  ✓ CrunchBase import copied to Import CB');

  // Step 2: Run the actual Crunchbase import processor
  SpreadsheetApp.flush(); // Ensure data is written before processing
  Run_Crunchbase_ValidateAndProcess(); // Calls the main importer from 03_Crunchbase_Import.gs

  return { rowsProcessed: lastRow - 1, status: 'Imported to Company_Master' };
}

function processGenericContactImport_(headers, sourceSheet, targetSheet, lastRow, lastCol) {
  const data = sourceSheet.getRange(1, 1, lastRow, lastCol).getValues();
  targetSheet.getRange(1, 1, lastRow, lastCol).setValues(data);

  Logger.log('  ✓ Generic Contact import copied to Contact_Inserts');
  return { rowsProcessed: lastRow - 1, status: 'Copied to Contact_Inserts for processing' };
}

function processGenericCompanyImport_(headers, sourceSheet, targetSheet, lastRow, lastCol) {
  const data = sourceSheet.getRange(1, 1, lastRow, lastCol).getValues();
  targetSheet.getRange(1, 1, lastRow, lastCol).setValues(data);

  Logger.log('  ✓ Generic Company import copied to Company_Master');
  return { rowsProcessed: lastRow - 1, status: 'Copied to Company_Master for processing' };
}
