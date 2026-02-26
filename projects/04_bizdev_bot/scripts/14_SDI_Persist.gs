/**
 * 14_SDI_Persist.gs
 * SDI Scout - Persist Events to Company_Events
 * Version: 1.0.0
 *
 * PURPOSE: Writes validated events to Company_Events tab.
 *          Triggers domain reconciliation, dedup, and formula propagation.
 * DEPENDENCIES: 13_SDI_Config.gs, 15_Gemini_Reconciliation.gs
 */

// ============================================
// PERSIST EVENTS
// ============================================

/**
 * Write events to Company_Events with reconciliation, dedup, and formula propagation.
 *
 * @param {Array<Object>} events - Validated event objects from extraction
 * @param {string} runId - SDI Run ID
 * @returns {Object} - { written: number, skippedDuplicates: number, unresolvedDomains: number, capitalDomains: Array<string> }
 */
function persistEvents_(events, runId) {
  if (!events || events.length === 0) {
    return { written: 0, skippedDuplicates: 0, unresolvedDomains: 0, capitalDomains: [] };
  }

  const ss = SpreadsheetApp.openById(SDI_CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(SDI_CONFIG.sheetEvents);
  const cols = SDI_CONFIG.eventCols;

  // 1. Reconcile domains (fill in blanks via Company_Master match or Gemini lookup)
  Logger.log(`  Reconciling domains for ${events.length} events...`);
  events = reconcileDomains_(events);

  // Count unresolved
  const unresolvedDomains = events.filter(e => !e.domain || !e.domain.trim()).length;
  if (unresolvedDomains > 0) {
    Logger.log(`  ${unresolvedDomains} events have unresolved domains`);
  }

  // 2. Dedup against existing events
  const lastRow = sheet.getLastRow();
  let existingData = [];
  if (lastRow > 1) {
    existingData = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  }

  const beforeCount = events.length;
  events = checkDuplicateEvents_(events, existingData);
  const skippedDuplicates = beforeCount - events.length;

  if (events.length === 0) {
    Logger.log('  All events were duplicates — nothing to write');
    return { written: 0, skippedDuplicates, unresolvedDomains, capitalDomains: [] };
  }

  // 3. Build rows for Company_Events
  const timestamp = generateSDITimestamp_();
  const rows = [];
  const capitalDomains = [];

  for (const event of events) {
    const domain = String(event.domain || '').trim().toLowerCase();

    // Track Capital domains for funding sweep
    if (event.event_type === 'Capital' && domain) {
      capitalDomains.push(domain);
    }

    rows.push([
      event.company_name || '',                                   // A: Company_Name
      domain,                                                      // B: Domain
      event.event_type || '',                                     // C: Event_Type
      event.subtype || '',                                        // D: Subtype
      event.event_date || '',                                     // E: Event_Date
      event.source_url || '',                                     // F: Source_URL
      timestamp,                                                   // G: Logged_On
      '', '', '',                                                  // H, I, J: formula placeholders
      event.notes || '',                                          // K: Notes
      runId                                                        // L: Run_ID
    ]);
  }

  // 4. Find append position
  const appendRow = lastRow > 1 ? lastRow + 1 : 2; // Row 2 if sheet is empty (header only)

  // 5. Ensure sheet has enough rows
  const maxRows = sheet.getMaxRows();
  const needed = appendRow + rows.length - 1;
  if (needed > maxRows) {
    sheet.insertRowsAfter(maxRows, needed - maxRows);
  }

  // 6. Write data (cols A-L = 12 columns)
  sheet.getRange(appendRow, 1, rows.length, 12).setValues(rows);
  Logger.log(`  Wrote ${rows.length} events starting at row ${appendRow}`);

  // 7. Formula propagation: copy H:J from last existing data row (or row 2 if first data)
  propagateFormulas_(sheet, appendRow, rows.length);

  return {
    written: rows.length,
    skippedDuplicates,
    unresolvedDomains,
    capitalDomains: [...new Set(capitalDomains)] // unique domains
  };
}

/**
 * Copy formulas from H:J of the last existing row to newly appended rows.
 * Pattern: Range.copyTo() preserves relative references.
 *
 * @param {Sheet} sheet - Company_Events sheet
 * @param {number} appendStartRow - First row of newly appended data
 * @param {number} rowCount - Number of rows appended
 */
function propagateFormulas_(sheet, appendStartRow, rowCount) {
  // Source row: the row just above the first appended row
  const sourceRow = appendStartRow - 1;

  if (sourceRow < 2) {
    Logger.log('  WARNING: No existing formula row to copy from (sheet may be empty). Formulas not propagated.');
    return;
  }

  // H, I, J = columns 8, 9, 10 (1-indexed)
  const sourceRange = sheet.getRange(sourceRow, SDI_CONFIG.formulaStartCol, 1, SDI_CONFIG.formulaColCount);
  const targetRange = sheet.getRange(appendStartRow, SDI_CONFIG.formulaStartCol, rowCount, SDI_CONFIG.formulaColCount);

  sourceRange.copyTo(targetRange);
  Logger.log(`  Formulas propagated: H:J from row ${sourceRow} → rows ${appendStartRow}-${appendStartRow + rowCount - 1}`);
}
