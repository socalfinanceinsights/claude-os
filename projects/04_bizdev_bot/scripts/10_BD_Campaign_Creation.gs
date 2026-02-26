/**
 * 10_BD_Campaign_Creation.gs
 * @execution manual
 * Campaign creation orchestrator — v2 multi-channel engine
 * Calls anonymization (10a), market intel (10b), generation (10c) modules
 * Writes to BD_Campaigns, BD_Campaign_Steps, Campaign_Drafts, BD_Contacts
 */

// Dialog & server functions moved to 10f_Campaign_Dialog.gs:
// showMPCCampaignDialog, getCampaignKinds, getHiringManagersForDialog
// Config readers moved to 10e_Campaign_Config_Readers.gs: readPromptConfig_, readCadenceConfig_

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Create campaign for selected hiring managers
 * @param {Object} params - { candidateWriteup, selectedHMs, startDate, campaignKind, onePagerURL }
 */
function createMPCCampaign(params) {
  var ss = getSpreadsheet_();

  try {
    // Validate inputs
    if (!params.candidateWriteup || params.candidateWriteup.trim() === '') {
      throw new Error('Candidate writeup is required');
    }

    if (!params.selectedHMs || params.selectedHMs.length === 0) {
      throw new Error('Please select at least one hiring manager');
    }

    if (!params.startDate) {
      throw new Error('Start date is required');
    }

    // Read prompt config
    var promptConfig = readPromptConfig_();

    if (!promptConfig.Campaign_Generation) {
      throw new Error('Campaign_Generation prompt not found or inactive in Prompt_Config');
    }

    // Read cadence config
    var cadenceConfig = readCadenceConfig_();
    var variantIds = ['A', 'B', 'C'];

    // Get HM data for all selected HMs
    var hmDataMap = getHMDataBatch_(params.selectedHMs);

    // Generate Campaign_ID
    var campaignKindShort = (params.campaignKind || 'MPC').split(' ')[0].replace(/[^A-Za-z]/g, '');
    var roleMatch = params.candidateWriteup.match(/\b(Controller|CFO|VP.?Finance|Director|Senior.?Accountant|Staff.?Accountant|Accounting.?Manager)\b/i);
    var role = roleMatch ? roleMatch[1].replace(/\s+/g, '_') : 'Finance';
    var locationMatch = params.candidateWriteup.match(/\b(Los.?Angeles|Irvine|San.?Diego|Orange.?County|SoCal|LA|OC|SD)\b/i);
    var location = locationMatch ? locationMatch[1].replace(/\s+/g, '_') : 'SoCal';
    var campaignID = campaignKindShort + '_' + role + '_' + location + '_' + params.startDate;

    // === STEP 1: Anonymize ===
    logCampaignAction('Step 1: Anonymizing candidate writeup...');
    var anonymizationPrompt = promptConfig.Anonymization ? promptConfig.Anonymization.text : 'Anonymize this candidate writeup into a 150-250 word MPC teaser. Remove all identifying information (names, companies, schools). Focus on credentials, skills, accomplishments, and value proposition.';
    var candidateTeaser = anonymizeCandidate(params.candidateWriteup, anonymizationPrompt);

    // === STEP 2: Market Intel ===
    logCampaignAction('Step 2: Fetching market intelligence...');
    var uniqueDomains = [];
    var domainSet = {};
    for (var d = 0; d < params.selectedHMs.length; d++) {
      var hmKey = params.selectedHMs[d];
      var hm = hmDataMap[hmKey];
      if (hm && hm.companyDomain) {
        var cleaned = cleanDomain_(hm.companyDomain);
        if (cleaned && !domainSet[cleaned]) {
          domainSet[cleaned] = true;
          uniqueDomains.push(cleaned);
        }
      }
    }
    var marketIntel = fetchMarketIntel(uniqueDomains);

    // === STEP 3-5: Generate per HM ===
    logCampaignAction('Steps 3-5: Generating campaign copy for ' + params.selectedHMs.length + ' HMs...');

    var processedCount = 0;
    var failedCount = 0;
    var failures = [];
    var hmResults = [];
    var variantCounts = { A: 0, B: 0, C: 0 };

    for (var h = 0; h < params.selectedHMs.length; h++) {
      var hmKey = params.selectedHMs[h];
      var hmData = hmDataMap[hmKey];

      if (!hmData) {
        failures.push(hmKey + ': HM not found in BD_Contacts');
        failedCount++;
        continue;
      }

      try {
        // Assign variant via round-robin
        var variantId = variantIds[h % 3];
        var cadenceSteps = cadenceConfig[variantId];

        if (!cadenceSteps || cadenceSteps.length === 0) {
          failures.push(hmData.name + ': No cadence config for variant ' + variantId);
          failedCount++;
          continue;
        }

        // Get market intel for this HM's domain
        var hmDomain = cleanDomain_(hmData.companyDomain);
        var hmIntel = hmDomain ? (marketIntel[hmDomain] || null) : null;

        // Build context for generateCampaignCopy
        var context = {
          candidateTeaser: candidateTeaser,
          hmName: hmData.name,
          hmFirstName: hmData.firstName,
          hmTitle: hmData.title,
          company: hmData.company,
          companyDomain: hmData.companyDomain,
          primaryEmail: hmData.email,
          linkedinUrl: hmData.linkedinUrl,
          firstDegree: hmData.firstDegree,
          marketIntel: hmIntel,
          cadenceSteps: cadenceSteps,
          generationPrompt: promptConfig.Campaign_Generation.text,
          voiceRules: promptConfig.Voice_Rules ? promptConfig.Voice_Rules.text : '',
          formatConstraints: promptConfig.Format_Constraints ? promptConfig.Format_Constraints.text : '',
          mpcStrategy: promptConfig.MPC_Strategy ? promptConfig.MPC_Strategy.text : '',
          linkedinRules: promptConfig.LinkedIn_Rules ? promptConfig.LinkedIn_Rules.text : '',
          mpcComponents: promptConfig.MPC_Components ? promptConfig.MPC_Components.text : ''
        };

        // Generate 8 touches
        var touches = generateCampaignCopy(context);

        hmResults.push({
          hmData: hmData,
          variantId: variantId,
          touches: touches,
          cadenceSteps: cadenceSteps
        });

        variantCounts[variantId]++;
        processedCount++;

      } catch (hmError) {
        logCampaignError('Error processing HM ' + hmKey + ': ' + hmError.message);
        failures.push((hmData ? hmData.name : hmKey) + ': ' + hmError.message);
        failedCount++;
      }
    }

    // === DATA WRITES ===
    if (hmResults.length > 0) {
      logCampaignAction('Writing campaign data...');

      // Build variant distribution string
      var variantDist = 'A:' + variantCounts.A + ', B:' + variantCounts.B + ', C:' + variantCounts.C;

      // Write campaign record
      writeCampaignRecord_(campaignID, params, candidateTeaser, variantDist);

      // Write campaign steps (snapshot of cadence config for variants used)
      var variantsUsed = [];
      if (variantCounts.A > 0) variantsUsed.push('A');
      if (variantCounts.B > 0) variantsUsed.push('B');
      if (variantCounts.C > 0) variantsUsed.push('C');
      writeCampaignSteps_(campaignID, cadenceConfig, variantsUsed);

      // Write campaign drafts
      writeCampaignDrafts_(campaignID, hmResults);

      // Update BD_Contacts
      var hmKeysProcessed = hmResults.map(function(r) { return r.hmData.key; });
      updateBDContacts_(hmKeysProcessed, campaignID);
    }

    // === SUMMARY ===
    var totalTouches = processedCount * 8;
    var message = 'Campaign Created: ' + campaignID + '\n\n';
    message += processedCount + ' HMs processed\n';
    message += totalTouches + ' touches generated\n';
    message += 'Variants: ' + (variantCounts.A > 0 ? 'A:' + variantCounts.A + ' ' : '') + (variantCounts.B > 0 ? 'B:' + variantCounts.B + ' ' : '') + (variantCounts.C > 0 ? 'C:' + variantCounts.C : '');

    if (failedCount > 0) {
      message += '\n\n' + failedCount + ' failures:\n';
      message += failures.join('\n');
    }

    SpreadsheetApp.getUi().alert('Campaign Created', message, SpreadsheetApp.getUi().ButtonSet.OK);

    return { success: true, campaignID: campaignID, processedCount: processedCount, failedCount: failedCount };

  } catch (error) {
    logCampaignError('Campaign creation failed: ' + error.message);
    SpreadsheetApp.getUi().alert('Error', 'Campaign creation failed:\n' + error.message, SpreadsheetApp.getUi().ButtonSet.OK);
    return { success: false, error: error.message };
  }
}

// Data read helpers moved to 10e_Campaign_Config_Readers.gs: getHMDataBatch_
// Data write helpers moved to 10d_Campaign_Data_Helpers.gs:
// writeCampaignRecord_, writeCampaignSteps_, writeCampaignDrafts_, updateBDContacts_
