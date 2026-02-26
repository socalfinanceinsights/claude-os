/**
 * PLACEMENT ENRICHMENT - Domain Lookup + HM Key Matching
 *
 * Fills in Placements_Log Col D (HM_Composite_Key) and Col F (Client_Domain)
 *
 * TWO ENRICHMENT STEPS:
 *  1. HM Composite Key: Direct name match against HM_Person_Master Col C
 *     - Extracts HM name from Notes field (Col N)
 *     - Case-insensitive match against Person_Master
 *     - Unmatched HMs left blank (they'll get linked when added to Person_Master later)
 *
 *  2. Client Domain: Gemini lookup for company name → website domain
 *     - Only calls Gemini for rows where Client_Domain (Col F) is blank
 *     - Batches companies to minimize API calls (one call per unique company)
 *     - Writes resolved domains back to Placements_Log Col F
 *
 * USAGE:
 * - Run from menu: BD Tracker > ICP Tools > Enrich Placement Domains
 * - Safe to run multiple times (skips already-enriched rows)
 * - Processes max 30 unique companies per run via Gemini
 */

function Enrich_Placement_Domains() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const plSheet = ss.getSheetByName('Placements_Log');

  if (!plSheet) {
    ui.alert('Error', 'Placements_Log sheet not found', ui.ButtonSet.OK);
    return;
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    ui.alert('API Key Missing', 'GEMINI_API_KEY not found in Script Properties.', ui.ButtonSet.OK);
    return;
  }

  const lastRow = plSheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('No Data', 'No placements found in Placements_Log', ui.ButtonSet.OK);
    return;
  }

  // Read all placement data (A:K)
  const data = plSheet.getRange(2, 1, lastRow - 1, 11).getValues();

  // --- STEP 1: HM Composite Key Matching ---
  const hmResult = matchHMKeys_(ss, data, plSheet);

  // --- STEP 2: Company Domain Lookup ---
  const domainResult = lookupDomains_(ss, data, plSheet, apiKey);

  // Summary
  ui.alert(
    'Enrichment Complete',
    `HM Keys: ${hmResult.matched} matched, ${hmResult.skipped} already set, ${hmResult.unmatched} not in Person_Master\n` +
    `Domains: ${domainResult.resolved} resolved, ${domainResult.skipped} already set, ${domainResult.errors} errors`,
    ui.ButtonSet.OK
  );

  Logger.log(`Enrichment complete. HM: ${hmResult.matched} matched, ${hmResult.unmatched} unmatched. Domains: ${domainResult.resolved} resolved, ${domainResult.errors} errors.`);
}

/**
 * Headless version for automated triggers (no UI calls)
 * Returns {hmMatched, hmUnmatched, domainsResolved, domainErrors}
 */
function enrichPlacementDomainsHeadless_(apiKey) {
  const ss = getSpreadsheet_();
  const plSheet = ss.getSheetByName('Placements_Log');

  if (!plSheet) {
    Logger.log('Placements_Log sheet not found');
    return { hmMatched: 0, hmUnmatched: 0, domainsResolved: 0, domainErrors: 0 };
  }

  const lastRow = plSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No placements found');
    return { hmMatched: 0, hmUnmatched: 0, domainsResolved: 0, domainErrors: 0 };
  }

  const data = plSheet.getRange(2, 1, lastRow - 1, 14).getValues();

  const hmResult = matchHMKeys_(ss, data, plSheet);
  const domainResult = lookupDomains_(ss, data, plSheet, apiKey);

  return {
    hmMatched: hmResult.matched,
    hmUnmatched: hmResult.unmatched,
    domainsResolved: domainResult.resolved,
    domainErrors: domainResult.errors
  };
}

// HM key matching, domain lookup, and Gemini domain resolver moved to 95d1_Placement_Domain_Helpers.gs:
// matchHMKeys_, lookupDomains_, resolveDomainsWithGemini_
