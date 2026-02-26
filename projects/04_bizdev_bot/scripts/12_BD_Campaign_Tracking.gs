/**
 * 12_BD_Campaign_Tracking.gs
 * Campaign tracking and touch completion
 *
 * Dependencies:
 * - 00_Brain_Config.gs (CONFIG)
 */

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Mark touch complete for selected HM (called from menu)
 */
function markTouchComplete() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.sheetBD);
  const ui = SpreadsheetApp.getUi();

  if (!sheet) {
    ui.alert('Error', 'BD_Contacts sheet not found.', ui.ButtonSet.OK);
    return;
  }

  // Get active row
  const activeRow = sheet.getActiveRange().getRow();

  if (activeRow <= 1) {
    ui.alert('Invalid Selection', 'Please select a hiring manager row (not the header).', ui.ButtonSet.OK);
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // Get column indices
  const colKey = headers.indexOf('Composite_Key');
  const colCampaignID = headers.indexOf('Campaign_ID');
  const colCampaignStepNo = headers.indexOf('Campaign_Step_No');
  const colLastContact = headers.indexOf('Last_Contact');
  const colResponseStatus = headers.indexOf('Response_Status');
  const colOutreachStage = headers.indexOf('Outreach_Stage');

  if (colKey === -1 || colCampaignID === -1 || colCampaignStepNo === -1) {
    ui.alert('Error', 'Required columns not found in BD_Contacts.', ui.ButtonSet.OK);
    return;
  }

  const row = data[activeRow - 1];
  const hmKey = row[colKey];
  const campaignID = row[colCampaignID];
  const currentStepNo = row[colCampaignStepNo] || 0;

  // Validate HM has campaign assigned
  if (!campaignID) {
    ui.alert('No Campaign', 'This hiring manager is not assigned to a campaign.', ui.ButtonSet.OK);
    return;
  }

  // Get campaign steps to validate there's a next step
  const steps = getCampaignStepsForTracking(campaignID);

  if (steps.length === 0) {
    ui.alert('Error', `No campaign steps found for: ${campaignID}`, ui.ButtonSet.OK);
    return;
  }

  const nextStepNo = currentStepNo + 1;

  if (nextStepNo > steps.length) {
    ui.alert('Campaign Complete', `All ${steps.length} touches have been completed for this campaign.`, ui.ButtonSet.OK);
    return;
  }

  const nextStep = steps.find(s => s.stepNo === nextStepNo);

  if (!nextStep) {
    ui.alert('Error', `Step ${nextStepNo} not found in campaign.`, ui.ButtonSet.OK);
    return;
  }

  // Update BD_Contacts
  try {
    const now = new Date();

    // Update Campaign_Step_No
    sheet.getRange(activeRow, colCampaignStepNo + 1).setValue(nextStepNo);

    // Update Last_Contact
    if (colLastContact !== -1) {
      sheet.getRange(activeRow, colLastContact + 1).setValue(now);
    }

    // Update Response_Status to "No Response" (user can manually change if contact replied)
    if (colResponseStatus !== -1) {
      sheet.getRange(activeRow, colResponseStatus + 1).setValue('No Response');
    }

    // Update Outreach_Stage
    if (colOutreachStage !== -1) {
      sheet.getRange(activeRow, colOutreachStage + 1).setValue(`Touch ${nextStepNo} Sent`);
    }

    // Log action
    logCampaignAction(`Touch ${nextStepNo} marked complete for ${hmKey}`);

    // Show success message with next step info
    const hmName = row[headers.indexOf('HM_Name')] || '';
    const company = row[headers.indexOf('Company')] || '';
    const displayLabel = nextStep.displayLabel || ('Touch ' + nextStepNo);

    let message = `${displayLabel} marked complete\n\n`;
    message += `Contact: ${hmName}\n`;
    message += `Company: ${company}\n`;
    message += `Current Step: ${displayLabel} Sent\n`;

    if (nextStepNo < steps.length) {
      const followUpStep = steps.find(s => s.stepNo === nextStepNo + 1);
      if (followUpStep) {
        const followUpLabel = followUpStep.displayLabel || ('Touch ' + followUpStep.stepNo);
        message += `\nNext: ${followUpLabel} - ${followUpStep.channel} in ${followUpStep.waitDays} days`;
      }
    } else {
      message += `\nCampaign complete - all ${steps.length} touches sent!`;
    }

    getSpreadsheet_().toast(message, 'Touch Complete', 10);

  } catch (error) {
    logCampaignError(`Mark touch complete failed: ${error.message}`);
    ui.alert('Error', `Failed to mark touch complete:\n${error.message}`, ui.ButtonSet.OK);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get campaign steps for tracking
 */
function getCampaignStepsForTracking(campaignID) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.sheetCampaignSteps);

  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colCampaignID = headers.indexOf('Campaign_ID');
  const colStepNo = headers.indexOf('Step_No');
  const colStepLabel = headers.indexOf('Step_Label');
  const colChannel = headers.indexOf('Channel');
  const colWaitDays = headers.indexOf('Wait_Days_From_Prior');
  const colUse = headers.indexOf('Use');

  const steps = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    if (row[colCampaignID] === campaignID && row[colUse] === 'Yes') {
      steps.push({
        stepNo: row[colStepNo],
        displayLabel: colStepLabel !== -1 ? String(row[colStepLabel] || '') : '',
        channel: row[colChannel],
        waitDays: row[colWaitDays] || 0
      });
    }
  }

  // Sort by step number
  steps.sort((a, b) => a.stepNo - b.stepNo);

  return steps;
}

// ============================================================================
// BULK OPERATIONS (Future Phase)
// ============================================================================

/**
 * Mark multiple touches complete
 * Future enhancement for bulk processing
 */
function markBulkTouchesComplete() {
  // TODO: Phase 2 enhancement
  // Get all selected rows
  // Process each row
  // Show summary of updates
}

/**
 * Auto-sync campaign step based on Outreach_Stage changes
 * Future enhancement - triggered by onEdit
 */
function autoSyncCampaignStep(e) {
  // TODO: Phase 2 enhancement
  // Detect Outreach_Stage changes
  // Auto-increment Campaign_Step_No
  // Update Last_Contact
}
