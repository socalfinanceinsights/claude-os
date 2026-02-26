/**
 * 10d_Campaign_Data_Helpers.gs
 * @execution manual
 * Campaign data write helpers — writes to BD_Campaigns, BD_Campaign_Steps,
 * Campaign_Drafts, BD_Contacts
 * CALLED BY: 10_BD_Campaign_Creation.gs (createMPCCampaign)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, isoNow_, logCampaignAction, logCampaignError)
 */

// ============================================================================
// WRITE HELPERS
// ============================================================================

/**
 * Write a campaign record to BD_Campaigns
 * @param {string} campaignID
 * @param {Object} params - { startDate, campaignKind, onePagerURL }
 * @param {string} candidateTeaser
 * @param {string} variantDist - e.g. "A:3, B:2, C:1"
 */
function writeCampaignRecord_(campaignID, params, candidateTeaser, variantDist) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetCampaigns);

  if (!sheet) {
    logCampaignError('BD_Campaigns sheet not found');
    return;
  }

  var now = isoNow_();

  // BD_Campaigns columns (A-O, 1-indexed):
  // A=Campaign_ID, B=Campaign_Name, C=Campaign_Kind, D=Active, E=Target_Level,
  // F=Primary_Target, G=Cadence_Length_Days, H=Notes, I=Owner, J=OnePager_URL,
  // K=Created_On, L=Last_Updated, M=Start_Date, N=Candidate_Teaser, O=Variant_Distribution
  var row = [
    campaignID,                          // A: Campaign_ID
    campaignID,                          // B: Campaign_Name (same as ID initially)
    String(params.campaignKind || 'MPC'), // C: Campaign_Kind
    'Yes',                               // D: Active
    '',                                  // E: Target_Level (manual)
    '',                                  // F: Primary_Target (manual)
    '',                                  // G: Cadence_Length_Days (manual)
    '',                                  // H: Notes
    'YOUR_NAME',                         // I: Owner
    String(params.onePagerURL || ''),    // J: OnePager_URL
    now,                                 // K: Created_On
    now,                                 // L: Last_Updated
    String(params.startDate || ''),      // M: Start_Date
    candidateTeaser,                     // N: Candidate_Teaser
    variantDist                          // O: Variant_Distribution
  ];

  sheet.appendRow(row);
  logCampaignAction('Wrote BD_Campaigns record: ' + campaignID);
}

/**
 * Write campaign steps (cadence snapshot) to BD_Campaign_Steps
 * @param {string} campaignID
 * @param {Object} cadenceConfig - Full cadence config keyed by variant ID
 * @param {string[]} variantsUsed - e.g. ['A', 'B', 'C']
 */
function writeCampaignSteps_(campaignID, cadenceConfig, variantsUsed) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetCampaignSteps);

  if (!sheet) {
    logCampaignError('BD_Campaign_Steps sheet not found');
    return;
  }

  var rows = [];

  // BD_Campaign_Steps columns (A-M, 1-indexed):
  // A=Campaign_ID, B=Step_No, C=Step_Label, D=Channel, E=LinkedIn_Mode,
  // F=Wait_Days_From_Prior, G=Variant_ID, H=Subject_Template, I=Body_Template,
  // J=CTA_Template, K=Send_Window_Hint, L=Use, M=Notes
  for (var v = 0; v < variantsUsed.length; v++) {
    var variantId = variantsUsed[v];
    var steps = cadenceConfig[variantId] || [];

    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      rows.push([
        campaignID,                          // A: Campaign_ID
        step.step_no,                        // B: Step_No
        step.display_label || ('Step ' + step.step_no + ' - ' + step.channel), // C: Step_Label
        step.channel,                        // D: Channel
        '',                                  // E: LinkedIn_Mode (set per HM in drafts)
        step.day,                            // F: Wait_Days_From_Prior (using day offset)
        variantId,                           // G: Variant_ID
        '',                                  // H: Subject_Template
        '',                                  // I: Body_Template
        '',                                  // J: CTA_Template
        step.time_slot || '',               // K: Send_Window_Hint
        step.purpose || '',                 // L: Use
        step.paired_with ? ('Paired with step ' + step.paired_with) : '' // M: Notes
      ]);
    }
  }

  if (rows.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
    logCampaignAction('Wrote ' + rows.length + ' rows to BD_Campaign_Steps for ' + campaignID);
  }
}

/**
 * Write campaign drafts to Campaign_Drafts
 * @param {string} campaignID
 * @param {Array} hmResults - Array of { hmData, variantId, touches, cadenceSteps }
 */
function writeCampaignDrafts_(campaignID, hmResults) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetCampaignDrafts);

  if (!sheet) {
    logCampaignError('Campaign_Drafts sheet not found');
    return;
  }

  var rows = [];
  var now = isoNow_();

  // Campaign_Drafts columns (A-Q, 1-indexed):
  // A=Campaign_ID, B=HM_Composite_Key, C=HM_Name, D=Touch_No, E=Channel,
  // F=To_Email, G=Subject, H=Body, I=CTA, J=LinkedIn_URL, K=Phone_Number,
  // L=Date_Generated, M=Date_Sent, N=Response, O=Variant_ID, P=Display_Label, Q=VM_Briefing_Card
  for (var h = 0; h < hmResults.length; h++) {
    var result = hmResults[h];
    var hmData = result.hmData;
    var variantId = result.variantId;
    var touches = result.touches;
    var cadenceSteps = result.cadenceSteps;

    for (var t = 0; t < touches.length; t++) {
      var touch = touches[t];
      var cadenceStep = cadenceSteps[t] || {};
      var displayLabel = cadenceStep.display_label || ('Touch ' + (t + 1) + ' - ' + touch.channel);

      rows.push([
        campaignID,                    // A: Campaign_ID
        hmData.key,                    // B: HM_Composite_Key
        hmData.name,                   // C: HM_Name
        (t + 1),                       // D: Touch_No
        touch.channel || '',           // E: Channel
        hmData.email || '',            // F: To_Email
        touch.subject || '',           // G: Subject
        touch.body || '',              // H: Body
        touch.cta || '',               // I: CTA
        hmData.linkedinUrl || '',      // J: LinkedIn_URL
        hmData.phone || '',            // K: Phone_Number
        now,                           // L: Date_Generated
        '',                            // M: Date_Sent
        '',                            // N: Response
        variantId,                     // O: Variant_ID
        displayLabel,                  // P: Display_Label
        touch.vm_briefing_card || ''   // Q: VM_Briefing_Card
      ]);
    }
  }

  if (rows.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
    logCampaignAction('Wrote ' + rows.length + ' drafts to Campaign_Drafts for ' + campaignID);
  }
}

/**
 * Update BD_Contacts Campaign_ID column for processed HMs
 * @param {string[]} hmKeys - Composite_Key values of processed HMs
 * @param {string} campaignID
 */
function updateBDContacts_(hmKeys, campaignID) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetBD);

  if (!sheet) {
    logCampaignError('BD_Contacts sheet not found');
    return;
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colKey = headers.indexOf('Composite_Key');
  var colCampaignID = headers.indexOf('Campaign_ID');

  if (colKey === -1 || colCampaignID === -1) {
    logCampaignError('BD_Contacts missing required columns (Composite_Key or Campaign_ID)');
    return;
  }

  // Build set of keys to update
  var keySet = {};
  for (var k = 0; k < hmKeys.length; k++) {
    keySet[hmKeys[k]] = true;
  }

  var updatedCount = 0;

  for (var i = 1; i < data.length; i++) {
    var rowKey = String(data[i][colKey] || '');
    if (keySet[rowKey]) {
      // Write only the Campaign_ID cell (colCampaignID is 0-indexed, sheet col is +1)
      sheet.getRange(i + 1, colCampaignID + 1).setValue(campaignID);
      updatedCount++;
    }
  }

  SpreadsheetApp.flush();
  logCampaignAction('Updated BD_Contacts Campaign_ID for ' + updatedCount + ' HMs → ' + campaignID);
}
