/**
 * 15_Gemini_Reconciliation.gs
 * SDI Scout - Domain Reconciliation & Deduplication
 * Version: 1.0.0
 *
 * PURPOSE: Resolves Company_Name → Domain via fuzzy match against Company_Master,
 *          then Gemini web lookup as fallback. Also handles event dedup.
 * DEPENDENCIES: 13_SDI_Config.gs, 00_Brain_Config.gs
 */

// ============================================
// DOMAIN RECONCILIATION
// ============================================

/**
 * Resolve domains for events that have Company_Name but blank domain.
 * Step 1: Fuzzy match against Company_Master col B.
 * Step 2: Gemini web lookup as fallback.
 *
 * @param {Array<Object>} events - Array of extracted event objects with company_name, domain
 * @returns {Array<Object>} - Same array with domains populated where possible
 */
function reconcileDomains_(events) {
  if (!events || events.length === 0) return events;

  // Load Company_Master name→domain lookup
  const ss = SpreadsheetApp.openById(SDI_CONFIG.spreadsheetId);
  const cmSheet = ss.getSheetByName(SDI_CONFIG.sheetCompanyMaster);
  const cmData = cmSheet.getRange(2, 1, cmSheet.getLastRow() - 1, 2).getValues(); // A=Domain, B=Company

  const domainByName = {};
  const domainList = [];
  for (const row of cmData) {
    const domain = String(row[0] || '').trim().toLowerCase();
    const company = String(row[1] || '').trim().toLowerCase();
    if (domain && company) {
      domainByName[company] = domain;
      domainList.push({ name: company, domain: domain });
    }
  }

  // Batch: collect events needing resolution
  const needsResolution = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].domain && events[i].domain.trim()) continue; // already has domain

    const name = String(events[i].company_name || '').trim().toLowerCase();
    if (!name) continue;

    // Step 1: Exact match
    if (domainByName[name]) {
      events[i].domain = domainByName[name];
      continue;
    }

    // Step 1b: Fuzzy match — check if company name contains or is contained by a known name
    let fuzzyMatch = null;
    for (const entry of domainList) {
      if (entry.name.includes(name) || name.includes(entry.name)) {
        fuzzyMatch = entry.domain;
        break;
      }
    }

    if (fuzzyMatch) {
      events[i].domain = fuzzyMatch;
      Logger.log(`  Fuzzy matched "${events[i].company_name}" → ${fuzzyMatch}`);
      continue;
    }

    // Needs Gemini lookup
    needsResolution.push(i);
  }

  // Step 2: Gemini web lookup for unresolved
  if (needsResolution.length > 0) {
    Logger.log(`  ${needsResolution.length} companies need Gemini domain lookup`);
    const apiKey = getGeminiAPIKey();
    if (!apiKey) {
      Logger.log('  WARNING: No GEMINI_API_KEY — skipping domain resolution');
      return events;
    }

    for (const idx of needsResolution) {
      try {
        const domain = geminiDomainLookup_(events[idx].company_name, apiKey);
        if (domain && domain !== 'UNKNOWN') {
          events[idx].domain = domain.toLowerCase();
          Logger.log(`  Gemini resolved "${events[idx].company_name}" → ${domain}`);
        } else {
          Logger.log(`  Gemini could not resolve "${events[idx].company_name}" — domain stays blank`);
        }
        Utilities.sleep(SDI_CONFIG.geminiDelayMs);
      } catch (e) {
        Logger.log(`  ERROR resolving domain for "${events[idx].company_name}": ${e.message}`);
      }
    }
  }

  return events;
}

/**
 * Call Gemini to resolve a company name to its root domain
 * @param {string} companyName - Company name
 * @param {string} apiKey - Gemini API key
 * @returns {string|null} - Root domain or null
 */
function geminiDomainLookup_(companyName, apiKey) {
  const prompt = buildDomainLookupPrompt_(companyName);
  const url = SDI_CONFIG.geminiFlashEndpoint + '?key=' + apiKey;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.0 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());
  if (json.candidates && json.candidates[0] && json.candidates[0].content) {
    const text = json.candidates[0].content.parts[0].text.trim();
    // Clean: remove protocol, www, trailing slash
    const cleaned = text.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').trim();
    if (cleaned.includes('.') && cleaned !== 'UNKNOWN') {
      return cleaned;
    }
  }
  return null;
}

// ============================================
// DEDUPLICATION
// ============================================

/**
 * Check new events against existing Company_Events for duplicates.
 * Uses domain + event_type + date proximity (±30 days) as initial filter,
 * then Gemini for final judgment on borderline cases.
 *
 * @param {Array<Object>} newEvents - Events to check
 * @param {Array<Array>} existingData - Existing Company_Events data rows (raw 2D array, no header)
 * @returns {Array<Object>} - Filtered array with duplicates removed
 */
function checkDuplicateEvents_(newEvents, existingData) {
  if (!newEvents || newEvents.length === 0) return [];
  if (!existingData || existingData.length === 0) return newEvents;

  const cols = SDI_CONFIG.eventCols;
  const kept = [];
  let dupCount = 0;

  // Build lookup of existing events by domain
  const existingByDomain = {};
  for (const row of existingData) {
    const domain = String(row[cols.domain] || '').trim().toLowerCase();
    if (!domain) continue;
    if (!existingByDomain[domain]) existingByDomain[domain] = [];
    existingByDomain[domain].push({
      companyName: String(row[cols.companyName] || ''),
      domain: domain,
      eventType: String(row[cols.eventType] || ''),
      subtype: String(row[cols.subtype] || ''),
      eventDate: row[cols.eventDate],
      notes: String(row[cols.notes] || '')
    });
  }

  for (const newEvent of newEvents) {
    const domain = String(newEvent.domain || '').trim().toLowerCase();
    if (!domain) {
      kept.push(newEvent); // No domain — can't dedup, keep it
      continue;
    }

    const existing = existingByDomain[domain];
    if (!existing || existing.length === 0) {
      kept.push(newEvent); // No existing events for this domain
      continue;
    }

    // Check for same event_type + date proximity
    let isDuplicate = false;
    for (const ex of existing) {
      if (ex.eventType !== newEvent.event_type) continue;

      // Date proximity check: within 30 days
      const exDate = ex.eventDate instanceof Date ? ex.eventDate : new Date(ex.eventDate);
      const newDate = new Date(newEvent.event_date);
      if (isNaN(exDate.getTime()) || isNaN(newDate.getTime())) continue;

      const daysDiff = Math.abs((exDate - newDate) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 30 && ex.subtype === newEvent.subtype) {
        // Same domain + same type + same subtype + within 30 days = duplicate
        isDuplicate = true;
        Logger.log(`  Dedup: skipping ${newEvent.company_name} / ${newEvent.event_type} / ${newEvent.subtype} (matches existing within ${Math.round(daysDiff)}d)`);
        break;
      }
    }

    if (isDuplicate) {
      dupCount++;
    } else {
      kept.push(newEvent);
    }
  }

  if (dupCount > 0) {
    Logger.log(`  Dedup removed ${dupCount} duplicate events`);
  }

  return kept;
}
