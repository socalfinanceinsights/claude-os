/**
 * BD TRACKER - BD_CONTACTS WORKFLOW UTILITIES
 * Version: 1.0.0 (Split from 05_BD_Workflow_Setup.gs)
 * @execution manual
 *
 * CONTAINS:
 * - FIX functions (formula restoration)
 * - UTIL functions (GID management)
 * - TEST functions (workflow status check)
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 * SEE ALSO: 05_BD_Workflow_Setup.gs (main setup functions)
 */

/**
 * FIX - Restore ARRAYFORMULA in Column Q (Days Since Last Contact)
 * Run this if you accidentally overwrote the ARRAYFORMULA with individual formulas
 */
function FIX_RestoreArrayFormulaColumnM() {
  const ss = getSpreadsheet_();
  const bdSheet = ss.getSheetByName('BD_Contacts');

  if (!bdSheet) {
    SpreadsheetApp.getUi().alert('Error', 'BD_Contacts sheet not found', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const response = SpreadsheetApp.getUi().alert(
    'Restore ARRAYFORMULA',
    'This will replace all individual formulas in Column Q (Days Since Last Contact) with a single ARRAYFORMULA.\n\n' +
    'This is more efficient for 3,000+ rows.\n\nContinue?',
    SpreadsheetApp.getUi().ButtonSet.YES_NO
  );

  if (response !== SpreadsheetApp.getUi().Button.YES) {
    Logger.log('User cancelled ARRAYFORMULA restoration');
    return;
  }

  try {
    // Clear column Q first (except header)
    const lastRow = bdSheet.getRange('A:A').getValues().filter(String).length;
    bdSheet.getRange(2, 17, lastRow - 1, 1).clearContent();

    // Set ARRAYFORMULA in Q2
    bdSheet.getRange('Q2').setFormula('=ARRAYFORMULA(IF(A2:A="","",IF(P2:P="","",TODAY()-P2:P)))');

    Logger.log('✓ ARRAYFORMULA restored in Column Q');

    SpreadsheetApp.getUi().alert(
      'Success!',
      'ARRAYFORMULA has been restored in Column Q (Days Since Last Contact).\n\n' +
      'All rows will now calculate automatically.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (error) {
    Logger.log('ERROR in FIX_RestoreArrayFormulaColumnM: ' + error.toString());
    SpreadsheetApp.getUi().alert('Error', 'Failed to restore ARRAYFORMULA: ' + error.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * UTILITY - Get Sheet GIDs for Admin tab configuration
 * Run this to get the GID for BD_Campaigns and update Admin tab
 */
function UTIL_GetAndSetSheetGIDs() {
  const ss = getSpreadsheet_();
  const sheets = ss.getSheets();

  Logger.log('=== ALL SHEET GIDs ===');

  let bdCampaignsGid = null;

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const name = sheet.getName();
    const gid = sheet.getSheetId();

    Logger.log(`${name}: ${gid}`);

    if (name === 'BD_Campaigns') {
      bdCampaignsGid = gid;
    }
  }

  if (bdCampaignsGid !== null) {
    // Auto-update Admin tab with correct GID
    const adminSheet = ss.getSheetByName('Admin');
    if (adminSheet) {
      adminSheet.getRange('B2').setValue(bdCampaignsGid);
      Logger.log(`\n✓ Updated Admin!B2 with BD_Campaigns GID: ${bdCampaignsGid}`);

      SpreadsheetApp.getUi().alert(
        'GID Updated!',
        `BD_Campaigns GID (${bdCampaignsGid}) has been set in Admin!B2\n\n` +
        'The "Next Step Link" column (AA) will now work correctly.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    }
  } else {
    Logger.log('\n⚠ BD_Campaigns sheet not found');
  }

  Logger.log('\n=== END ===');
}

/**
 * TEST FUNCTION - Run to check setup without applying changes
 */
function TEST_CheckWorkflowStatus() {
  const ss = getSpreadsheet_();
  const bdSheet = ss.getSheetByName('BD_Contacts');

  if (!bdSheet) {
    Logger.log('ERROR: BD_Contacts sheet not found');
    return;
  }

  const lastRow = bdSheet.getRange('A:A').getValues().filter(String).length;
  Logger.log(`BD_Contacts has ${lastRow} rows of data`);

  // Check Data Validation
  const hasOutreachDV = bdSheet.getRange('O2').getDataValidation() !== null;
  const hasResponseDV = bdSheet.getRange('T2').getDataValidation() !== null;
  const hasCampaignDV = bdSheet.getRange('Z2').getDataValidation() !== null;

  Logger.log(`Data Validation Status:`);
  Logger.log(`  Outreach Stage (O): ${hasOutreachDV ? '✓ Configured' : '✗ Missing'}`);
  Logger.log(`  Response Status (T): ${hasResponseDV ? '✓ Configured' : '✗ Missing'}`);
  Logger.log(`  Campaign ID (Z): ${hasCampaignDV ? '✓ Configured' : '✗ Missing'}`);

  // Check Conditional Formatting
  const rules = bdSheet.getConditionalFormatRules();
  Logger.log(`Conditional Formatting: ${rules.length} rules configured`);

  // Check formulas
  const colQ = bdSheet.getRange('Q2').getFormula();
  const colS = bdSheet.getRange('S2').getFormula();
  const colY = bdSheet.getRange('Y2').getFormula();

  Logger.log(`Formula Status:`);
  Logger.log(`  Days Since Last Contact (Q): ${colQ.substring(0, 50)}...`);
  Logger.log(`  Due Flag (S): ${colS.substring(0, 50)}...`);
  Logger.log(`  Combined ICP (Y): ${colY.substring(0, 50)}...`);
}
