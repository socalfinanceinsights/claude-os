/**
 * 95_PromptTester.gs
 *
 * Prompt testing utility with full diagnostics. Runs the Serper → Gemini pipeline
 * for any _CONFIG task and provides detailed execution logs + _TEST_OUTPUT tab.
 * Skips validate and write phases.
 *
 * Usage: Set TASK_TO_TEST below, then run testPrompt()
 */

// ============================================================================
// CONFIG - Change this to test different tasks
// ============================================================================
const TEST_TASK_NAME = 'ICP News Daily SoCal'; // Must match a Task Name in _CONFIG

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

/**
 * Main test function. Reads a task from _CONFIG, runs Serper + Gemini with
 * detailed diagnostics at every step. Results go to Logger + _TEST_OUTPUT tab.
 */
function testPrompt() {
  Logger.log('╔════════════════════════════════════════════════════════╗');
  Logger.log('║            PROMPT TESTER - STARTED                   ║');
  Logger.log('╚════════════════════════════════════════════════════════╝');

  // 1. LOAD TASK FROM _CONFIG
  Logger.log('\n━━━ STEP 1: LOAD CONFIG ━━━');
  const tasks = getSearchPromptsConfig();
  const task = tasks.find(t => t.taskName === TEST_TASK_NAME);

  if (!task) {
    Logger.log(`✗ FATAL: Task "${TEST_TASK_NAME}" not found in _CONFIG (or not Active).`);
    Logger.log(`  Available active tasks: ${tasks.map(t => t.taskName).join(', ') || '(none)'}`);
    return;
  }

  Logger.log(`✓ Task loaded: ${task.taskName}`);
  Logger.log(`  Sheet Target: ${task.sheetName}`);
  Logger.log(`  BD Eligible: ${task.bdEligible}`);
  Logger.log(`  Validate SoCal: ${task.validateSoCal}`);
  Logger.log(`  Serper TBS: ${task.serperTbs || '(none)'}`);
  Logger.log(`  System Prompt Length: ${task.systemPrompt.length} chars`);
  Logger.log(`  System Prompt Preview:\n    ${task.systemPrompt.substring(0, 300).replace(/\n/g, '\n    ')}...`);

  // 2. PARSE & LOG QUERIES
  const queries = task.searchQueries
    .split('\n')
    .map(q => q.trim())
    .filter(q => q.length > 0);

  Logger.log(`\n━━━ STEP 2: QUERIES (${queries.length} total) ━━━`);
  queries.forEach((q, i) => Logger.log(`  [${i + 1}] ${q}`));

  // 3. SEARCH PHASE — Per-query diagnostics
  Logger.log('\n━━━ STEP 3: SEARCH PHASE (Serper) ━━━');
  const queryDiagnostics = [];
  const allResults = [];

  queries.forEach((query, index) => {
    Logger.log(`\n  [${index + 1}/${queries.length}] "${query}"`);
    const results = callSerperAPI_(query, MI_CONFIG.SERPER_RESULTS_PER_QUERY, task.serperTbs || '');

    const diag = {
      query: query,
      resultCount: results.length,
      topResults: results.slice(0, 3).map(r => r.title),
      domains: [...new Set(results.map(r => {
        try { return new URL(r.link).hostname.replace('www.', ''); } catch(e) { return r.link; }
      }))]
    };
    queryDiagnostics.push(diag);

    if (results.length === 0) {
      Logger.log(`    ✗ ZERO RESULTS — This query returned nothing. Check spelling or site: path.`);
    } else {
      Logger.log(`    ✓ ${results.length} results`);
      Logger.log(`    Sources: ${diag.domains.join(', ')}`);
      results.slice(0, 3).forEach((r, i) => {
        Logger.log(`      ${i + 1}. ${r.title}`);
        Logger.log(`         ${r.link}`);
        Logger.log(`         "${r.snippet.substring(0, 120)}..."`);
      });
    }

    allResults.push(...results);
  });

  // Search summary
  const deadQueries = queryDiagnostics.filter(d => d.resultCount === 0);
  const allDomains = [...new Set(queryDiagnostics.flatMap(d => d.domains))];

  Logger.log(`\n  ── SEARCH SUMMARY ──`);
  Logger.log(`  Total results: ${allResults.length} from ${queries.length} queries`);
  Logger.log(`  Unique source domains: ${allDomains.length}`);
  Logger.log(`    ${allDomains.join(', ')}`);

  if (deadQueries.length > 0) {
    Logger.log(`  ⚠ DEAD QUERIES (${deadQueries.length}/${queries.length} returned 0 results):`);
    deadQueries.forEach(d => Logger.log(`    ✗ "${d.query}"`));
  } else {
    Logger.log(`  ✓ All queries returned results`);
  }

  if (allResults.length === 0) {
    Logger.log('\n✗ FATAL: No search results at all. Cannot proceed to Gemini.');
    writeTestOutput_(task.taskName, queryDiagnostics, allResults, [], []);
    return;
  }

  // 4. READER PHASE — Gemini extraction with diagnostics
  Logger.log('\n━━━ STEP 4: READER PHASE (Gemini) ━━━');
  Logger.log(`  Sending ${allResults.length} search results to Gemini 2.0 Flash...`);

  const extractedEvents = readerPhase_(allResults, task.systemPrompt);

  if (!extractedEvents || extractedEvents.length === 0) {
    Logger.log('  ✗ Gemini returned NO events. Possible causes:');
    Logger.log('    - System prompt too restrictive (filtering everything out)');
    Logger.log('    - Search results not relevant to prompt criteria');
    Logger.log('    - JSON schema mismatch (Gemini couldn\'t match output format)');
    Logger.log('    - API error (check Apps Script execution log for HTTP errors)');
    writeTestOutput_(task.taskName, queryDiagnostics, allResults, [], []);
    return;
  }

  Logger.log(`  ✓ Gemini extracted ${extractedEvents.length} events`);

  // 5. FIELD VALIDATION — Check each event for quality
  Logger.log('\n━━━ STEP 5: FIELD VALIDATION ━━━');
  const fieldIssues = validateFields_(extractedEvents, task.sheetName);

  if (fieldIssues.length === 0) {
    Logger.log('  ✓ All events passed field validation');
  } else {
    Logger.log(`  ⚠ Found ${fieldIssues.length} field issue(s):`);
    fieldIssues.forEach(issue => Logger.log(`    ${issue}`));
  }

  // 6. SOURCE COVERAGE — Which firms/domains appear in output
  Logger.log('\n━━━ STEP 6: SOURCE COVERAGE ━━━');
  const outputDomains = {};
  extractedEvents.forEach(e => {
    const domain = e.Company_Domain || e.Source || 'UNKNOWN';
    outputDomains[domain] = (outputDomains[domain] || 0) + 1;
  });

  Logger.log(`  Sources in output (${Object.keys(outputDomains).length} unique):`);
  Object.entries(outputDomains)
    .sort((a, b) => b[1] - a[1])
    .forEach(([domain, count]) => {
      Logger.log(`    ${domain}: ${count} event(s)`);
    });

  // 7. EVENT DETAIL DUMP
  Logger.log('\n━━━ STEP 7: EXTRACTED EVENTS (FULL) ━━━');
  extractedEvents.forEach((event, i) => {
    Logger.log(`\n  ── Event ${i + 1}/${extractedEvents.length} ──`);
    Object.entries(event).forEach(([key, val]) => {
      const valStr = String(val || '');
      if (valStr.length > 200) {
        Logger.log(`  ${key}: ${valStr.substring(0, 200)}...`);
      } else {
        Logger.log(`  ${key}: ${valStr}`);
      }
    });
  });

  // 8. WRITE TO _TEST_OUTPUT TAB
  Logger.log('\n━━━ STEP 8: WRITING TO _TEST_OUTPUT TAB ━━━');
  writeTestOutput_(task.taskName, queryDiagnostics, allResults, extractedEvents, fieldIssues);

  Logger.log('\n╔════════════════════════════════════════════════════════╗');
  Logger.log('║            PROMPT TESTER - COMPLETE                  ║');
  Logger.log('╚════════════════════════════════════════════════════════╝');
  Logger.log(`Events: ${extractedEvents.length} | Issues: ${fieldIssues.length} | Dead Queries: ${deadQueries.length}/${queries.length}`);
  Logger.log('Check the _TEST_OUTPUT tab for formatted results.');
}

// ============================================================================
// FIELD VALIDATION
// ============================================================================

/**
 * Validates extracted events for common prompt issues.
 * Checks are driven by the destination sheet's headers — only flags missing fields
 * that the destination tab actually expects.
 * @param {Array<Object>} events - Extracted events from Gemini
 * @param {string} sheetName - Destination sheet name (used to read expected headers)
 * @returns {Array<string>} Array of issue descriptions
 * @private
 */
function validateFields_(events, sheetName) {
  const issues = [];

  // Read expected headers from destination sheet
  let expectedHeaders = [];
  try {
    const ss = SpreadsheetApp.openById(MI_CONFIG.CORE_SHEET_ID);
    const destSheet = ss.getSheetByName(sheetName);
    if (destSheet) {
      expectedHeaders = destSheet.getRange(1, 1, 1, destSheet.getLastColumn()).getValues()[0]
        .map(h => String(h).trim())
        .filter(h => h && h !== 'Run_Date'); // Run_Date is system-injected, not from Gemini
    }
  } catch (err) {
    Logger.log(`  Warning: Could not read headers from "${sheetName}" — using default checks`);
  }

  const expects = (field) => expectedHeaders.length === 0 || expectedHeaders.includes(field);

  events.forEach((e, i) => {
    const tag = `Event ${i + 1}`;

    // Missing critical fields (only check if destination expects them)
    if (expects('Company_Domain') && expects('Company_Name') && !e.Company_Domain && !e.Company_Name) {
      issues.push(`${tag}: Missing both Company_Domain and Company_Name — can't identify the company`);
    }
    if (expects('Company_Domain') && !expects('Company_Name') && !e.Company_Domain) {
      issues.push(`${tag}: Missing Company_Domain`);
    }
    if (expects('Event_Type') && !e.Event_Type) {
      issues.push(`${tag}: Missing Event_Type`);
    }
    if (expects('Subtype_Title') && !e.Subtype_Title) {
      issues.push(`${tag}: Missing Subtype_Title (headline/title)`);
    }
    if (expects('Title') && !e.Title) {
      issues.push(`${tag}: Missing Title`);
    }
    if (expects('Event_Date') && !e.Event_Date) {
      issues.push(`${tag}: Missing Event_Date`);
    }
    if (expects('Published_Date') && !e.Published_Date) {
      issues.push(`${tag}: Missing Published_Date`);
    }
    if (expects('Source_URL') && !e.Source_URL) {
      issues.push(`${tag}: Missing Source_URL — no link to source article`);
    }

    // Date format check (whichever date field exists)
    const dateVal = e.Event_Date || e.Published_Date || '';
    if (dateVal && !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      issues.push(`${tag}: Date "${dateVal}" not in YYYY-MM-DD format`);
    }

    // Notes length check (flag only if getting paragraph-length)
    if (e.Notes && e.Notes.length > 250) {
      issues.push(`${tag}: Notes is ${e.Notes.length} chars (too long — keep to 1-2 sentences): "${e.Notes.substring(0, 50)}..."`);
    }

    // Notes comma check (only warn, not critical — JSON output won't break from commas)
    // Commas in prose are natural English; only flag if excessive
    if (e.Notes && (e.Notes.match(/,/g) || []).length > 5) {
      issues.push(`${tag}: Notes has excessive commas (${(e.Notes.match(/,/g) || []).length}) — consider semicolons: "${e.Notes.substring(0, 60)}..."`);
    }

    // Event_Details subfield check (generic — works across all prompt types)
    if (e.Event_Details) {
      const details = e.Event_Details;
      const keyMatches = details.match(/\w+:/g) || [];
      if (keyMatches.length < 5) {
        issues.push(`${tag}: Event_Details has only ${keyMatches.length} key:value pairs (expected 5+)`);
      }

      // Check if commas are used as DELIMITERS between key:value pairs
      // (commas within prose content are fine — only flag structural misuse)
      if (/\w+:[^;]+,\s*\w+:/.test(details)) {
        issues.push(`${tag}: Event_Details may use commas as delimiters between subfields (should use semicolons)`);
      }
    } else if (!e.Event_Details && !e.Location) {
      issues.push(`${tag}: Missing Event_Details field entirely`);
    }

    // Source URL validation (basic)
    if (e.Source_URL && !e.Source_URL.startsWith('http')) {
      issues.push(`${tag}: Source_URL doesn't start with http: "${e.Source_URL}"`);
    }
  });

  return issues;
}

// ============================================================================
// WRITE TEST OUTPUT TO SHEET
// ============================================================================

/**
 * Writes comprehensive test results to _TEST_OUTPUT tab.
 * Includes: run info, query diagnostics, extracted events, field issues.
 * @param {string} taskName - The task that was tested
 * @param {Array<Object>} queryDiagnostics - Per-query results from search phase
 * @param {Array<Object>} searchResults - All search results combined
 * @param {Array<Object>} events - Extracted Gemini events
 * @param {Array<string>} fieldIssues - Validation issues found
 * @private
 */
function writeTestOutput_(taskName, queryDiagnostics, searchResults, events, fieldIssues) {
  const ss = SpreadsheetApp.openById(MI_CONFIG.CORE_SHEET_ID);
  let sheet = ss.getSheetByName('_TEST_OUTPUT');

  if (!sheet) {
    sheet = ss.insertSheet('_TEST_OUTPUT');
    Logger.log('  Created _TEST_OUTPUT tab');
  }

  sheet.clear();

  // Determine column width from event fields
  let eventHeaders = [];
  if (events.length > 0) {
    // Collect all unique keys across all events
    const allKeys = new Set();
    events.forEach(e => Object.keys(e).forEach(k => allKeys.add(k)));
    eventHeaders = Array.from(allKeys);
  }
  const colCount = Math.max(eventHeaders.length, 6, 1);

  const pad = (arr) => {
    const padded = [...arr];
    while (padded.length < colCount) padded.push('');
    return padded.slice(0, colCount);
  };

  const allData = [];

  // ── Section 1: Run Summary ──
  allData.push(pad(['PROMPT TEST RUN — ' + taskName]));
  allData.push(pad(['Timestamp', new Date().toLocaleString(), '', 'Total Search Results', searchResults.length]));
  allData.push(pad(['Events Extracted', events.length, '', 'Field Issues', fieldIssues.length]));
  allData.push(pad(['Queries', queryDiagnostics.length, '', 'Dead Queries', queryDiagnostics.filter(d => d.resultCount === 0).length]));
  allData.push(pad([]));

  // ── Section 2: Query Diagnostics ──
  allData.push(pad(['QUERY DIAGNOSTICS']));
  allData.push(pad(['Query', 'Results', 'Status', 'Source Domains']));
  queryDiagnostics.forEach(d => {
    const status = d.resultCount === 0 ? 'DEAD' : d.resultCount < 3 ? 'LOW' : 'OK';
    allData.push(pad([d.query, d.resultCount, status, d.domains.join('; ')]));
  });
  allData.push(pad([]));

  // ── Section 3: Source Coverage ──
  allData.push(pad(['SOURCE COVERAGE (in extracted events)']));
  if (events.length > 0) {
    allData.push(pad(['Domain/Firm', 'Event Count']));
    const domainCounts = {};
    events.forEach(e => {
      const d = e.Company_Domain || e.Source || 'UNKNOWN';
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    });
    Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([domain, count]) => {
        allData.push(pad([domain, count]));
      });
  } else {
    allData.push(pad(['(no events extracted)']));
  }
  allData.push(pad([]));

  // ── Section 4: Field Issues ──
  allData.push(pad(['FIELD VALIDATION ISSUES']));
  if (fieldIssues.length === 0) {
    allData.push(pad(['All events passed validation']));
  } else {
    allData.push(pad(['Issue']));
    fieldIssues.forEach(issue => allData.push(pad([issue])));
  }
  allData.push(pad([]));

  // ── Section 5: Extracted Events ──
  allData.push(pad(['EXTRACTED EVENTS']));
  if (events.length > 0) {
    allData.push(pad(eventHeaders));
    events.forEach(e => {
      allData.push(pad(eventHeaders.map(key => {
        const val = e[key];
        if (val === undefined || val === null) return '';
        return String(val);
      })));
    });
  } else {
    allData.push(pad(['(no events)']));
  }
  allData.push(pad([]));

  // ── Section 6: Raw Search Results (first 15) ──
  allData.push(pad(['RAW SEARCH RESULTS (first 15)']));
  allData.push(pad(['Title', 'Snippet', 'URL']));
  searchResults.slice(0, 15).forEach(r => {
    allData.push(pad([r.title || '', r.snippet || '', r.link || '']));
  });

  // Write batch
  if (allData.length > 0) {
    sheet.getRange(1, 1, allData.length, colCount).setValues(allData);
  }

  // Formatting — section headers
  const sectionHeaderStyle = (row) => {
    sheet.getRange(row, 1, 1, colCount).setFontWeight('bold').setBackground('#4A86C8').setFontColor('#FFFFFF');
  };

  // Find section header rows and format them
  let rowNum = 1;
  allData.forEach((row, idx) => {
    const firstCell = String(row[0]);
    if (firstCell === 'PROMPT TEST RUN — ' + taskName ||
        firstCell === 'QUERY DIAGNOSTICS' ||
        firstCell === 'SOURCE COVERAGE (in extracted events)' ||
        firstCell === 'FIELD VALIDATION ISSUES' ||
        firstCell === 'EXTRACTED EVENTS' ||
        firstCell === 'RAW SEARCH RESULTS (first 15)') {
      sectionHeaderStyle(idx + 1);
    }
  });

  // Auto-resize first few columns
  const resizeCols = Math.min(colCount, 10);
  for (let c = 1; c <= resizeCols; c++) {
    sheet.autoResizeColumn(c);
  }

  Logger.log(`  ✓ Wrote ${allData.length} rows to _TEST_OUTPUT`);
}

// ============================================================================
// CUSTOM PROMPT TEST (quick iteration without touching _CONFIG)
// ============================================================================

/**
 * Quick test with a custom prompt override.
 * Uses search queries from _CONFIG but overrides the system prompt.
 *
 * @param {string} customPrompt - Override system prompt
 * @param {string} taskName - Task name to pull queries from (default: TEST_TASK_NAME)
 */
function testCustomPrompt(customPrompt, taskName) {
  taskName = taskName || TEST_TASK_NAME;

  Logger.log('╔════════════════════════════════════════════════════════╗');
  Logger.log('║         CUSTOM PROMPT TEST - STARTED                 ║');
  Logger.log('╚════════════════════════════════════════════════════════╝');

  const tasks = getSearchPromptsConfig();
  const task = tasks.find(t => t.taskName === taskName);

  if (!task) {
    Logger.log(`✗ FATAL: Task "${taskName}" not found.`);
    return;
  }

  const queries = task.searchQueries
    .split('\n')
    .map(q => q.trim())
    .filter(q => q.length > 0);

  Logger.log(`\nUsing queries from "${taskName}" (${queries.length} queries)`);
  Logger.log('System prompt: CUSTOM OVERRIDE\n');

  // Search with per-query diagnostics
  const queryDiagnostics = [];
  const allResults = [];

  queries.forEach((query, index) => {
    Logger.log(`  [${index + 1}/${queries.length}] "${query}"`);
    const results = callSerperAPI_(query, MI_CONFIG.SERPER_RESULTS_PER_QUERY, task.serperTbs || '');
    queryDiagnostics.push({
      query: query,
      resultCount: results.length,
      domains: [...new Set(results.map(r => {
        try { return new URL(r.link).hostname.replace('www.', ''); } catch(e) { return r.link; }
      }))]
    });
    Logger.log(`    → ${results.length} results`);
    allResults.push(...results);
  });

  if (allResults.length === 0) {
    Logger.log('\n✗ No search results.');
    return;
  }

  // Extract with custom prompt
  const extractedEvents = readerPhase_(allResults, customPrompt);
  Logger.log(`\nExtracted: ${extractedEvents.length} events`);

  // Validate
  const fieldIssues = validateFields_(extractedEvents, task.sheetName);
  if (fieldIssues.length > 0) {
    Logger.log(`\n⚠ Field Issues (${fieldIssues.length}):`);
    fieldIssues.forEach(i => Logger.log(`  ${i}`));
  }

  // Dump events
  extractedEvents.forEach((event, i) => {
    Logger.log(`\n── Event ${i + 1} ──`);
    Logger.log(JSON.stringify(event, null, 2));
  });

  writeTestOutput_(taskName + ' (CUSTOM)', queryDiagnostics, allResults, extractedEvents, fieldIssues);
  Logger.log('\n✓ Done. Check _TEST_OUTPUT tab.');
}
