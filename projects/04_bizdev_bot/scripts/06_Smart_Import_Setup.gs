/**
 * BD TRACKER - SMART IMPORT SYSTEM
 * Version: 1.1.0 (Split: processors moved to 06a)
 * @execution manual
 *
 * CONTAINS:
 * - IMPORT_Staging tab setup (UI + validation)
 * - Process_Smart_Import (main orchestrator)
 * - routeImport_ (routing logic)
 *
 * USAGE:
 * 1. Run Setup_Import_Staging_Tab() once to create the tab structure
 * 2. Paste CSV data starting at cell A1 (headers in row 1, data in row 2+)
 * 3. Select Import Type from dropdown in cell Z1
 * 4. Click "Process Import" button or run Process_Smart_Import() from menu
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 * SEE ALSO: 06a_Smart_Import_Processors.gs (per-source processor functions)
 */

/**
 * SETUP FUNCTION
 * Creates IMPORT_Staging tab with control panel and instructions
 * Run this ONCE to set up the smart import infrastructure
 */
function Setup_Import_Staging_Tab() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();

  const response = ui.alert(
    'Create Smart Import Staging Tab',
    'This will create a new IMPORT_Staging tab with:\n\n' +
    '✓ Clear paste instructions\n' +
    '✓ Import type selector\n' +
    '✓ Automatic header detection\n' +
    '✓ Routing to appropriate processor\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    Logger.log('User cancelled smart import setup');
    return;
  }

  try {
    // Check if tab already exists
    let importSheet = ss.getSheetByName('IMPORT_Staging');
    if (importSheet) {
      const overwrite = ui.alert(
        'Tab Already Exists',
        'IMPORT_Staging tab already exists. Overwrite?',
        ui.ButtonSet.YES_NO
      );
      if (overwrite !== ui.Button.YES) {
        Logger.log('User cancelled overwrite');
        return;
      }
      ss.deleteSheet(importSheet);
    }

    // Create new sheet
    importSheet = ss.insertSheet('IMPORT_Staging');

    // Set up visual layout
    setupImportStaging_UI_(importSheet);

    // Set up data validation for Import Type dropdown
    setupImportStaging_Validation_(importSheet);

    // Move to second position (after BD_Contacts)
    ss.setActiveSheet(importSheet);
    ss.moveActiveSheet(2);

    ui.alert(
      'Smart Import Setup Complete!',
      'IMPORT_Staging tab is ready.\n\n' +
      'HOW TO USE:\n' +
      '1. Click cell A1\n' +
      '2. Paste your CSV data (Ctrl+V)\n' +
      '3. Select Import Type from dropdown (cell Z1)\n' +
      '4. Run "Process Import" from BD Tracker menu\n\n' +
      'The system will auto-detect headers and route to the correct processor.',
      ui.ButtonSet.OK
    );

    Logger.log('✓ IMPORT_Staging tab created successfully');

  } catch (error) {
    Logger.log('ERROR in Setup_Import_Staging_Tab: ' + error.toString());
    ui.alert('Setup Error', 'Error: ' + error.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Setup the visual UI for IMPORT_Staging tab
 * Private helper function
 */
function setupImportStaging_UI_(sheet) {
  // Clear the sheet
  sheet.clear();

  // Ensure sheet has enough columns (need at least 27 columns for Z-AA)
  const currentColumns = sheet.getMaxColumns();
  if (currentColumns < 27) {
    sheet.insertColumnsAfter(currentColumns, 27 - currentColumns);
  }

  // Set column widths
  sheet.setColumnWidth(1, 200); // Column A (wider for data)
  for (let i = 2; i <= 25; i++) {
    sheet.setColumnWidth(i, 150); // Columns B-Y
  }
  sheet.setColumnWidth(26, 200); // Column Z (control panel label)
  sheet.setColumnWidth(27, 250); // Column AA (control panel values)

  // Freeze first row (for headers)
  sheet.setFrozenRows(1);

  // === CONTROL PANEL (Columns Z-AA) ===
  const controlPanelStart = 26; // Column Z

  // Header styling for control panel
  const controlHeaderRange = sheet.getRange(1, controlPanelStart, 1, 2);
  controlHeaderRange.setBackground('#4A86E8');
  controlHeaderRange.setFontColor('#FFFFFF');
  controlHeaderRange.setFontWeight('bold');
  controlHeaderRange.setHorizontalAlignment('center');
  controlHeaderRange.setVerticalAlignment('middle');

  // Control panel labels and values
  const controlPanel = [
    ['IMPORT CONTROL PANEL', ''],
    ['', ''],
    ['Import Type:', '[SELECT FROM DROPDOWN]'],
    ['Import Status:', 'Ready'],
    ['Import Date:', ''],
    ['Row Count:', '0'],
    ['Column Count:', '0'],
    ['', ''],
    ['INSTRUCTIONS:', ''],
    ['1. Click cell A1', ''],
    ['2. Paste CSV (Ctrl+V)', ''],
    ['3. Select Import Type (Z3)', ''],
    ['4. Run "Process Import"', ''],
    ['   from menu', '']
  ];

  sheet.getRange(1, controlPanelStart, controlPanel.length, 2).setValues(controlPanel);

  // Style the control panel
  sheet.getRange(1, controlPanelStart, controlPanel.length, 2).setBorder(
    true, true, true, true, true, true,
    '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM
  );

  // Highlight the Import Type cell
  sheet.getRange(3, controlPanelStart + 1).setBackground('#FFF3CD');

  // Style instruction section
  sheet.getRange(9, controlPanelStart, 6, 2).setBackground('#F3F3F3');

  // === PASTE ZONE INDICATOR (Cell A1) ===
  sheet.getRange('A1').setValue('📋 PASTE CSV HEADERS HERE (Row 1) →');
  sheet.getRange('A1').setBackground('#D4EDDA');
  sheet.getRange('A1').setFontWeight('bold');
  sheet.getRange('A1').setFontColor('#155724');

  // Set row 2 background to indicate data zone
  sheet.getRange(2, 1, 1, 25).setBackground('#E8F4F8');
  sheet.getRange('A2').setValue('↓ CSV data rows start here (Row 2+)');
  sheet.getRange('A2').setFontStyle('italic');
  sheet.getRange('A2').setFontColor('#666666');

  Logger.log('  ✓ UI layout configured');
}

/**
 * Setup data validation for Import Type dropdown
 * Private helper function
 */
function setupImportStaging_Validation_(sheet) {
  const ss = getSpreadsheet_();
  const adminSheet = ss.getSheetByName('Admin');

  if (!adminSheet) {
    Logger.log('  ⚠ Admin sheet not found, skipping validation setup');
    return;
  }

  // Check if Admin!F:F has Import Types list
  // If not, create it
  const importTypesHeader = adminSheet.getRange('F1').getValue();
  if (importTypesHeader !== 'Import_Types') {
    // Create the Import Types list in Admin
    const importTypes = [
      ['Import_Types'],
      ['LinkedIn_Contact'],
      ['Bullhorn_Contact'],
      ['Lusha_Contact'],
      ['Lusha_Company'],
      ['CrunchBase_Company'],
      ['Generic_Contact'],
      ['Generic_Company']
    ];
    adminSheet.getRange(1, 6, importTypes.length, 1).setValues(importTypes);
    Logger.log('  ✓ Created Import Types list in Admin!F:F');
  }

  // Set up dropdown validation for Import Type (Z3 / AA3 in control panel)
  const importTypeCell = sheet.getRange(3, 27); // AA3
  const importTypeRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(adminSheet.getRange('F2:F20'), true)
    .setAllowInvalid(false)
    .setHelpText('Select the type of data you are importing')
    .build();
  importTypeCell.setDataValidation(importTypeRule);

  Logger.log('  ✓ Import Type dropdown configured');
}

/**
 * MAIN PROCESSING FUNCTION
 * Processes data from IMPORT_Staging based on selected Import Type
 *
 * USAGE: Run from menu after pasting data and selecting Import Type
 */
function Process_Smart_Import() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const importSheet = ss.getSheetByName('IMPORT_Staging');

  if (!importSheet) {
    ui.alert('Error', 'IMPORT_Staging tab not found. Run Setup_Import_Staging_Tab() first.', ui.ButtonSet.OK);
    return;
  }

  try {
    // Get Import Type from control panel (AA3)
    const importType = importSheet.getRange(3, 27).getValue();
    if (!importType || importType === '[SELECT FROM DROPDOWN]') {
      ui.alert('Import Type Required', 'Please select an Import Type from the dropdown in cell AA3.', ui.ButtonSet.OK);
      return;
    }

    // Get data dimensions
    const lastRow = importSheet.getLastRow();
    const lastCol = importSheet.getLastColumn();

    if (lastRow < 2) {
      ui.alert('No Data', 'No data found to import. Please paste CSV data starting at cell A1.', ui.ButtonSet.OK);
      return;
    }

    // Update status
    importSheet.getRange(4, 27).setValue('Processing...');
    importSheet.getRange(6, 27).setValue(lastRow - 1); // Row count (excluding header)
    importSheet.getRange(7, 27).setValue(lastCol); // Column count

    // Get headers from row 1
    const headers = importSheet.getRange(1, 1, 1, lastCol).getValues()[0];

    Logger.log(`Processing ${importType} import: ${lastRow - 1} rows, ${lastCol} columns`);
    Logger.log(`Headers: ${headers.join(', ')}`);

    // Route to appropriate processor
    const result = routeImport_(importType, headers, importSheet, lastRow, lastCol);

    // Update status
    importSheet.getRange(4, 27).setValue('Complete');
    importSheet.getRange(5, 27).setValue(new Date());

    ui.alert(
      'Import Complete',
      `Successfully processed ${result.rowsProcessed} rows.\n\n` +
      `Import Type: ${importType}\n` +
      `Target: ${result.targetTab}\n` +
      `Status: ${result.status}`,
      ui.ButtonSet.OK
    );

    Logger.log(`✓ Import complete: ${result.rowsProcessed} rows processed`);

  } catch (error) {
    importSheet.getRange(4, 27).setValue('Error');
    Logger.log('ERROR in Process_Smart_Import: ' + error.toString());
    ui.alert('Import Error', 'Error: ' + error.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Route import to appropriate processor based on Import Type
 * Private helper function
 *
 * @param {string} importType - The selected import type
 * @param {Array} headers - Array of column headers
 * @param {Sheet} importSheet - The IMPORT_Staging sheet
 * @param {number} lastRow - Last row with data
 * @param {number} lastCol - Last column with data
 * @return {Object} Result object with status and details
 */
function routeImport_(importType, headers, importSheet, lastRow, lastCol) {
  const ss = getSpreadsheet_();

  // Import type routing configuration
  const routingConfig = {
    'LinkedIn_Contact': {
      targetTab: 'Import_LinkedIn',
      requiredHeaders: ['First Name', 'Last Name', 'Company'],
      processor: processLinkedInImport_
    },
    'Lusha_Contact': {
      targetTab: 'LushaContactInserts',
      requiredHeaders: ['First Name', 'Last Name', 'Email'],
      processor: processLushaContactImport_
    },
    'Lusha_Company': {
      targetTab: CONFIG.sheetLushaCompany,
      requiredHeaders: ['Company Name', 'Company Domain'],
      processor: processLushaCompanyImport_
    },
    'Bullhorn_Contact': {
      targetTab: 'Import_Bullhorn',
      requiredHeaders: ['firstName', 'lastName', 'email'],
      processor: processBullhornImport_
    },
    'CrunchBase_Company': {
      targetTab: 'Import CB',
      requiredHeaders: ['Organization Name', 'Website'],
      processor: processCrunchBaseImport_
    },
    'Generic_Contact': {
      targetTab: 'Contact_Inserts',
      requiredHeaders: ['Name'], // Very flexible
      processor: processGenericContactImport_
    },
    'Generic_Company': {
      targetTab: CONFIG.sheetCompany,
      requiredHeaders: ['Company'], // Very flexible
      processor: processGenericCompanyImport_
    }
  };

  // Validate import type
  const config = routingConfig[importType];
  if (!config) {
    throw new Error(`Unknown import type: ${importType}`);
  }

  // Validate headers
  const missingHeaders = config.requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw new Error(
      `Missing required headers for ${importType}:\n` +
      `Expected: ${config.requiredHeaders.join(', ')}\n` +
      `Missing: ${missingHeaders.join(', ')}\n\n` +
      `Found headers: ${headers.join(', ')}`
    );
  }

  // Get target sheet (create if doesn't exist for helper tabs)
  let targetSheet = ss.getSheetByName(config.targetTab);
  if (!targetSheet) {
    Logger.log(`  ⚠ Creating missing target tab: ${config.targetTab}`);
    targetSheet = ss.insertSheet(config.targetTab);
    targetSheet.hideSheet(); // Auto-hide helper tabs
  }

  // Call the appropriate processor
  const result = config.processor(headers, importSheet, targetSheet, lastRow, lastCol);

  return {
    rowsProcessed: result.rowsProcessed || lastRow - 1,
    targetTab: config.targetTab,
    status: result.status || 'Success'
  };
}

// Per-source processor functions moved to 06a_Smart_Import_Processors.gs
