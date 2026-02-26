/**
 * 01_MarketIntel_Engine.gs
 *
 * Market Intelligence Bot - Main Search/Extract/Validate/Write Engine
 *
 * Architecture:
 * 1. Search Phase: Serper API (broad keyword search)
 * 2. Reader Phase: Gemini 2.0 Flash (extract structured events)
 * 3. Validator Phase: Serper API (confirm SoCal HQ)
 * 4. Write Phase: Write to local sheet + BD Tracker sync
 */

// ============================================================================
// API WRAPPER FUNCTIONS
// ============================================================================

/**
 * Calls Serper API to perform a web search.
 * @param {string} query - The search query
 * @param {number} numResults - Number of results to return (default 10)
 * @returns {Array<Object>} Array of search results with title, snippet, link
 * @private
 */
function callSerperAPI_(query, numResults = 10, tbs = '') {
  try {
    const apiKey = getScriptProperty_(SERPER_API_KEY_PROPERTY);
    const url = MI_CONFIG.SERPER_ENDPOINT;

    const payload = {
      q: query,
      num: numResults
    };

    // Add time-based search filter if specified (e.g., "qdr:w" for past week, "qdr:m" for past month)
    if (tbs) {
      payload.tbs = tbs;
    }

    const options = {
      method: 'post',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode !== 200) {
      Logger.log(`Serper API Error: ${statusCode} - ${response.getContentText()}`);
      return [];
    }

    const data = JSON.parse(response.getContentText());

    // Return organic results array
    if (data.organic && Array.isArray(data.organic)) {
      return data.organic.map(result => ({
        title: result.title || '',
        snippet: result.snippet || '',
        link: result.link || ''
      }));
    }

    return [];

  } catch (e) {
    Logger.log(`Error in callSerperAPI_: ${e.message}`);
    return [];
  }
}

/**
 * Calls Gemini API to extract structured data from text.
 * @param {string} systemPrompt - The system/instruction prompt
 * @param {string} userPrompt - The user content to analyze
 * @returns {Object|null} Parsed JSON response or null on error
 * @private
 */
function callGeminiAPI_(systemPrompt, userPrompt) {
  try {
    const apiKey = getScriptProperty_(GEMINI_API_KEY_PROPERTY);
    const url = `${MI_CONFIG.GEMINI_ENDPOINT}?key=${apiKey}`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: systemPrompt + '\n\n' + userPrompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    };

    const options = {
      method: 'post',
      headers: {
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode !== 200) {
      Logger.log(`Gemini API Error: ${statusCode} - ${response.getContentText()}`);
      return null;
    }

    const data = JSON.parse(response.getContentText());

    // Extract text from response
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      const textContent = data.candidates[0].content.parts[0].text;
      return JSON.parse(textContent);
    }

    return null;

  } catch (e) {
    Logger.log(`Error in callGeminiAPI_: ${e.message}`);
    return null;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Cleans and extracts root domain from URL.
 * @param {string} url - URL or domain string
 * @returns {string} Clean root domain (e.g., "acme.com")
 * @private
 */
function cleanDomain_(url) {
  if (!url) return '';

  let domain = String(url).toLowerCase().trim();

  // Remove protocol
  domain = domain.replace(/^https?:\/\//, '');

  // Remove www
  domain = domain.replace(/^www\./, '');

  // Remove path (everything after first /)
  domain = domain.split('/')[0];

  // Remove port
  domain = domain.split(':')[0];

  return domain;
}

/**
 * Generates unique run ID based on timestamp.
 * @returns {string} Run ID in format "MI_YYYYMMDD_HHMMSS"
 * @private
 */
function generateRunID_() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return `MI_${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

// ============================================================================
// PHASE 1: SEARCH
// ============================================================================

/**
 * Search Phase: Executes multiple search queries and returns combined results.
 * @param {Array<string>} queries - Array of search query strings
 * @returns {Array<Object>} Combined search results from all queries
 * @private
 */
function searchPhase_(queries, tbs = '') {
  Logger.log(`\n=== SEARCH PHASE ===`);
  Logger.log(`Executing ${queries.length} queries...`);
  if (tbs) Logger.log(`Time filter: ${tbs}`);

  const allResults = [];

  queries.forEach((query, index) => {
    Logger.log(`\n[${index + 1}/${queries.length}] Query: "${query}"`);
    const results = callSerperAPI_(query, MI_CONFIG.SERPER_RESULTS_PER_QUERY, tbs);
    Logger.log(`  → Found ${results.length} results`);
    allResults.push(...results);
  });

  Logger.log(`\nTotal search results: ${allResults.length}`);
  return allResults;
}

// ============================================================================
// PHASE 2: READER (EXTRACTION)
// ============================================================================

/**
 * Reader Phase: Extracts structured events from search results using Gemini.
 * @param {Array<Object>} searchResults - Array of search results
 * @param {string} systemPrompt - System prompt from config
 * @returns {Array<Object>} Array of extracted event objects
 * @private
 */
function readerPhase_(searchResults, systemPrompt) {
  Logger.log(`\n=== READER PHASE ===`);

  if (!searchResults || searchResults.length === 0) {
    Logger.log('No search results to process');
    return [];
  }

  // Build user prompt with all search results (task-agnostic)
  // Inject today's date so Gemini can enforce date recency filters
  const today = new Date().toISOString().split('T')[0];
  let userPrompt = `Today's date is ${today}. Analyze the following search results and extract items per your instructions:\n\n`;

  searchResults.forEach((result, index) => {
    userPrompt += `[${index + 1}]\n`;
    userPrompt += `Title: ${result.title}\n`;
    userPrompt += `Snippet: ${result.snippet}\n`;
    userPrompt += `URL: ${result.link}\n\n`;
  });

  // Schema is defined in the system prompt — just request the JSON wrapper
  userPrompt += '\nReturn your response as a JSON object with an "events" array matching the schema defined in your instructions above.';

  Logger.log('Calling Gemini API...');
  const response = callGeminiAPI_(systemPrompt, userPrompt);

  if (!response || !response.events || !Array.isArray(response.events)) {
    Logger.log('No events extracted or invalid response format');
    return [];
  }

  Logger.log(`Extracted ${response.events.length} events`);
  return response.events;
}

// ============================================================================
// PHASE 3: VALIDATOR (HQ CONFIRMATION)
// ============================================================================

// Known news source domains (not company domains — Gemini sometimes confuses these)
const NEWS_SOURCE_DOMAINS = [
  'prnewswire.com', 'businesswire.com', 'globenewswire.com',
  'latimes.com', 'dot.la', 'techcrunch.com', 'crunchbase.com',
  'bloomberg.com', 'reuters.com', 'cnbc.com', 'wsj.com',
  'linkedin.com', 'twitter.com', 'x.com'
];

/**
 * Filters events by date recency. Removes events older than maxAgeDays.
 * @param {Array<Object>} events - Extracted events
 * @param {number} maxAgeDays - Maximum age in days (default 14)
 * @returns {Array<Object>} Filtered events within date window
 * @private
 */
function filterByDate_(events, maxAgeDays = 14) {
  Logger.log(`\n=== DATE FILTER (${maxAgeDays} days) ===`);
  const now = new Date();
  const cutoff = new Date(now.getTime() - (maxAgeDays * 24 * 60 * 60 * 1000));
  const cutoffStr = cutoff.toISOString().split('T')[0];
  Logger.log(`Cutoff date: ${cutoffStr}`);

  const filtered = events.filter(event => {
    const dateStr = event.Event_Date || event.Published_Date || '';
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      Logger.log(`  ✗ ${event.Company_Name || event.Company_Domain || 'Unknown'}: invalid/missing date "${dateStr}" - REMOVED`);
      return false;
    }
    const eventDate = new Date(dateStr + 'T00:00:00');
    if (eventDate < cutoff) {
      Logger.log(`  ✗ ${event.Company_Name || event.Company_Domain || 'Unknown'}: ${dateStr} is older than ${maxAgeDays} days - REMOVED`);
      return false;
    }
    Logger.log(`  ✓ ${event.Company_Name || event.Company_Domain || 'Unknown'}: ${dateStr} - KEPT`);
    return true;
  });

  Logger.log(`Date filter: ${filtered.length}/${events.length} events passed`);
  return filtered;
}

// SoCal keywords for HQ validation
const SOCAL_KEYWORDS = [
  'Los Angeles', 'Irvine', 'San Diego', 'Orange County', 'Carlsbad',
  'Newport Beach', 'Santa Monica', 'Pasadena', 'Long Beach', 'Anaheim',
  'Torrance', 'El Segundo', 'Costa Mesa', 'La Jolla', 'Oceanside',
  'Huntington Beach', 'Fullerton', 'Riverside', 'San Bernardino', 'Ventura'
];

// Blocklist keywords (non-SoCal locations)
const BLOCKLIST_KEYWORDS = [
  'San Francisco', 'New York', 'Austin', 'Boston', 'Seattle',
  'Chicago', 'Denver', 'Texas', 'Massachusetts', 'Washington',
  'Silicon Valley', 'Bay Area', 'Portland', 'Atlanta', 'Miami'
];

/**
 * Validator Phase: Confirms SoCal HQ location and looks up company domain.
 * @param {Array<Object>} events - Array of events from reader phase
 * @returns {Array<Object>} Filtered array with only SoCal-confirmed events (with domains)
 * @private
 */
function validatePhase_(events) {
  Logger.log(`\n=== VALIDATOR PHASE ===`);
  Logger.log(`Validating ${events.length} events...`);

  const validatedEvents = [];

  events.forEach((event, index) => {
    Logger.log(`\n[${index + 1}/${events.length}] Validating: ${event.Company_Name}`);

    // STEP 1: Search for HQ location
    const hqQuery = `"${event.Company_Name}" headquarters location`;
    const hqResults = callSerperAPI_(hqQuery, 3);

    if (hqResults.length === 0) {
      Logger.log(`  ✗ No HQ results found - SKIPPING`);
      return;
    }

    // Check snippets for SoCal vs blocklist keywords
    let isSoCal = false;
    let confirmedLocation = '';

    for (const result of hqResults) {
      const snippet = result.snippet || '';

      // Check blocklist first (fail fast)
      const hasBlocklist = BLOCKLIST_KEYWORDS.some(keyword =>
        snippet.includes(keyword)
      );

      if (hasBlocklist) {
        Logger.log(`  ✗ Blocklist keyword found - REJECTED`);
        return;
      }

      // Check SoCal keywords
      const hasSoCal = SOCAL_KEYWORDS.some(keyword =>
        snippet.includes(keyword)
      );

      if (hasSoCal) {
        isSoCal = true;
        confirmedLocation = snippet;
        break;
      }
    }

    if (!isSoCal) {
      Logger.log(`  ? No SoCal confirmation - SKIPPING`);
      return;
    }

    Logger.log(`  ✓ CONFIRMED SoCal`);
    event.Location = confirmedLocation;

    // STEP 2: Lookup company domain (if missing or if Gemini used a news source domain)
    const currentDomain = cleanDomain_(event.Company_Domain || '');
    const isNewsDomain = NEWS_SOURCE_DOMAINS.some(nd => currentDomain.includes(nd));

    if (!currentDomain || isNewsDomain) {
      if (isNewsDomain) {
        Logger.log(`  ⚠ Domain "${currentDomain}" is a news source, not a company — looking up real domain...`);
      } else {
        Logger.log(`  → Looking up domain...`);
      }
      const domainQuery = `"${event.Company_Name}" official website`;
      const domainResults = callSerperAPI_(domainQuery, 3);

      if (domainResults.length > 0) {
        // Try to extract domain from first result's link (skip news source links)
        for (const result of domainResults) {
          const domain = cleanDomain_(result.link);
          if (domain && !NEWS_SOURCE_DOMAINS.some(nd => domain.includes(nd))) {
            event.Company_Domain = domain;
            Logger.log(`  ✓ Domain found: ${domain}`);
            break;
          }
        }
        if (!event.Company_Domain || NEWS_SOURCE_DOMAINS.some(nd => cleanDomain_(event.Company_Domain).includes(nd))) {
          Logger.log(`  ? Could not find a non-news-source domain`);
        }
      } else {
        Logger.log(`  ? No domain results found`);
      }
    }

    // Add to validated events
    validatedEvents.push(event);
  });

  Logger.log(`\nValidated: ${validatedEvents.length}/${events.length} events passed`);
  return validatedEvents;
}

// ============================================================================
// DEDUPLICATION HELPER
// ============================================================================

/**
 * Builds a Set of "domain|eventType" keys from existing rows in a sheet.
 * Only considers rows from the last 30 days based on Event_Date or Run_Date column.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to scan
 * @returns {Set<string>} Set of lowercase "domain|eventType" keys
 * @private
 */
function buildExistingEventsSet_(sheet) {
  const existingKeys = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return existingKeys; // Only headers or empty

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const domainCol = headers.indexOf('Company_Domain') !== -1
    ? headers.indexOf('Company_Domain')
    : headers.indexOf('Domain');
  const eventTypeCol = headers.indexOf('Event_Type') !== -1
    ? headers.indexOf('Event_Type')
    : headers.indexOf('Title');
  const dateCol = headers.indexOf('Event_Date') !== -1
    ? headers.indexOf('Event_Date')
    : headers.indexOf('Published_Date') !== -1
      ? headers.indexOf('Published_Date')
      : headers.indexOf('Run_Date');

  if (domainCol === -1 || eventTypeCol === -1) {
    Logger.log('  Dedup: Missing Company_Domain/Domain or Event_Type/Title column — skipping dedup');
    return existingKeys;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  data.forEach(row => {
    // Date filter: only consider recent rows
    if (dateCol !== -1) {
      const dateVal = row[dateCol];
      if (dateVal) {
        const rowDate = dateVal instanceof Date ? dateVal : new Date(dateVal);
        if (rowDate < cutoff) return; // Older than 30 days, skip
      }
    }

    const domain = cleanDomain_(String(row[domainCol] || '')).toLowerCase();
    const eventType = String(row[eventTypeCol] || '').toLowerCase().trim();
    if (domain && eventType) {
      existingKeys.add(`${domain}|${eventType}`);
    }
  });

  Logger.log(`  Dedup: Found ${existingKeys.size} existing domain|eventType keys (last 30 days)`);
  return existingKeys;
}

/**
 * Filters events, removing duplicates that already exist in the sheet.
 * @param {Array<Object>} events - New events to check
 * @param {Set<string>} existingKeys - Set from buildExistingEventsSet_()
 * @returns {Array<Object>} Events that are NOT duplicates
 * @private
 */
function deduplicateEvents_(events, existingKeys) {
  if (existingKeys.size === 0) return events;

  const unique = [];
  let dupCount = 0;

  events.forEach(e => {
    const domain = cleanDomain_(String(e.Company_Domain || '')).toLowerCase();
    const eventType = String(e.Event_Type || e.Title || '').toLowerCase().trim();
    const key = `${domain}|${eventType}`;

    if (domain && eventType && existingKeys.has(key)) {
      Logger.log(`  Dedup: SKIP ${e.Company_Name || domain} [${e.Event_Type || e.Title}] — already exists`);
      dupCount++;
    } else {
      unique.push(e);
      // Add to set so within-batch dupes are caught too
      if (domain && eventType) existingKeys.add(key);
    }
  });

  if (dupCount > 0) {
    Logger.log(`  Dedup: Removed ${dupCount} duplicate(s), ${unique.length} new event(s) remain`);
  }
  return unique;
}

// ============================================================================
// PHASE 4: WRITE
// ============================================================================

/**
 * Write Phase: Writes events to local sheet (dynamic schema) and optionally BD Tracker.
 * @param {Array<Object>} events - Validated/extracted events array
 * @param {string} localSheetName - Local sheet name from config
 * @param {boolean} bdEligible - Whether to sync to BD Tracker
 * @returns {number} Number of events written
 * @private
 */
function writePhase_(events, localSheetName, bdEligible) {
  Logger.log(`\n=== WRITE PHASE ===`);
  Logger.log(`Writing ${events.length} events...`);

  if (events.length === 0) {
    Logger.log('No events to write');
    return 0;
  }

  const runID = generateRunID_();
  const timestamp = new Date();
  const ss = SpreadsheetApp.openById(MI_CONFIG.CORE_SHEET_ID);

  // ---- WRITE TO LOCAL SHEET (DYNAMIC SCHEMA) ----
  try {
    const localSheet = ss.getSheetByName(localSheetName);

    if (!localSheet) {
      Logger.log(`ERROR: Local sheet "${localSheetName}" not found`);
      return 0;
    }

    // Read headers dynamically from destination sheet
    const headers = localSheet.getRange(1, 1, 1, localSheet.getLastColumn()).getValues()[0];
    Logger.log(`Target headers (${headers.length}): ${headers.join(', ')}`);

    // Deduplicate: skip events that already exist in this sheet (last 30 days)
    const existingKeys = buildExistingEventsSet_(localSheet);
    events = deduplicateEvents_(events, existingKeys);

    if (events.length === 0) {
      Logger.log('All events were duplicates — nothing to write');
      return 0;
    }

    // Map events to rows using header names as keys into the Gemini output
    const rows = events.map(e => {
      return headers.map(header => {
        // System-injected fields (not from Gemini)
        if (header === 'Run_Date') return new Date();
        // Clean domains
        const val = e[header];
        if (header === 'Company_Domain' && val) return cleanDomain_(val);
        // Use value from Gemini output if present
        if (val !== undefined && val !== null) return val;
        // Default to empty
        return '';
      });
    });

    // Append to local sheet
    const lastRow = localSheet.getLastRow();
    localSheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
    Logger.log(`✓ Wrote ${rows.length} events to local sheet: ${localSheetName}`);

  } catch (e) {
    Logger.log(`ERROR writing to local sheet: ${e.message}`);
  }

  // ---- WRITE TO BD TRACKER (dynamic column mapping) ----
  if (!bdEligible) {
    Logger.log('BD Tracker sync: SKIPPED (not eligible for this task)');
    return events.length;
  }

  try {
    const bdSS = SpreadsheetApp.openById(MI_CONFIG.BD_TRACKER_SHEET_ID);
    const bdSheet = bdSS.getSheetByName(MI_CONFIG.BD_EVENTS_SHEET);

    if (!bdSheet) {
      Logger.log(`ERROR: BD Tracker sheet "${MI_CONFIG.BD_EVENTS_SHEET}" not found`);
      return events.length;
    }

    // Read BD Tracker headers dynamically for resilient column mapping
    const bdHeaders = bdSheet.getRange(1, 1, 1, bdSheet.getLastColumn()).getValues()[0];
    Logger.log(`BD Tracker headers (${bdHeaders.length}): ${bdHeaders.join(', ')}`);

    // Deduplicate against BD Tracker (uses Domain + Event_Type columns)
    const bdExistingKeys = buildExistingEventsSet_(bdSheet);
    const bdEvents = deduplicateEvents_([...events], bdExistingKeys);

    if (bdEvents.length === 0) {
      Logger.log('All events already exist in BD Tracker — skipping');
      return events.length;
    }

    // Map events to BD Tracker using header names
    const bdRows = bdEvents.map(e => {
      return bdHeaders.map(header => {
        switch (header) {
          case 'Company Name':   return e.Company_Name || '';
          case 'Domain':         return cleanDomain_(e.Company_Domain || '');
          case 'Event_Type':     return e.Event_Type || '';
          case 'Subtype/Title':  return e.Subtype_Title || '';
          case 'Event_Date':     return e.Event_Date || '';
          case 'Source':         return e.Source || 'Market Intel Bot';
          case 'Source_URL':     return e.Source_URL || '';
          case 'Logged_On':      return timestamp;
          case 'Base_Points':    return 8;
          case 'Window_Days':    return 180;
          case 'Decayed_Points': return 8;
          case 'Notes':          return e.Notes || '';
          case 'Run_ID':         return runID;
          case 'Origin':         return e.Origin || '';
          case 'Confidence':     return e.Confidence || '';
          case 'Event_Details':  return e.Event_Details || '';
          default:               return '';
        }
      });
    });

    // Append to BD Tracker
    const bdLastRow = bdSheet.getLastRow();
    bdSheet.getRange(bdLastRow + 1, 1, bdRows.length, bdRows[0].length).setValues(bdRows);
    Logger.log(`✓ Wrote ${bdRows.length} events to BD Tracker: ${MI_CONFIG.BD_EVENTS_SHEET}`);

  } catch (e) {
    Logger.log(`ERROR writing to BD Tracker: ${e.message}`);
  }

  // ---- DISTRIBUTE TO TYPED TABS (route by Event_Type) ----
  const EVENT_TYPE_TAB_MAP = {
    'Capital': 'Funding_Events',
    'Leadership': 'leadership_extractor',
    'Infra/Compliance': 'Infra Compliance',
    'M&A': 'M&A_Transactions'
  };

  try {
    const grouped = {};
    events.forEach(e => {
      const tab = EVENT_TYPE_TAB_MAP[e.Event_Type];
      if (tab) {
        if (!grouped[tab]) grouped[tab] = [];
        grouped[tab].push(e);
      }
    });

    for (const [tabName, tabEvents] of Object.entries(grouped)) {
      const destSheet = ss.getSheetByName(tabName);
      if (!destSheet) {
        Logger.log(`WARNING: Distribution tab "${tabName}" not found — skipped`);
        continue;
      }
      const destHeaders = destSheet.getRange(1, 1, 1, destSheet.getLastColumn()).getValues()[0];
      const destRows = tabEvents.map(e => {
        return destHeaders.map(header => {
          if (header === 'Run_Date') return new Date();
          const val = e[header];
          if (header === 'Company_Domain' && val) return cleanDomain_(val);
          if (val !== undefined && val !== null) return val;
          return '';
        });
      });
      const destLastRow = destSheet.getLastRow();
      destSheet.getRange(destLastRow + 1, 1, destRows.length, destRows[0].length).setValues(destRows);
      Logger.log(`✓ Distributed ${destRows.length} events to ${tabName}`);
    }
  } catch (e) {
    Logger.log(`ERROR distributing to typed tabs: ${e.message}`);
  }

  return events.length;
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Main orchestrator: Runs the full market intel sweep.
 * Reads config, executes all phases, updates timestamps.
 */
function runMarketIntelSweep() {
  Logger.log('╔════════════════════════════════════════╗');
  Logger.log('║   MARKET INTEL BOT - SWEEP STARTED    ║');
  Logger.log('╚════════════════════════════════════════╝');

  try {
    // Get active tasks from config
    const tasks = getSearchPromptsConfig();

    if (tasks.length === 0) {
      Logger.log('\nNo active tasks found in _CONFIG');
      return;
    }

    Logger.log(`\nFound ${tasks.length} active task(s)`);

    // Process each task
    tasks.forEach((task, index) => {
      Logger.log(`\n\n${'='.repeat(60)}`);
      Logger.log(`TASK ${index + 1}/${tasks.length}: ${task.taskName}`);
      Logger.log('='.repeat(60));

      // Parse queries (newline-separated)
      const queries = task.searchQueries
        .split('\n')
        .map(q => q.trim())
        .filter(q => q.length > 0);

      Logger.log(`Target Sheet: ${task.sheetName}`);
      Logger.log(`Queries: ${queries.length}`);

      // Execute phases
      const searchResults = searchPhase_(queries, task.serperTbs || '');
      const extractedEvents = readerPhase_(searchResults, task.systemPrompt);

      // Date filter: remove events older than 14 days (catches stale Serper results)
      const recentEvents = filterByDate_(extractedEvents, 14);

      // Validate only if configured (SoCal HQ check)
      let eventsToWrite;
      if (task.validateSoCal) {
        eventsToWrite = validatePhase_(recentEvents);
      } else {
        Logger.log('SoCal validation: SKIPPED (not configured for this task)');
        eventsToWrite = recentEvents;
      }

      const writtenCount = writePhase_(eventsToWrite, task.sheetName, task.bdEligible);

      Logger.log(`\n✓ Task complete: ${writtenCount} events written`);

      // TODO: Update LastRun timestamp in _CONFIG
    });

    Logger.log('\n\n╔════════════════════════════════════════╗');
    Logger.log('║    MARKET INTEL BOT - COMPLETED       ║');
    Logger.log('╚════════════════════════════════════════╝');

  } catch (e) {
    Logger.log(`\n\n✗ FATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
}

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test Serper API connection.
 */
function TEST_SerperAPI() {
  Logger.log('=== TESTING SERPER API ===');
  const results = callSerperAPI_('techcrunch funding news', 5);
  Logger.log(`Found ${results.length} results`);

  if (results.length > 0) {
    Logger.log('\nFirst result:');
    Logger.log(JSON.stringify(results[0], null, 2));
  }
}

/**
 * Test Gemini API connection.
 */
function TEST_GeminiAPI() {
  Logger.log('=== TESTING GEMINI API ===');

  const systemPrompt = 'Extract company names from the following text. Return JSON with format: {"companies": ["name1", "name2"]}';
  const userPrompt = 'TechCrunch reports that Acme Corp raised $50M and BetaCo acquired GammaTech.';

  const result = callGeminiAPI_(systemPrompt, userPrompt);

  if (result) {
    Logger.log('Response:');
    Logger.log(JSON.stringify(result, null, 2));
  } else {
    Logger.log('No response received');
  }
}

/**
 * Test the full pipeline with minimal data.
 */
function TEST_FullPipeline() {
  Logger.log('=== TESTING FULL PIPELINE ===\n');

  // Mock 1 query
  const queries = ['techcrunch funding news series A'];

  // Run phases
  const searchResults = searchPhase_(queries);
  Logger.log(`\nSearch results: ${searchResults.length}`);

  const systemPrompt = 'Extract funding events from search results. Focus on Series A/B rounds only.';
  const extractedEvents = readerPhase_(searchResults, systemPrompt);
  Logger.log(`\nExtracted events: ${extractedEvents.length}`);

  const validatedEvents = validatePhase_(extractedEvents);
  Logger.log(`\nValidated events: ${validatedEvents.length}`);

  if (validatedEvents.length > 0) {
    Logger.log('\nFirst validated event:');
    Logger.log(JSON.stringify(validatedEvents[0], null, 2));
  }

  Logger.log('\n✓ Pipeline test complete (NOT written to sheets)');
}
