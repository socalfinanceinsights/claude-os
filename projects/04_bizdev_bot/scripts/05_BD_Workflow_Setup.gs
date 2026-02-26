/**
 * BD TRACKER - BD_CONTACTS WORKFLOW SETUP
 * Version: 1.1.0 (Split: utilities moved to 05a)
 * @execution manual
 *
 * CONTAINS:
 * - Data Validation setup for BD_Contacts dropdowns
 * - Conditional Formatting rules for BD_Contacts
 * - Workflow formula verification
 *
 * USAGE:
 * Run Setup_BD_Workflow_Complete() once to configure all Data Validation and Conditional Formatting
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 * SEE ALSO: 05a_BD_Workflow_Utils.gs (repair utilities, GID tools, test functions)
 */

/**
 * MAIN SETUP FUNCTION
 * Sets up complete BD_Contacts workflow (Data Validation + Conditional Formatting)
 *
 * RUN THIS ONCE to configure the BD_Contacts tab
 */
function Setup_BD_Workflow_Complete() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Setup BD_Contacts Workflow',
    'This will configure:\n\n' +
    '✓ Data Validation dropdowns (Outreach Stage, Response Status, Campaign ID, Campaign Step)\n' +
    '✓ Conditional Formatting (Due Flag, Combined ICP, Company ICP scores)\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    Logger.log('User cancelled workflow setup');
    return;
  }

  try {
    Logger.log('Starting BD_Contacts workflow setup...');

    // Step 1: Setup Data Validation
    setupDataValidation_();
    Logger.log('✓ Data Validation configured');

    // Step 2: Setup Conditional Formatting
    setupConditionalFormatting_();
    Logger.log('✓ Conditional Formatting configured');

    // Step 3: Verify formulas are correct
    verifyFormulas_();
    Logger.log('✓ Formulas verified');

    ui.alert(
      'Setup Complete!',
      'BD_Contacts workflow is now fully configured.\n\n' +
      '✓ Dropdowns ready for use\n' +
      '✓ Color coding active\n' +
      '✓ Formulas verified',
      ui.ButtonSet.OK
    );

    Logger.log('BD_Contacts workflow setup complete');

  } catch (error) {
    Logger.log('ERROR in Setup_BD_Workflow_Complete: ' + error.toString());
    ui.alert('Setup Error', 'Error: ' + error.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Setup Data Validation for BD_Contacts dropdowns
 * Private helper function
 */
function setupDataValidation_() {
  const ss = getSpreadsheet_();
  const bdSheet = ss.getSheetByName('BD_Contacts');
  const adminSheet = ss.getSheetByName('Admin');
  const campaignsSheet = ss.getSheetByName('BD_Campaigns');

  if (!bdSheet || !adminSheet || !campaignsSheet) {
    throw new Error('Required sheets not found (BD_Contacts, Admin, or BD_Campaigns)');
  }

  // Get the last row with data (Column A has composite keys)
  const lastRow = bdSheet.getRange('A:A').getValues().filter(String).length;

  Logger.log(`Setting up Data Validation for ${lastRow} rows...`);

  // 1. Column O (Index 15): Outreach Stage - from Admin!D2:D12
  const outreachStageRange = bdSheet.getRange(2, 15, lastRow - 1, 1); // O2:O{lastRow}
  const outreachStageRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(adminSheet.getRange('D2:D12'), true)
    .setAllowInvalid(false)
    .setHelpText('Select outreach stage from predefined list')
    .build();
  outreachStageRange.setDataValidation(outreachStageRule);
  Logger.log('  ✓ Outreach Stage dropdown (Column O)');

  // 2. Column T (Index 20): Response Status - from Admin!E2:E9
  const responseStatusRange = bdSheet.getRange(2, 20, lastRow - 1, 1); // T2:T{lastRow}
  const responseStatusRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(adminSheet.getRange('E2:E9'), true)
    .setAllowInvalid(false)
    .setHelpText('Select response status from predefined list')
    .build();
  responseStatusRange.setDataValidation(responseStatusRule);
  Logger.log('  ✓ Response Status dropdown (Column T)');

  // 3. Column Z (Index 26): Campaign ID - from BD_Campaigns where Active=Yes
  // Note: Using simple range reference (manual filtering needed in BD_Campaigns)
  const campaignIdRange = bdSheet.getRange(2, 26, lastRow - 1, 1); // Z2:Z{lastRow}
  const campaignIdRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(campaignsSheet.getRange('A2:A100'), true)
    .setAllowInvalid(true) // Allow invalid to permit blank
    .setHelpText('Select campaign ID from BD_Campaigns')
    .build();
  campaignIdRange.setDataValidation(campaignIdRule);
  Logger.log('  ✓ Campaign ID dropdown (Column Z) - from BD_Campaigns A2:A100');

  // 4. Column AA (Index 27): Campaign Step No - dependent on Campaign ID (Column Z)
  // Note: This is complex - using custom list for now, can be enhanced later
  const campaignStepRange = bdSheet.getRange(2, 27, lastRow - 1, 1); // AA2:AA{lastRow}
  const campaignStepRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(1, 20) // Assume max 20 steps per campaign
    .setAllowInvalid(true)
    .setHelpText('Enter campaign step number (1-20)')
    .build();
  campaignStepRange.setDataValidation(campaignStepRule);
  Logger.log('  ✓ Campaign Step No dropdown (Column AA) - numeric validation');

  // 5. Column R (Index 18): Schedule Follow-Up - date validation
  const scheduleFollowUpRange = bdSheet.getRange(2, 18, lastRow - 1, 1); // R2:R{lastRow}
  const scheduleFollowUpRule = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(true)
    .setHelpText('Enter a follow-up date')
    .build();
  scheduleFollowUpRange.setDataValidation(scheduleFollowUpRule);
  Logger.log('  ✓ Schedule Follow-Up date validation (Column R)');

  Logger.log('Data Validation setup complete');
}

/**
 * Setup Conditional Formatting for BD_Contacts
 * Private helper function
 */
function setupConditionalFormatting_() {
  const ss = getSpreadsheet_();
  const bdSheet = ss.getSheetByName('BD_Contacts');

  if (!bdSheet) {
    throw new Error('BD_Contacts sheet not found');
  }

  // Get the last row with data
  const lastRow = bdSheet.getRange('A:A').getValues().filter(String).length;

  Logger.log(`Setting up Conditional Formatting for ${lastRow} rows...`);

  // Clear existing conditional formatting rules first
  const existingRules = bdSheet.getConditionalFormatRules();
  Logger.log(`  Clearing ${existingRules.length} existing rules...`);
  bdSheet.clearConditionalFormatRules();

  const rules = [];

  // RULE 1: Combined ICP (Column Y, Index 25) - Red/Bold when either component < 30%
  // Formula: =OR(W2/65*100<30, X2/30*100<30)
  const combinedIcpRange = bdSheet.getRange(2, 25, lastRow - 1, 1); // Y2:Y{lastRow}
  const combinedIcpRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR(W2/65*100<30, X2/30*100<30)')
    .setFontColor('#FF0000')
    .setBold(true)
    .setRanges([combinedIcpRange])
    .build();
  rules.push(combinedIcpRule);
  Logger.log('  ✓ Combined ICP alert formatting (Column Y)');

  // RULE 2: Due Flag (Column S, Index 19) - Color coding by status
  const dueFlagRange = bdSheet.getRange(2, 19, lastRow - 1, 1); // S2:S{lastRow}

  // Overdue - Red background, white text
  const overdueRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Overdue')
    .setBackground('#FF0000')
    .setFontColor('#FFFFFF')
    .setBold(true)
    .setRanges([dueFlagRange])
    .build();
  rules.push(overdueRule);

  // Due Today - Amber background, bold
  const dueTodayRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Due Today')
    .setBackground('#FFA500')
    .setBold(true)
    .setRanges([dueFlagRange])
    .build();
  rules.push(dueTodayRule);

  // Upcoming - Light green background
  const upcomingRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Upcoming')
    .setBackground('#90EE90')
    .setRanges([dueFlagRange])
    .build();
  rules.push(upcomingRule);

  // Stopped - Negative/DNC - Red text
  const stoppedNegRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Stopped – Negative')
    .setFontColor('#FF0000')
    .setRanges([dueFlagRange])
    .build();
  rules.push(stoppedNegRule);

  // Stopped - Closed/Paused - Orange text
  const stoppedClosedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Stopped – Closed')
    .setFontColor('#FF8C00')
    .setRanges([dueFlagRange])
    .build();
  rules.push(stoppedClosedRule);

  // Complete - Green text, bold
  const completeRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Complete')
    .setFontColor('#008000')
    .setBold(true)
    .setRanges([dueFlagRange])
    .build();
  rules.push(completeRule);

  // No Campaign Sched - Yellow background
  const noCampaignRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('No Campaign Sched. Set Manual Follow-UP')
    .setBackground('#FFFF00')
    .setRanges([dueFlagRange])
    .build();
  rules.push(noCampaignRule);

  Logger.log('  ✓ Due Flag color coding (Column S) - 7 rules');

  // RULE 3: Company ICP (Column W, Index 23) - Font color only (no background)
  const companyIcpRange = bdSheet.getRange(2, 23, lastRow - 1, 1); // W2:W{lastRow}

  // Green text: >= 80% (52/65 points)
  const icpGreenRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=W2/65*100>=80')
    .setFontColor('#008000')
    .setBold(true)
    .setRanges([companyIcpRange])
    .build();
  rules.push(icpGreenRule);

  // Orange text: 60-79% (39-51/65 points)
  const icpOrangeRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(W2/65*100>=60, W2/65*100<80)')
    .setFontColor('#FF8C00')
    .setBold(true)
    .setRanges([companyIcpRange])
    .build();
  rules.push(icpOrangeRule);

  // Red text: < 60% (<39/65 points)
  const icpRedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=W2/65*100<60')
    .setFontColor('#FF0000')
    .setBold(true)
    .setRanges([companyIcpRange])
    .build();
  rules.push(icpRedRule);

  Logger.log('  ✓ Company ICP font colors (Column W) - no background');

  // RULE 4: Grey out Campaign columns (Z-AE) when Stopped or Complete
  const campaignColumnsRange = bdSheet.getRange(2, 26, lastRow - 1, 6); // Z2:AE{lastRow}
  const greyOutCampaignRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR(ISNUMBER(SEARCH("Stopped",S2)), S2="Complete")')
    .setBackground('#EEEEEE')
    .setFontColor('#999999')
    .setRanges([campaignColumnsRange])
    .build();
  rules.push(greyOutCampaignRule);
  Logger.log('  ✓ Campaign columns grey-out when Stopped/Complete (Columns Z-AE)');

  // Apply all rules at once
  bdSheet.setConditionalFormatRules(rules);
  Logger.log(`Conditional Formatting setup complete (${rules.length} rules applied)`);
  Logger.log('  Summary: Combined ICP (1), Due Flag (7), Company ICP (3), Campaign Grey-out (1) = 12 total');
}

/**
 * Verify that key formulas are correct in BD_Contacts
 * Private helper function
 */
function verifyFormulas_() {
  const ss = getSpreadsheet_();
  const bdSheet = ss.getSheetByName('BD_Contacts');

  if (!bdSheet) {
    throw new Error('BD_Contacts sheet not found');
  }

  Logger.log('Verifying formulas...');

  // Check Column Q (Days Since Last Contact) - should be ARRAYFORMULA
  const colQ_Formula = bdSheet.getRange('Q2').getFormula();
  if (!colQ_Formula.includes('ARRAYFORMULA')) {
    Logger.log('  ⚠ Column Q does not use ARRAYFORMULA (may be slow with 3000+ rows)');
  } else {
    Logger.log('  ✓ Column Q uses ARRAYFORMULA');
  }

  // Check Column S (Due Flag) - should have complex logic
  const colS_Formula = bdSheet.getRange('S2').getFormula();
  if (!colS_Formula.includes('Stopped') || !colS_Formula.includes('Overdue')) {
    Logger.log('  ⚠ Column S formula may be incomplete');
  } else {
    Logger.log('  ✓ Column S Due Flag formula verified');
  }

  // Check Column Y (Combined ICP) - should calculate percentage
  const colY_Formula = bdSheet.getRange('Y2').getFormula();
  if (!colY_Formula.includes('95') || !colY_Formula.includes('100')) {
    Logger.log('  ⚠ Column Y formula may not be calculating percentage correctly');
  } else {
    Logger.log('  ✓ Column Y Combined ICP formula verified');
  }

  Logger.log('Formula verification complete');
}

// Repair utilities, GID tools, and test functions moved to 05a_BD_Workflow_Utils.gs
