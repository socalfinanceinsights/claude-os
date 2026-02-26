/**
 * 15_Behavioral_Rollup.gs
 * SDI Scout - Behavioral Score Rollup & Funding Sweep
 * Version: 1.0.0
 *
 * PURPOSE: Reads Company_Events, aggregates decayed points by domain + type,
 *          writes to Company_Behavioral_Score. Also handles Capital → Company_Master
 *          funding upsert.
 * DEPENDENCIES: 13_SDI_Config.gs, 00_Brain_Config.gs
 * SHARED BY: SDI Scout + Market Intel Bot (future)
 */

// ============================================
// BEHAVIORAL ROLLUP
// ============================================

/**
 * Aggregate Company_Events decayed points → Company_Behavioral_Score.
 * Reads events, groups by domain, caps per type, writes B/C/D.
 * Does NOT touch cols E (Capital_Pts formula) or F (Behavioral_Total formula).
 *
 * @param {Array<string>|null} affectedDomains - Domains to recalculate (null = all with events)
 * @returns {Object} - { domainsUpdated: number, details: Object }
 */
function runBehavioralRollup_(affectedDomains) {
  const ss = SpreadsheetApp.openById(SDI_CONFIG.spreadsheetId);
  const cols = SDI_CONFIG.eventCols;
  const caps = SDI_CONFIG.caps;

  // 1. Read Company_Events (skip header)
  const eventsSheet = ss.getSheetByName(SDI_CONFIG.sheetEvents);
  const lastRow = eventsSheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('Behavioral rollup: No events to process');
    return { domainsUpdated: 0, details: {} };
  }

  const eventsData = eventsSheet.getRange(2, 1, lastRow - 1, 12).getValues(); // A-L

  // 2. Group decayed points by domain + event type
  const domainScores = {}; // { domain: { Jobs: sum, Leadership: sum, 'Infra/Compliance': sum } }

  for (const row of eventsData) {
    const domain = String(row[cols.domain] || '').trim().toLowerCase();
    if (!domain) continue;

    const eventType = String(row[cols.eventType] || '').trim();
    const decayed = parseFloat(row[cols.decayedPoints]);

    // Skip Capital events (scored via formula path, not rollup)
    if (eventType === 'Capital' || isNaN(decayed) || decayed <= 0) continue;
    // Only aggregate recognized non-Capital types
    if (!['Jobs', 'Leadership', 'Infra/Compliance'].includes(eventType)) continue;

    if (!domainScores[domain]) {
      domainScores[domain] = { 'Jobs': 0, 'Leadership': 0, 'Infra/Compliance': 0 };
    }
    domainScores[domain][eventType] += decayed;
  }

  // 3. Apply caps
  for (const domain in domainScores) {
    const s = domainScores[domain];
    s['Jobs'] = Math.min(s['Jobs'], caps.jobs);
    s['Leadership'] = Math.min(s['Leadership'], caps.leadership);
    s['Infra/Compliance'] = Math.min(s['Infra/Compliance'], caps.infra);
  }

  // 4. Filter to affected domains if specified
  let domainsToWrite = Object.keys(domainScores);
  if (affectedDomains && affectedDomains.length > 0) {
    const affectedSet = new Set(affectedDomains.map(d => d.toLowerCase()));
    domainsToWrite = domainsToWrite.filter(d => affectedSet.has(d));
  }

  if (domainsToWrite.length === 0) {
    Logger.log('Behavioral rollup: No domains to update');
    return { domainsUpdated: 0, details: {} };
  }

  // 5. Read Company_Behavioral_Score to find row positions
  const bsSheet = ss.getSheetByName(SDI_CONFIG.sheetBehavioral);
  const bsLastRow = bsSheet.getLastRow();
  if (bsLastRow <= 1) {
    Logger.log('Behavioral rollup: Company_Behavioral_Score has no data rows');
    return { domainsUpdated: 0, details: {} };
  }

  const bsDomains = bsSheet.getRange(2, 1, bsLastRow - 1, 1).getValues(); // Col A = Domain
  const domainRowMap = {}; // { domain: sheetRow (1-indexed) }
  for (let i = 0; i < bsDomains.length; i++) {
    const d = String(bsDomains[i][0] || '').trim().toLowerCase();
    if (d) domainRowMap[d] = i + 2; // +2 because data starts at row 2
  }

  // 6. Batch write B/C/D for affected domains
  let updated = 0;
  const details = {};

  for (const domain of domainsToWrite) {
    const row = domainRowMap[domain];
    if (!row) {
      Logger.log(`  Rollup: domain "${domain}" not found in Company_Behavioral_Score — skipping`);
      continue;
    }

    const scores = domainScores[domain];
    const jobsPts = Math.round(scores['Jobs'] * 100) / 100;
    const leadershipPts = Math.round(scores['Leadership'] * 100) / 100;
    const infraPts = Math.round(scores['Infra/Compliance'] * 100) / 100;

    // Write cols B, C, D (indices 2, 3, 4 in 1-indexed)
    bsSheet.getRange(row, 2, 1, 3).setValues([[jobsPts, leadershipPts, infraPts]]);

    details[domain] = { jobsPts, leadershipPts, infraPts };
    updated++;
  }

  Logger.log(`Behavioral rollup: Updated ${updated} domains`);
  return { domainsUpdated: updated, details: details };
}

// Funding sweep and manual trigger moved to 15a_Funding_Sweep.gs:
// runFundingSweep_, manualBehavioralRollup
