/**
 * 14a_SDI_Ranked.gs
 * SDI Scout - Ranked Output Builder & Helpers
 * @execution manual
 * Version: 1.0.0
 *
 * PURPOSE: Build ranked company list from SDI Scout run results.
 *          Reads Company_Master, Company_Behavioral_Score, ICP_Score to rank.
 * SPLIT FROM: 14_SDI_Engine.gs (lines 131-337)
 * DEPENDENCIES: 13_SDI_Config.gs (SDI_CONFIG, CONFIG)
 * CALLED BY: 14_SDI_Engine.gs (sdiScoutRun)
 */

// ============================================
// RANKED OUTPUT BUILDER
// ============================================

/**
 * Build ranked company list with ICP scores, behavioral scores, and signals.
 *
 * @param {Array<string>} domains - Unique domains from this run
 * @param {Object} approachAngles - { domain: angle string }
 * @param {Array<Object>} events - All extracted events
 * @returns {Array<Object>} - Ranked company results
 */
function buildRankedOutput_(domains, approachAngles, events) {
  if (!domains || domains.length === 0) return [];

  const ss = SpreadsheetApp.openById(SDI_CONFIG.spreadsheetId);

  // Load Company_Master for name + "in system" check
  const cmSheet = ss.getSheetByName(SDI_CONFIG.sheetCompanyMaster);
  const cmLastRow = cmSheet.getLastRow();
  const cmDomainSet = new Set();
  const cmNameMap = {};

  if (cmLastRow > 1) {
    const cmData = cmSheet.getRange(2, 1, cmLastRow - 1, 2).getValues(); // A=Domain, B=Company
    for (const row of cmData) {
      const d = String(row[0] || '').trim().toLowerCase();
      if (d) {
        cmDomainSet.add(d);
        cmNameMap[d] = String(row[1] || '');
      }
    }
  }

  // Load Company_Behavioral_Score
  const bsSheet = ss.getSheetByName(SDI_CONFIG.sheetBehavioral);
  const bsLastRow = bsSheet.getLastRow();
  const bsMap = {}; // domain → { jobsPts, leadershipPts, infraPts, capitalPts, total }

  if (bsLastRow > 1) {
    const bsData = bsSheet.getRange(2, 1, bsLastRow - 1, 6).getValues();
    for (const row of bsData) {
      const d = String(row[0] || '').trim().toLowerCase();
      if (d) {
        bsMap[d] = {
          jobsPts: parseFloat(row[1]) || 0,
          leadershipPts: parseFloat(row[2]) || 0,
          infraPts: parseFloat(row[3]) || 0,
          capitalPts: parseFloat(row[4]) || 0,
          total: parseFloat(row[5]) || 0
        };
      }
    }
  }

  // Load ICP_Score for firmographic scores
  const icpSheet = ss.getSheetByName(CONFIG.sheetICPScore || 'ICP_Score');
  const icpMap = {}; // domain → { firmographics, total }

  if (icpSheet) {
    const icpLastRow = icpSheet.getLastRow();
    if (icpLastRow > 1) {
      // Col A=Domain, O=Firmographics, T=ICP Total
      const icpData = icpSheet.getRange(2, 1, icpLastRow - 1, 20).getValues();
      for (const row of icpData) {
        const d = String(row[0] || '').trim().toLowerCase();
        if (d) {
          icpMap[d] = {
            firmographics: parseFloat(row[14]) || 0, // Col O (index 14)
            icpTotal: parseFloat(row[19]) || 0        // Col T (index 19)
          };
        }
      }
    }
  }

  // Group events by domain for signal summary
  const eventsByDomain = {};
  for (const event of events) {
    const d = String(event.domain || '').trim().toLowerCase();
    if (!d) continue;
    if (!eventsByDomain[d]) eventsByDomain[d] = [];
    eventsByDomain[d].push({
      type: event.event_type,
      subtype: event.subtype,
      detail: event.notes || ''
    });
  }

  // Build results
  const results = [];

  for (const domain of domains) {
    const d = domain.toLowerCase();
    const inCompanyMaster = cmDomainSet.has(d);
    const companyName = cmNameMap[d] || findCompanyNameFromEvents_(events, d);
    const behavioral = bsMap[d] || { jobsPts: 0, leadershipPts: 0, infraPts: 0, capitalPts: 0, total: 0 };
    const icp = icpMap[d] || { firmographics: 0, icpTotal: 0 };
    const signals = eventsByDomain[d] || [];
    const angle = approachAngles[d] || '';

    // Combined score: ICP total (includes firmographics + funding) which already has behavioral via VLOOKUP
    // But since we JUST updated behavioral, ICP_Score formulas may not have recalculated yet.
    // Use: firmographics + behavioral total as combined for ranking purposes.
    const combinedScore = Math.round(icp.firmographics + behavioral.total);

    results.push({
      companyName: companyName,
      domain: d,
      inCompanyMaster: inCompanyMaster,
      isNew: !inCompanyMaster,
      icpFirmographics: Math.round(icp.firmographics),
      icpTotal: Math.round(icp.icpTotal),
      behavioralScore: {
        jobsPts: Math.round(behavioral.jobsPts * 100) / 100,
        leadershipPts: Math.round(behavioral.leadershipPts * 100) / 100,
        infraPts: Math.round(behavioral.infraPts * 100) / 100,
        capitalPts: Math.round(behavioral.capitalPts * 100) / 100,
        total: Math.round(behavioral.total * 100) / 100
      },
      combinedScore: combinedScore,
      signals: signals,
      approachAngle: angle,
      evidenceUrls: getEvidenceUrls_(events, d)
    });
  }

  // Sort by combined score descending
  results.sort((a, b) => b.combinedScore - a.combinedScore);

  // Add rank
  results.forEach((r, i) => { r.rank = i + 1; });

  return results;
}

// ============================================
// HELPERS
// ============================================

/**
 * Get unique domains from events array
 * @param {Array<Object>} events
 * @returns {Array<string>}
 */
function getUniqueDomains_(events) {
  const domains = new Set();
  for (const e of events) {
    const d = String(e.domain || '').trim().toLowerCase();
    if (d) domains.add(d);
  }
  return Array.from(domains);
}

/**
 * Find company name from events when not in Company_Master
 * @param {Array<Object>} events
 * @param {string} domain
 * @returns {string}
 */
function findCompanyNameFromEvents_(events, domain) {
  for (const e of events) {
    if (String(e.domain || '').toLowerCase() === domain && e.company_name) {
      return e.company_name;
    }
  }
  return domain; // fallback to domain
}

/**
 * Get evidence URLs for a domain from events
 * @param {Array<Object>} events
 * @param {string} domain
 * @returns {Array<string>}
 */
function getEvidenceUrls_(events, domain) {
  const urls = new Set();
  for (const e of events) {
    if (String(e.domain || '').toLowerCase() === domain && e.source_url) {
      urls.add(e.source_url);
    }
  }
  return Array.from(urls);
}

/**
 * Build the full result object returned to sidebar
 * @param {string} runId
 * @param {string} profile
 * @param {Array} queries
 * @param {number} serperCount
 * @param {number} written
 * @param {number} dupes
 * @param {number} unresolved
 * @param {Array} rankedResults
 * @param {Object} angles
 * @param {number} startTime
 * @returns {Object}
 */
function buildResult_(runId, profile, queries, serperCount, written, dupes, unresolved, rankedResults, angles, startTime) {
  const elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);

  return {
    success: true,
    runId: runId,
    mode: 'REVERSE',
    inputSummary: profile.substring(0, 80),
    queriesExecuted: queries.length,
    serperResultsFound: serperCount,
    eventsWritten: written,
    duplicatesSkipped: dupes,
    unresolvedDomains: unresolved,
    companiesFound: rankedResults.length,
    elapsedSeconds: elapsed,
    results: rankedResults
  };
}
