/**
 * 10f_Campaign_Dialog.gs
 * BD TRACKER - Campaign Dialog & Server Functions
 * @execution manual
 * Version: 1.0.0
 *
 * CONTAINS:
 * - showMPCCampaignDialog: Launch HtmlService modal dialog
 * - getCampaignKinds: Return CAMPAIGN_KINDS for dialog dropdown
 * - getHiringManagersForDialog: Read selected BD_Contacts rows for dialog
 *
 * SPLIT FROM: 10_BD_Campaign_Creation.gs (lines 9-116)
 * CALLED BY: Menu.gs (onOpen), HTML dialog (10_MPC_Campaign_Dialog)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, CAMPAIGN_KINDS, logCampaignError_)
 */

// ============================================================================
// DIALOG & SERVER FUNCTIONS
// ============================================================================

/**
 * Show dialog for creating campaign
 */
function showMPCCampaignDialog() {
  var html = HtmlService.createHtmlOutputFromFile('10_MPC_Campaign_Dialog')
    .setWidth(650)
    .setHeight(600)
    .setTitle('Create Campaign');

  SpreadsheetApp.getUi().showModalDialog(html, 'Create Campaign');
}

/**
 * Return CAMPAIGN_KINDS array for dialog dropdown
 */
function getCampaignKinds() {
  return CAMPAIGN_KINDS;
}

/**
 * Get hiring managers from currently selected rows in BD_Contacts
 * @returns {Object} - { hms: [...], warnings: [...] } or { error: "..." }
 */
function getHiringManagersForDialog() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetBD);

  if (!sheet) {
    logCampaignError('BD_Contacts sheet not found');
    return { error: 'BD_Contacts sheet not found.' };
  }

  var selection = sheet.getActiveRange();

  if (!selection) {
    return { error: 'No rows selected. Please select HM rows in BD_Contacts sheet first, then open this dialog.' };
  }

  var selectedRows = selection.getRowIndices();

  if (selectedRows.length === 1 && selectedRows[0] === 1) {
    return { error: 'Please select one or more HM rows (not just the header). Filter the sheet, then select the rows you want.' };
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colKey = headers.indexOf('Composite_Key');
  var colName = headers.indexOf('HM_Name');
  var colTitle = headers.indexOf('HM_Title');
  var colCompany = headers.indexOf('Company');
  var colDomain = headers.indexOf('Company_Domain');
  var colEmail = headers.indexOf('Primary_Email');
  var colLinkedIn = headers.indexOf('LinkedIn_URL');
  var colCampaignID = headers.indexOf('Campaign_ID');
  var colFirstDegree = headers.indexOf('1st_Degree');

  var hms = [];
  var warnings = [];

  for (var i = 0; i < selectedRows.length; i++) {
    var rowIndex = selectedRows[i];
    if (rowIndex === 1) continue; // Skip header

    var row = data[rowIndex - 1];

    var hmKey = row[colKey];
    var hmName = String(row[colName] || '').trim();

    if (!hmKey || !hmName) {
      warnings.push('Row ' + rowIndex + ': Missing Composite_Key or HM_Name');
      continue;
    }

    // Warn if already in a campaign
    if (row[colCampaignID]) {
      warnings.push(hmName + ': Already in campaign "' + row[colCampaignID] + '"');
      continue;
    }

    // Warn if missing email or LinkedIn
    if (!row[colEmail]) {
      warnings.push(hmName + ': Missing Primary_Email');
    }
    if (!row[colLinkedIn]) {
      warnings.push(hmName + ': Missing LinkedIn_URL');
    }

    hms.push({
      key: hmKey,
      name: hmName,
      firstName: parseFirstName_(hmName),
      title: String(row[colTitle] || 'N/A'),
      company: String(row[colCompany] || 'N/A'),
      companyDomain: String(row[colDomain] || ''),
      email: String(row[colEmail] || ''),
      linkedinUrl: String(row[colLinkedIn] || ''),
      firstDegree: String(row[colFirstDegree] || '')
    });
  }

  return { hms: hms, warnings: warnings };
}
