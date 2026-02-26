/**
 * 91_Newsletter_Export.gs
 * @execution manual
 *
 * Monthly newsletter data export.
 * Pulls last 30 days of events from all category tabs and writes a flat
 * dataset to the Newsletter_Export tab for download as CSV.
 *
 * Usage: Market Intel menu → Export Newsletter CSV
 * Then: File → Download → Comma Separated Values (.csv)
 */

// Source tabs to include in the export
const NEWSLETTER_SOURCE_TABS = [
  'Funding_Events',
  'DailyNews',
  'M&A_Transactions',
  'leadership_extractor',
  'Infra Compliance',
  'regulatory_changes',
  'ThoughtLeadership'
];

const NEWSLETTER_EXPORT_TAB = 'Newsletter_Export';
const NEWSLETTER_LOOKBACK_DAYS = 30;
const NEWSLETTER_EVENT_DATE_BUFFER_DAYS = 14; // exclude events >30+14=44 days old

/**
 * Exports last 30 days of market intel events to the Newsletter_Export tab.
 * Handles mixed schemas across tabs via dynamic superset header mapping.
 * Date filter: Run_Date >= 30 days ago, Event_Date >= 44 days ago (if present).
 */
function exportNewsletterCSV() {
  const ss = SpreadsheetApp.openById(CORE_SHEET_ID);
  const ui = SpreadsheetApp.getUi();

  const now = new Date();
  const cutoffRunDate = new Date(now.getTime() - NEWSLETTER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const cutoffEventDate = new Date(now.getTime() - (NEWSLETTER_LOOKBACK_DAYS + NEWSLETTER_EVENT_DATE_BUFFER_DAYS) * 24 * 60 * 60 * 1000);

  // --- Pass 1: Read all tabs, collect headers and raw data ---
  const tabDataMap = {};

  NEWSLETTER_SOURCE_TABS.forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      Logger.log(`Newsletter Export: Tab "${tabName}" not found — skipping.`);
      return;
    }
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      Logger.log(`Newsletter Export: Tab "${tabName}" has no data rows — skipping.`);
      return;
    }
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    tabDataMap[tabName] = { headers, data };
  });

  // --- Build superset header list (Category first, then all unique tab headers) ---
  const supersetHeaders = ['Category'];
  Object.values(tabDataMap).forEach(({ headers }) => {
    headers.forEach(h => {
      if (h && !supersetHeaders.includes(h)) supersetHeaders.push(h);
    });
  });

  // --- Pass 2: Filter rows and map to superset headers ---
  const allRows = [];

  NEWSLETTER_SOURCE_TABS.forEach(tabName => {
    if (!tabDataMap[tabName]) return;

    const { headers, data } = tabDataMap[tabName];
    const runDateIdx = headers.indexOf('Run_Date');
    const eventDateIdx = headers.indexOf('Event_Date');

    if (runDateIdx === -1) {
      Logger.log(`Newsletter Export: Tab "${tabName}" missing Run_Date column — skipping.`);
      return;
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const runDate = row[runDateIdx];

      // Primary filter: Run_Date must exist and be within lookback window
      if (!runDate || !(runDate instanceof Date)) continue;
      if (runDate < cutoffRunDate) continue;

      // Secondary filter: exclude stale events if Event_Date is present and parseable
      if (eventDateIdx !== -1) {
        const eventDate = row[eventDateIdx];
        if (eventDate instanceof Date && eventDate < cutoffEventDate) continue;
      }

      // Map row values to superset header positions
      const mappedRow = new Array(supersetHeaders.length).fill('');
      mappedRow[0] = tabName; // Category column

      headers.forEach((header, idx) => {
        const superIdx = supersetHeaders.indexOf(header);
        if (superIdx !== -1) mappedRow[superIdx] = row[idx];
      });

      allRows.push(mappedRow);
    }
  });

  if (allRows.length === 0) {
    ui.alert('No Data', 'No events found in the last 30 days across all category tabs.', ui.ButtonSet.OK);
    return;
  }

  // Sort by Run_Date descending
  const runDateSuperIdx = supersetHeaders.indexOf('Run_Date');
  if (runDateSuperIdx !== -1) {
    allRows.sort((a, b) => {
      const dA = a[runDateSuperIdx] instanceof Date ? a[runDateSuperIdx] : new Date(0);
      const dB = b[runDateSuperIdx] instanceof Date ? b[runDateSuperIdx] : new Date(0);
      return dB - dA;
    });
  }

  // --- Write to Newsletter_Export tab ---
  let exportSheet = ss.getSheetByName(NEWSLETTER_EXPORT_TAB);
  if (!exportSheet) {
    exportSheet = ss.insertSheet(NEWSLETTER_EXPORT_TAB);
  } else {
    exportSheet.clearContents();
  }

  const output = [supersetHeaders, ...allRows];
  exportSheet.getRange(1, 1, output.length, supersetHeaders.length).setValues(output);
  exportSheet.setFrozenRows(1);

  ui.alert(
    'Export Complete',
    `${allRows.length} rows written to "${NEWSLETTER_EXPORT_TAB}" tab.\n\nTo download as CSV:\nFile → Download → Comma Separated Values (.csv)`,
    ui.ButtonSet.OK
  );

  Logger.log(`Newsletter Export: ${allRows.length} rows written. Tabs processed: ${Object.keys(tabDataMap).join(', ')}`);
}
