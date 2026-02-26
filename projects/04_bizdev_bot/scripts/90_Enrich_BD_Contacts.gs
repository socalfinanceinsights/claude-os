/**
 * 90_Enrich_BD_Contacts.gs
 * @execution manual
 *
 * FULL FLAT REFRESH — stamps ALL lookup columns on BD_Contacts with static values.
 * BD_Contacts has ZERO formulas after this runs. Fully sortable.
 *
 * Sources:
 *   B  LinkedIn_URL    ← HM_Person_Master (col 1)
 *   C  1st_Degree      ← HM_Signals_Master (col 6)
 *   D  HM_Name         ← HM_Person_Master (col 2)
 *   E  HM_Title        ← HM_Person_Master (col 3)
 *   F  Company         ← HM_Person_Master (col 4)
 *   G  Company_Domain  ← HM_Person_Master (col 5)
 *   I  Industry        ← Company_Master (col 12)
 *   J  Region          ← Company_Master HQ City → CountyRegion_Lookup
 *   K  Primary_Email   ← HM_Person_Master (col 6)
 *   L  Primary_Phone   ← HM_Person_Master (col 7)
 *   M  Secondary_Phone ← HM_Person_Master (col 14)
 *   W  Company_ICP     ← ICP_Score (col 19)
 *
 * Menu: ICP Tools > Refresh BD Contacts (Full Flat)
 * Version: 2.0.0
 * Last Updated: 2026-02-16
 */

/**
 * Full flat refresh of BD_Contacts — replaces all formulas with static values
 * Run after imports or any time source data changes
 */
function refreshBDContactsFull() {
  try {
    var ss = getSpreadsheet_();

    // --- Read all source sheets ---
    var bdSheet = ss.getSheetByName(CONFIG.sheetBD);
    if (!bdSheet) throw new Error('BD_Contacts sheet not found');

    var hmSheet = ss.getSheetByName(CONFIG.sheetHM);
    if (!hmSheet) throw new Error('HM_Person_Master sheet not found');

    var companySheet = ss.getSheetByName(CONFIG.sheetCompany);
    if (!companySheet) throw new Error('Company_Master sheet not found');

    var signalsSheet = ss.getSheetByName(CONFIG.sheetSignals);
    if (!signalsSheet) throw new Error('HM_Signals_Master sheet not found');

    var regionSheet = ss.getSheetByName('CountyRegion_Lookup');
    if (!regionSheet) throw new Error('CountyRegion_Lookup sheet not found');

    var icpSheet = ss.getSheetByName(CONFIG.sheetICPScore);
    if (!icpSheet) throw new Error('ICP_Score sheet not found');

    var bdData = bdSheet.getDataRange().getValues();
    var hmData = hmSheet.getDataRange().getValues();
    var companyData = companySheet.getDataRange().getValues();
    var signalsData = signalsSheet.getDataRange().getValues();
    var regionData = regionSheet.getDataRange().getValues();

    var icpLastRow = icpSheet.getLastRow();
    var icpData = icpLastRow > 1
      ? icpSheet.getRange(2, 1, icpLastRow - 1, 20).getValues()
      : [];

    // --- Build lookup maps ---

    // HM_Person_Master: key -> person data
    var hmMap = {};
    for (var h = 1; h < hmData.length; h++) {
      var hmKey = String(hmData[h][0] || '').trim();
      if (!hmKey) continue;
      hmMap[hmKey] = {
        linkedin: String(hmData[h][1] || '').trim(),
        name: String(hmData[h][2] || '').trim(),
        title: String(hmData[h][3] || '').trim(),
        company: String(hmData[h][4] || '').trim(),
        domain: String(hmData[h][5] || '').trim(),
        email: String(hmData[h][6] || '').trim(),
        phone: String(hmData[h][7] || '').trim(),
        secondaryPhone: String(hmData[h][14] || '').trim()
      };
    }

    // Company_Master: domain -> {industry, hqCity}
    var companyMap = {};
    for (var c = 1; c < companyData.length; c++) {
      var cDomain = cleanDomain_(String(companyData[c][0] || ''));
      if (!cDomain) continue;
      companyMap[cDomain] = {
        industry: String(companyData[c][12] || '').trim(),
        hqCity: String(companyData[c][8] || '').trim()
      };
    }

    // CountyRegion_Lookup: city -> Regional Terminology
    var cityRegionMap = {};
    for (var g = 1; g < regionData.length; g++) {
      var city = String(regionData[g][0] || '').trim().toLowerCase();
      var terminology = String(regionData[g][3] || '').trim();
      if (city && terminology) {
        cityRegionMap[city] = terminology;
      }
    }

    // HM_Signals_Master: key -> 1st_Degree
    var signalsMap = {};
    for (var s = 1; s < signalsData.length; s++) {
      var sKey = String(signalsData[s][0] || '').trim();
      if (!sKey) continue;
      var fdVal = String(signalsData[s][6] || '').trim();
      if (fdVal) signalsMap[sKey] = fdVal;
    }

    // ICP_Score: domain -> ICP Total (col T = index 19)
    var icpMap = {};
    for (var i = 0; i < icpData.length; i++) {
      var iDomain = String(icpData[i][0] || '').trim().toLowerCase();
      if (iDomain) icpMap[iDomain] = icpData[i][19];
    }

    // --- Build output columns ---
    var bdCols = CONFIG.bdContactCols;
    var totalRows = bdData.length - 1;
    if (totalRows <= 0) {
      ss.toast('No data rows in BD_Contacts', 'Refresh Skipped');
      return;
    }

    // Contiguous block 1: B-G (cols 1-6, indices 1-6)
    var blockBG = [];
    // Separate block: I-J (cols 8-9)
    var blockIJ = [];
    // Separate block: K-M (cols 10-12)
    var blockKM = [];
    // Single col: W (col 22)
    var blockW = [];

    var counts = { linkedin: 0, name: 0, industry: 0, region: 0, firstDegree: 0, email: 0, phone: 0, icp: 0 };

    for (var r = 1; r < bdData.length; r++) {
      var row = bdData[r];
      var rowKey = String(row[bdCols.compositeKey] || '').trim();
      var hm = rowKey ? hmMap[rowKey] : null;
      var rowDomain = hm ? cleanDomain_(hm.domain) : cleanDomain_(String(row[bdCols.companyDomain] || ''));
      var companyInfo = rowDomain ? companyMap[rowDomain] : null;

      // B-G: LinkedIn, 1st_Degree, Name, Title, Company, Domain
      var linkedin = hm ? hm.linkedin : '';
      var firstDegree = rowKey ? (signalsMap[rowKey] || '') : '';
      var name = hm ? hm.name : '';
      var title = hm ? hm.title : '';
      var company = hm ? hm.company : '';
      var domain = hm ? hm.domain : '';

      blockBG.push([linkedin, firstDegree, name, title, company, domain]);

      // I-J: Industry, Region
      var industry = companyInfo ? companyInfo.industry : '';
      var region = '';
      if (companyInfo && companyInfo.hqCity) {
        region = cityRegionMap[companyInfo.hqCity.toLowerCase()] || 'Remote/Other';
      }
      blockIJ.push([industry, region]);

      // K-M: Email, Phone, SecondaryPhone
      var email = hm ? hm.email : '';
      var phone = hm ? hm.phone : '';
      var secPhone = hm ? hm.secondaryPhone : '';
      blockKM.push([email, phone, secPhone]);

      // W: ICP Score
      var icpScore = rowDomain ? (icpMap[rowDomain] !== undefined ? icpMap[rowDomain] : '') : '';
      blockW.push([icpScore]);

      // Counts
      if (linkedin) counts.linkedin++;
      if (name) counts.name++;
      if (industry) counts.industry++;
      if (region) counts.region++;
      if (firstDegree) counts.firstDegree++;
      if (email) counts.email++;
      if (phone) counts.phone++;
      if (icpScore !== '') counts.icp++;
    }

    // --- Batch write (4 writes total) ---
    bdSheet.getRange(2, 2, totalRows, 6).setValues(blockBG);       // B:G
    bdSheet.getRange(2, 9, totalRows, 2).setValues(blockIJ);       // I:J
    bdSheet.getRange(2, 11, totalRows, 3).setValues(blockKM);      // K:M
    bdSheet.getRange(2, 23, totalRows, 1).setValues(blockW);       // W

    // Summary
    var summary = totalRows + ' rows refreshed: ' +
      counts.name + ' names, ' +
      counts.email + ' emails, ' +
      counts.industry + ' industries, ' +
      counts.region + ' regions, ' +
      counts.icp + ' ICP scores, ' +
      counts.firstDegree + ' 1st-degree';

    ss.toast(summary, 'BD Contacts Refreshed (Full Flat)', 10);
    logCampaignAction('refreshBDContactsFull: ' + summary);

  } catch (error) {
    logCampaignError('refreshBDContactsFull failed: ' + error.message);
    SpreadsheetApp.getUi().alert('Error', 'Refresh failed:\n' + error.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Legacy alias — redirects to full flat refresh
 */
function refreshBDContactsColumns() {
  refreshBDContactsFull();
}
