/**
 * 11a_Campaign_Schedule_Helpers.gs
 * @execution manual
 * Data helpers for campaign event scheduling
 * Reads Campaign_Drafts, BD_Campaigns, Cadence_Config, BD_Contacts
 * CALLED BY: 11_BD_Campaign_Scheduling.gs (scheduleCampaignEvents)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG)
 */

// ============================================================================
// CAMPAIGN DATA READERS
// ============================================================================

/**
 * Get list of active campaign IDs from BD_Campaigns
 * @returns {string[]} - Array of Campaign_ID strings where Active = 'Yes'
 */
function getActiveCampaigns_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetCampaigns);

  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0];
  var colId = headers.indexOf('Campaign_ID');
  var colActive = headers.indexOf('Active');

  if (colId === -1) return [];

  var campaigns = [];
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][colId] || '').trim();
    var active = colActive === -1 ? 'Yes' : String(data[i][colActive] || '').trim();
    if (id && active === 'Yes') {
      campaigns.push(id);
    }
  }

  return campaigns;
}

/**
 * Get the start date for a campaign from BD_Campaigns
 * @param {string} campaignID
 * @returns {Date|null} - Start date or null if not found
 */
function getCampaignStartDate_(campaignID) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetCampaigns);

  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colId = headers.indexOf('Campaign_ID');
  var colStart = headers.indexOf('Start_Date');

  if (colId === -1 || colStart === -1) return null;

  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][colId] || '').trim();
    if (id === campaignID) {
      var rawDate = data[i][colStart];
      if (!rawDate) return null;
      // Handle both Date objects and string dates
      if (rawDate instanceof Date) return rawDate;
      var parsed = new Date(rawDate);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

/**
 * Get all Campaign_Drafts rows for a campaign, grouped by HM composite key
 * @param {string} campaignID
 * @returns {Object} - Map of hmCompositeKey -> array of draft objects
 */
function getCampaignDrafts_(campaignID) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetCampaignDrafts);

  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  var cols = CONFIG.campaignDraftsCols;
  var grouped = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowCampaignId = String(row[cols.campaignId] || '').trim();

    if (rowCampaignId !== campaignID) continue;

    var hmKey = String(row[cols.hmCompositeKey] || '').trim();
    if (!hmKey) continue;

    if (!grouped[hmKey]) grouped[hmKey] = [];

    grouped[hmKey].push({
      hmCompositeKey: hmKey,
      hmName: String(row[cols.hmName] || ''),
      touchNo: parseInt(row[cols.touchNo]) || 0,
      channel: String(row[cols.channel] || ''),
      toEmail: String(row[cols.toEmail] || ''),
      subject: String(row[cols.subject] || ''),
      body: String(row[cols.body] || ''),
      cta: String(row[cols.cta] || ''),
      linkedinUrl: String(row[cols.linkedinUrl] || ''),
      phoneNumber: String(row[cols.phoneNumber] || ''),
      variantId: String(row[cols.variantId] || ''),
      displayLabel: String(row[cols.displayLabel] || ''),
      vmBriefingCard: String(row[cols.vmBriefingCard] || '')
    });
  }

  return grouped;
}

// ============================================================================
// BD CONTACTS LOADER
// ============================================================================

/**
 * Load BD_Contacts data keyed by composite key (for company, title, firstDegree)
 * @returns {Object} - Map of compositeKey -> { company, title, firstDegree }
 */
function loadBDContactsData_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetBD);

  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colKey = headers.indexOf('Composite_Key');
  var colCompany = headers.indexOf('Company');
  var colTitle = headers.indexOf('HM_Title');
  var colFirstDegree = headers.indexOf('1st_Degree');

  if (colKey === -1) return {};

  var result = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][colKey] || '').trim();
    if (!key) continue;
    result[key] = {
      company: String(data[i][colCompany] || ''),
      title: String(data[i][colTitle] || ''),
      firstDegree: String(data[i][colFirstDegree] || '')
    };
  }

  return result;
}

// ============================================================================
// CADENCE CONFIG LOADER
// ============================================================================

/**
 * Load Cadence_Config as a nested lookup structure
 * @returns {Object} - { variantId: { touchNo: { day, time_slot, display_label } } }
 */
function loadCadenceCache_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetCadenceConfig);

  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  var headers = data[0];
  var colVariant = headers.indexOf('Variant_ID');
  var colStepNo = headers.indexOf('Step_No');
  var colDay = headers.indexOf('Day');
  var colTimeSlot = headers.indexOf('Time_Slot');
  var colDisplayLabel = headers.indexOf('Display_Label');

  var cache = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var variant = String(row[colVariant] || '').trim();
    var stepNo = parseInt(row[colStepNo]) || 0;

    if (!variant || !stepNo) continue;

    if (!cache[variant]) cache[variant] = {};

    cache[variant][stepNo] = {
      day: parseInt(row[colDay]) || 1,
      time_slot: String(row[colTimeSlot] || ''),
      display_label: String(row[colDisplayLabel] || '')
    };
  }

  return cache;
}

/**
 * Look up day offset from cadence cache
 * @param {Object} cache - From loadCadenceCache_
 * @param {string} variantId
 * @param {number} touchNo
 * @returns {number} - Day offset (1 = campaign start date)
 */
function getCadenceDayOffset_(cache, variantId, touchNo) {
  if (cache[variantId] && cache[variantId][touchNo]) {
    return cache[variantId][touchNo].day || 1;
  }
  return touchNo; // Fallback: touchNo == day
}

/**
 * Look up time slot from cadence cache
 * @param {Object} cache - From loadCadenceCache_
 * @param {string} variantId
 * @param {number} touchNo
 * @returns {string} - Time slot string (e.g. "9:00 AM", "10:30 AM")
 */
function getCadenceTimeSlot_(cache, variantId, touchNo) {
  if (cache[variantId] && cache[variantId][touchNo]) {
    return cache[variantId][touchNo].time_slot || '9:00 AM';
  }
  return '9:00 AM'; // Default
}

// ============================================================================
// DATE/TIME UTILITIES
// ============================================================================

/**
 * Parse a time slot string and apply it to a base date
 * @param {string} timeSlot - e.g. "9:00 AM", "10:30 AM", "2:00 PM"
 * @param {Date} baseDate - The calendar date to apply the time to
 * @returns {Date} - Date object with time applied
 */
function parseTimeSlot_(timeSlot, baseDate) {
  var result = new Date(baseDate);
  result.setHours(9, 0, 0, 0); // Default: 9:00 AM

  if (!timeSlot || timeSlot.trim() === '') return result;

  // Match patterns like "9:00 AM", "10:30 AM", "2:00 PM", "14:00"
  var match12 = timeSlot.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  var match24 = timeSlot.match(/^(\d{1,2}):(\d{2})$/);

  if (match12) {
    var hours = parseInt(match12[1]);
    var minutes = parseInt(match12[2]);
    var period = match12[3].toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    result.setHours(hours, minutes, 0, 0);
  } else if (match24) {
    result.setHours(parseInt(match24[1]), parseInt(match24[2]), 0, 0);
  }

  return result;
}
