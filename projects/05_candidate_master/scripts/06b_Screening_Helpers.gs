/**
 * @file 06b_Screening_Helpers.gs
 * Location normalization, candidate retrieval, and recent screen helpers
 *
 * PURPOSE: Location waterfall expansion, candidate data retrieval with pre-filtering,
 *          and recent screen config lookups for the sidebar
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00f_Gemini_API.gs
 *
 * Config tab management, recent screen queries, results tab creation,
 * and matrix formatting: see 06c_Screening_Config_Helpers.gs
 *
 * @execution manual
 */

// ============================================
// LOCATION NORMALIZATION (Waterfall Lookup)
// ============================================

/**
 * Expand location search terms using Location_Normalization lookup table.
 * Supports waterfall hierarchy: City → Sub-Region → County
 *
 * Examples:
 *   "Irvine"      → ["irvine"]                    (exact city match)
 *   "South OC"    → ["aliso viejo", "dana point", "irvine", ...]  (all cities in sub-region)
 *   "OC"          → all cities in Orange County    (county-level match via alias)
 *   "Corona"      → ["corona"]                    (pass-through, not in lookup table)
 *
 * @param {string} rawInput - Comma-separated location filter string from sidebar
 * @returns {Array<string>} - Lowercase city/term strings to match against candidate Location
 */
function expandLocationTerms(rawInput) {
  if (!rawInput) return [];

  const inputTerms = rawInput.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

  // Load normalization table
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const normSheet = ss.getSheetByName(TAB_LOCATION_NORMALIZATION);
  if (!normSheet) {
    Logger.log('WARNING: Location_Normalization tab not found. Falling back to raw terms.');
    return inputTerms;
  }

  const normData = normSheet.getDataRange().getValues();
  if (normData.length <= 1) return inputTerms;

  // Build lookup arrays (skip header row)
  const cities = [];      // Column A: City
  const counties = [];    // Column B: County
  const subRegions = [];  // Column D: Regional Terminology

  for (let i = 1; i < normData.length; i++) {
    cities.push((normData[i][0] || '').toString().trim().toLowerCase());
    counties.push((normData[i][1] || '').toString().trim().toLowerCase());
    subRegions.push((normData[i][3] || '').toString().trim().toLowerCase());
  }

  // County aliases — shorthand → full county name
  const countyAliases = {
    'oc': 'orange county',
    'la': 'los angeles county',
    'sd': 'san diego county'
  };

  const expandedCities = new Set();

  for (const term of inputTerms) {
    let matched = false;

    // 1. Check if term matches a sub-region (Regional Terminology)
    const subRegionMatches = [];
    for (let i = 0; i < subRegions.length; i++) {
      if (subRegions[i] === term) {
        subRegionMatches.push(cities[i]);
      }
    }
    if (subRegionMatches.length > 0) {
      subRegionMatches.forEach(c => expandedCities.add(c));
      matched = true;
    }

    // 2. Check if term matches a county (full name or alias)
    const countyName = countyAliases[term] || term;
    const countyMatches = [];
    for (let i = 0; i < counties.length; i++) {
      if (counties[i] === countyName) {
        countyMatches.push(cities[i]);
      }
    }
    if (countyMatches.length > 0) {
      countyMatches.forEach(c => expandedCities.add(c));
      matched = true;
    }

    // 3. Check if term matches a specific city
    if (cities.includes(term)) {
      expandedCities.add(term);
      matched = true;
    }

    // 4. Pass-through: term not in lookup table (e.g. "Corona", "Riverside")
    if (!matched) {
      expandedCities.add(term);
    }
  }

  Logger.log(`Location expansion: "${rawInput}" → ${expandedCities.size} search terms`);
  return Array.from(expandedCities);
}

// ============================================
// CANDIDATE DATA RETRIEVAL
// ============================================

/**
 * Get candidates from Candidate_Master, applying pre-filters
 * Returns compact profiles ready for Gemini ranking
 *
 * @param {Object} filters - { hasData: bool, location: string|null, excludeAboveLevel: bool, aboveLevelTitles: string[] }
 * @returns {Array<Object>} - Array of candidate profile objects
 */
function getCandidatesForScreening(filters) {
  const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  // Expand location terms ONCE before the loop (waterfall lookup)
  const locationTerms = filters.location ? expandLocationTerms(filters.location) : [];

  const candidates = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const fullName = row[colMap['Full_Name']] || '';

    // Skip empty rows
    if (!fullName) continue;

    const currentTitle = (row[colMap['Current_Title']] || '').toString().trim();
    const keySkills = (row[colMap['Key_Skills']] || '').toString().trim();
    const notesSummary = (row[colMap['Notes_Summary']] || '').toString().trim();
    const location = (row[colMap['Location']] || '').toString().trim();
    const liPersonal = (row[colMap['LI_Personal']] || '').toString().trim();

    // Skip personal contacts (LI_Personal = YES)
    if (liPersonal === 'YES') continue;

    // Filter: has data (title OR skills OR notes)
    if (filters.hasData && !currentTitle && !keySkills && !notesSummary) {
      continue;
    }

    // Filter: location — waterfall match via Location_Normalization
    // Supports city names, sub-regions (South OC, SFV), county aliases (OC, LA, SD)
    if (locationTerms.length > 0) {
      const locLower = location.toLowerCase();
      const locMatch = locationTerms.some(term => locLower.includes(term));
      if (!locMatch) {
        continue;
      }
    }

    // Filter: title keywords — include only candidates whose title contains at least one keyword
    if (filters.titleKeywords && currentTitle) {
      const keywords = filters.titleKeywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
      const titleLower = currentTitle.toLowerCase();
      const hasMatch = keywords.some(k => titleLower.includes(k));
      if (!hasMatch) continue;
    }

    // Filter: exclude above-level titles
    if (filters.excludeAboveLevel && filters.aboveLevelTitles && currentTitle) {
      const titleLower = currentTitle.toLowerCase();
      const isAbove = filters.aboveLevelTitles.some(t => titleLower.includes(t.toLowerCase()));
      if (isAbove) continue;
    }

    candidates.push({
      uid: (row[colMap['UID']] || '').toString(),
      full_name: fullName.toString().trim(),
      current_title: currentTitle,
      current_company: (row[colMap['Current_Company']] || '').toString().trim(),
      key_skills: keySkills,
      comp_target: (row[colMap['Comp_Target']] || '').toString().trim(),
      location: location,
      quality_tier: (row[colMap['Quality_Tier']] || '').toString().trim(),
      notes_summary: notesSummary,
      linkedin_url: (row[colMap['LinkedIn_URL']] || '').toString().trim(),
      email: (row[colMap['Email']] || '').toString().trim(),
      phone: (row[colMap['Phone']] || '').toString().trim(),
      reasons_for_change: (row[colMap['Reasons_for_Change']] || '').toString().trim()
    });
  }

  return candidates;
}

/**
 * Quick count of candidates matching filters (no full data load)
 * Used for the sidebar candidate count display
 *
 * @param {Object} filters - Same as getCandidatesForScreening
 * @returns {number} - Candidate count
 */
function getCandidateCountForScreening(filters) {
  return getCandidatesForScreening(filters).length;
}

// Config tab management, recent screen queries, results tab creation,
// and matrix formatting: see 06c_Screening_Config_Helpers.gs

// ============================================
// REGION COLUMN STAMPER
// ============================================

/**
 * Stamp Region column in Candidate_Master using Location_Normalization table.
 * Maps candidate Location values to Regional Terminology (Col D of normalization tab).
 * Adds Region column after last existing column if not present.
 *
 * Match priority:
 *   1. Remote/WFH keyword → "Remote"
 *   2. City substring match → Col D value (e.g. "South OC", "SFV", "Central SD")
 *   3. County keyword match → county name (e.g. "Orange County", "Los Angeles County")
 *   4. No match → "Other"
 *
 * Idempotent: skips rows that already have a Region value.
 * Run: manually from menu, or after bulk imports to stamp new rows.
 *
 * @execution manual
 */
function stampRegionColumn() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const masterSheet = ss.getSheetByName(TAB_CANDIDATE_MASTER);
  const normSheet = ss.getSheetByName(TAB_LOCATION_NORMALIZATION);

  if (!normSheet) {
    SpreadsheetApp.getUi().alert('ERROR: Location_Normalization tab not found.');
    return;
  }

  // Build city → regional terminology map from normalization table
  // Col A = City, Col D = Regional Terminology
  const normData = normSheet.getDataRange().getValues();
  const cityRegionMap = [];
  for (let i = 1; i < normData.length; i++) {
    const city = (normData[i][0] || '').toString().trim();
    const region = (normData[i][3] || '').toString().trim();
    if (city && region) {
      cityRegionMap.push({ city: city.toLowerCase(), region: region });
    }
  }
  // Sort by city length descending: "La Habra Heights" matched before "La Habra"
  cityRegionMap.sort((a, b) => b.city.length - a.city.length);

  // County-level fallbacks for entries like "Orange County", "Los Angeles", "San Diego"
  const countyFallbacks = [
    { key: 'orange county', region: 'Orange County' },
    { key: 'los angeles county', region: 'Los Angeles County' },
    { key: 'los angeles', region: 'Los Angeles County' },
    { key: 'san diego county', region: 'San Diego County' },
    { key: 'san diego', region: 'San Diego County' },
    { key: 'riverside county', region: 'Inland Empire' },
    { key: 'riverside', region: 'Inland Empire' },
    { key: 'san bernardino', region: 'Inland Empire' },
    { key: 'ventura county', region: 'Ventura County' },
  ];

  // Read master sheet
  const masterData = masterSheet.getDataRange().getValues();
  const headers = masterData[0];
  const locCol = headers.indexOf('Location');

  if (locCol === -1) {
    SpreadsheetApp.getUi().alert('ERROR: Location column not found in Candidate_Master.');
    return;
  }

  // Find or add Region column
  let regionCol = headers.indexOf('Region');
  if (regionCol === -1) {
    regionCol = headers.length;
    masterSheet.getRange(1, regionCol + 1).setValue('Region');
    Logger.log('Added Region column at column ' + (regionCol + 1));
  }

  // Stamp region for each data row
  const updates = [];
  let matched = 0, unmatched = 0, blank = 0, skipped = 0;

  for (let i = 1; i < masterData.length; i++) {
    const existing = (masterData[i][regionCol] || '').toString().trim();
    if (existing) {
      updates.push([existing]); // already stamped — preserve
      skipped++;
      continue;
    }

    const rawLocation = (masterData[i][locCol] || '').toString().trim();
    if (!rawLocation) {
      updates.push(['']);
      blank++;
      continue;
    }

    const locLower = rawLocation.toLowerCase();
    let region = '';

    // 1. Remote check
    if (locLower.includes('remote') || locLower.includes('wfh') || locLower.includes('work from home')) {
      region = 'Remote';
    }

    // 2. City match (longest city names first to avoid partial collisions)
    if (!region) {
      for (const entry of cityRegionMap) {
        if (locLower.includes(entry.city)) {
          region = entry.region;
          break;
        }
      }
    }

    // 3. County-level fallback
    if (!region) {
      for (const fb of countyFallbacks) {
        if (locLower.includes(fb.key)) {
          region = fb.region;
          break;
        }
      }
    }

    // 4. No match
    if (!region) {
      region = 'Other';
      unmatched++;
    } else {
      matched++;
    }

    updates.push([region]);
  }

  // Batch write all region values
  if (updates.length > 0) {
    masterSheet.getRange(2, regionCol + 1, updates.length, 1).setValues(updates);
  }

  Logger.log(`stampRegionColumn: ${matched} matched, ${unmatched} unmatched (Other), ${blank} blank, ${skipped} already had value`);
  SpreadsheetApp.getUi().alert(
    'Region Column Stamped',
    `Matched: ${matched}\nOther (no match): ${unmatched}\nBlank (no Location): ${blank}\nAlready had value: ${skipped}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
