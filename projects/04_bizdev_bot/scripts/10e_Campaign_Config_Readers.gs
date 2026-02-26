/**
 * 10e_Campaign_Config_Readers.gs
 * BD TRACKER - Campaign Config Readers & HM Data Loader
 * @execution manual
 * Version: 1.0.0
 *
 * CONTAINS:
 * - readPromptConfig_: Read active prompts from Prompt_Config tab
 * - readCadenceConfig_: Read cadence step config from Cadence_Config tab
 * - getHMDataBatch_: Batch-read HM data from BD_Contacts for selected keys
 *
 * SPLIT FROM: 10_BD_Campaign_Creation.gs (lines 122-209, 407-451)
 * CALLED BY: 10_BD_Campaign_Creation.gs (createMPCCampaign)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG)
 */

// ============================================================================
// CONFIG READERS
// ============================================================================

/**
 * Read Prompt_Config tab — returns active prompts keyed by Prompt_Key
 * @returns {Object} - { Anonymization: { text, active }, Campaign_Generation: {...}, ... }
 */
function readPromptConfig_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetPromptConfig);

  if (!sheet) throw new Error('Prompt_Config sheet not found');

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colKey = headers.indexOf('Prompt_Key');
  var colText = headers.indexOf('Prompt_Text');
  var colActive = headers.indexOf('Active');

  var config = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var key = String(row[colKey] || '').trim();
    var active = String(row[colActive] || '').trim();

    if (key && active === 'Yes') {
      config[key] = {
        text: String(row[colText] || ''),
        active: true
      };
    }
  }

  return config;
}

/**
 * Read Cadence_Config tab — returns steps keyed by Variant_ID
 * @returns {Object} - { A: [{step_no, day, channel, purpose, ...}], B: [...], C: [...] }
 */
function readCadenceConfig_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetCadenceConfig);

  if (!sheet) throw new Error('Cadence_Config sheet not found');

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colVariant = headers.indexOf('Variant_ID');
  var colStepNo = headers.indexOf('Step_No');
  var colDay = headers.indexOf('Day');
  var colChannel = headers.indexOf('Channel');
  var colPurpose = headers.indexOf('Purpose');
  var colTimeSlot = headers.indexOf('Time_Slot');
  var colColor = headers.indexOf('Color');
  var colPairedWith = headers.indexOf('Paired_With');
  var colDisplayLabel = headers.indexOf('Display_Label');

  var config = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var variant = String(row[colVariant] || '').trim();

    if (!variant) continue;

    if (!config[variant]) config[variant] = [];

    config[variant].push({
      step_no: parseInt(row[colStepNo]) || 0,
      day: parseInt(row[colDay]) || 0,
      channel: String(row[colChannel] || ''),
      purpose: String(row[colPurpose] || ''),
      time_slot: String(row[colTimeSlot] || ''),
      color: String(row[colColor] || ''),
      paired_with: row[colPairedWith] ? parseInt(row[colPairedWith]) : null,
      display_label: String(row[colDisplayLabel] || '')
    });
  }

  // Sort each variant's steps by step_no
  var variantKeys = Object.keys(config);
  for (var v = 0; v < variantKeys.length; v++) {
    config[variantKeys[v]].sort(function(a, b) { return a.step_no - b.step_no; });
  }

  return config;
}

// ============================================================================
// DATA READ HELPERS
// ============================================================================

/**
 * Batch read HM data from BD_Contacts for selected keys
 * @param {string[]} hmKeys - Array of Composite_Key values
 * @returns {Object} - Map of key -> hmData object
 */
function getHMDataBatch_(hmKeys) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.sheetBD);

  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var cols = CONFIG.bdContactCols;

  var keySet = {};
  for (var k = 0; k < hmKeys.length; k++) {
    keySet[hmKeys[k]] = true;
  }

  var result = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var key = row[cols.compositeKey];

    if (keySet[key]) {
      var name = String(row[cols.hmName] || '').trim();
      result[key] = {
        key: key,
        name: name,
        firstName: parseFirstName_(name),
        title: String(row[cols.hmTitle] || ''),
        company: String(row[cols.company] || ''),
        companyDomain: String(row[cols.companyDomain] || ''),
        email: String(row[cols.primaryEmail] || ''),
        phone: String(row[cols.primaryPhone] || ''),
        linkedinUrl: String(row[cols.linkedinUrl] || ''),
        firstDegree: String(row[cols.firstDegree] || '')
      };
    }
  }

  return result;
}
