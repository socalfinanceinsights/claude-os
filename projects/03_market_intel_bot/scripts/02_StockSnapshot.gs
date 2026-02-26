/**
 * 02_StockSnapshot.gs
 *
 * Monthly stock performance snapshot for newsletter.
 * Captures SoCal public company prices on the 1st and last day of each month.
 * Uses GOOGLEFINANCE via a hidden helper tab to avoid rate limits.
 *
 * Trigger setup:
 *   - captureMonthStart(): Monthly trigger on the 1st
 *   - checkAndCaptureMonthEnd(): Daily trigger that only fires on the last day
 *   - Or run setupStockTriggers() once to create both automatically
 */

// ============================================================
// MAIN ENTRY POINTS (called by triggers)
// ============================================================

/**
 * Captures closing prices as Month Start values.
 * Trigger: Monthly, 1st of each month.
 * Uses closeyest = last trading day's close (effectively month-open).
 */
function captureMonthStart() {
  Logger.log('=== captureMonthStart ===');
  captureStockPrices_('D'); // Column D = Mo Start Price
  Logger.log('Month Start prices captured to column D');
}

/**
 * Daily trigger wrapper — only runs captureMonthEnd on the last day of the month.
 * Trigger: Daily (checks date, exits early if not last day).
 */
function checkAndCaptureMonthEnd() {
  var today = new Date();
  var tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (today.getMonth() !== tomorrow.getMonth()) {
    Logger.log('Last day of month detected: ' + today.toDateString());
    captureMonthEnd();
  } else {
    Logger.log('Not last day of month (' + today.toDateString() + ') — skipping.');
  }
}

/**
 * Captures closing prices as Month End values + Market Cap.
 * Called by checkAndCaptureMonthEnd on the last day, or manually.
 */
function captureMonthEnd() {
  Logger.log('=== captureMonthEnd ===');
  captureStockPrices_('E'); // Column E = Mo End Price
  captureMarketCaps_();      // Column G = Market Cap
  Logger.log('Month End prices (col E) and market caps (col G) captured');
}

// ============================================================
// CORE LOGIC
// ============================================================

/**
 * Reads all tickers, fetches closeyest via helper tab, writes to target column.
 * @param {string} targetCol - Column letter to write prices into ("D" or "E")
 * @private
 */
function captureStockPrices_(targetCol) {
  var ss = SpreadsheetApp.openById(MI_CONFIG.CORE_SHEET_ID);
  var stockSheet = ss.getSheetByName(MI_CONFIG.STOCK_TAB_NAME);

  if (!stockSheet) {
    throw new Error('Sheet not found: ' + MI_CONFIG.STOCK_TAB_NAME);
  }

  var lastRow = stockSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No tickers found');
    return;
  }

  var tickers = stockSheet.getRange('C2:C' + lastRow).getValues()
    .map(function(row) { return row[0] ? row[0].toString().trim() : ''; });

  var validCount = tickers.filter(function(t) { return t !== '' && t !== 'N/A'; }).length;
  Logger.log('Found ' + validCount + ' valid tickers out of ' + tickers.length + ' rows');

  var helperSheet = getOrCreateHelperSheet_(ss);
  var prices = batchGoogleFinance_(ss, helperSheet, tickers, 'closeyest');

  var colIndex = targetCol.charCodeAt(0) - 64; // A=1, D=4, E=5
  var writeData = prices.map(function(p) { return [p]; });
  stockSheet.getRange(2, colIndex, writeData.length, 1).setValues(writeData);

  Logger.log('Wrote ' + writeData.length + ' prices to column ' + targetCol);
}

/**
 * Fetches market cap for all tickers and writes to column G.
 * @private
 */
function captureMarketCaps_() {
  var ss = SpreadsheetApp.openById(MI_CONFIG.CORE_SHEET_ID);
  var stockSheet = ss.getSheetByName(MI_CONFIG.STOCK_TAB_NAME);

  var lastRow = stockSheet.getLastRow();
  if (lastRow < 2) return;

  var tickers = stockSheet.getRange('C2:C' + lastRow).getValues()
    .map(function(row) { return row[0] ? row[0].toString().trim() : ''; });

  var helperSheet = getOrCreateHelperSheet_(ss);
  var caps = batchGoogleFinance_(ss, helperSheet, tickers, 'marketcap');

  var writeData = caps.map(function(c) { return [c]; });
  stockSheet.getRange(2, 7, writeData.length, 1).setValues(writeData); // Column G

  Logger.log('Wrote ' + writeData.length + ' market caps to column G');
}

// ============================================================
// HELPER TAB PATTERN (GOOGLEFINANCE batching)
// ============================================================

/**
 * Fetches a GOOGLEFINANCE attribute for an array of tickers using a hidden helper tab.
 * Processes in batches to stay within Sheets limits.
 *
 * @param {Spreadsheet} ss - The spreadsheet object
 * @param {Sheet} helperSheet - The helper tab for formula evaluation
 * @param {string[]} tickers - Array of ticker symbols (may contain blanks/N/A)
 * @param {string} attribute - GOOGLEFINANCE attribute ("closeyest", "marketcap", etc.)
 * @returns {Array} Array of values (numbers or empty strings for failures)
 * @private
 */
function batchGoogleFinance_(ss, helperSheet, tickers, attribute) {
  var batchSize = MI_CONFIG.STOCK_BATCH_SIZE || 50;
  var delayMs = MI_CONFIG.STOCK_BATCH_DELAY_MS || 5000;
  var allValues = [];

  // Build list of valid tickers with their original indices
  var tickerMap = [];
  for (var i = 0; i < tickers.length; i++) {
    var t = tickers[i];
    if (t && t !== 'N/A' && t !== '') {
      tickerMap.push({ index: i, ticker: t });
    }
  }

  // Pre-fill results array with empty strings
  var results = [];
  for (var r = 0; r < tickers.length; r++) {
    results.push('');
  }

  // Process valid tickers in batches
  var totalBatches = Math.ceil(tickerMap.length / batchSize);
  Logger.log('Processing ' + tickerMap.length + ' valid tickers in ' + totalBatches + ' batches (' + attribute + ')');

  for (var b = 0; b < tickerMap.length; b += batchSize) {
    var batch = tickerMap.slice(b, b + batchSize);
    var batchNum = Math.floor(b / batchSize) + 1;

    // Write GOOGLEFINANCE formulas to helper tab
    var formulas = batch.map(function(item) {
      return ['=GOOGLEFINANCE("' + item.ticker + '","' + attribute + '")'];
    });

    helperSheet.getRange(1, 1, formulas.length, 1).setFormulas(formulas);
    SpreadsheetApp.flush();
    Utilities.sleep(delayMs);

    // Read calculated values
    var values = helperSheet.getRange(1, 1, formulas.length, 1).getValues();

    var successCount = 0;
    for (var v = 0; v < values.length; v++) {
      var val = values[v][0];
      var originalIndex = batch[v].index;

      // GOOGLEFINANCE errors show as strings starting with # or empty
      if (val === '' || val === null ||
          (typeof val === 'string' && (val.charAt(0) === '#' || val === 'N/A'))) {
        results[originalIndex] = '';
      } else {
        results[originalIndex] = val;
        successCount++;
      }
    }

    // Clear helper tab for next batch
    helperSheet.getRange(1, 1, formulas.length, 1).clearContent();
    SpreadsheetApp.flush();

    Logger.log('Batch ' + batchNum + '/' + totalBatches + ': ' + successCount + '/' + batch.length + ' succeeded');
  }

  return results;
}

/**
 * Gets or creates the hidden helper sheet for GOOGLEFINANCE batching.
 * @param {Spreadsheet} ss
 * @returns {Sheet}
 * @private
 */
function getOrCreateHelperSheet_(ss) {
  var helper = ss.getSheetByName(MI_CONFIG.STOCK_HELPER_TAB);
  if (!helper) {
    helper = ss.insertSheet(MI_CONFIG.STOCK_HELPER_TAB);
    helper.hideSheet();
    Logger.log('Created and hid helper sheet: ' + MI_CONFIG.STOCK_HELPER_TAB);
  }
  return helper;
}

// ============================================================
// TRIGGER SETUP
// ============================================================

/**
 * Creates time-based triggers for stock snapshots.
 * Run ONCE manually to set up automation.
 *
 * Creates:
 *   1. Monthly trigger on 1st at 7 AM → captureMonthStart
 *   2. Daily trigger at 7 PM → checkAndCaptureMonthEnd (fires logic only on last day)
 */
function setupStockTriggers() {
  // Remove existing stock triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'captureMonthStart' || fn === 'checkAndCaptureMonthEnd') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed > 0) {
    Logger.log('Removed ' + removed + ' existing stock triggers');
  }

  // 1st of month at 7 AM PT — capture opening prices
  ScriptApp.newTrigger('captureMonthStart')
    .timeBased()
    .onMonthDay(1)
    .atHour(7)
    .create();

  // Daily at 7 PM PT — checks if last day of month, then captures close + market cap
  ScriptApp.newTrigger('checkAndCaptureMonthEnd')
    .timeBased()
    .everyDays(1)
    .atHour(19)
    .create();

  Logger.log('Stock triggers created:');
  Logger.log('  captureMonthStart  → 1st of month @ 7 AM');
  Logger.log('  checkAndCaptureMonthEnd → Daily @ 7 PM (fires only on last day)');
}

// ============================================================
// MANUAL / TEST FUNCTIONS
// ============================================================

/**
 * Test function — captures both start and end prices in one run.
 * Use this to backfill or test the pipeline without waiting for triggers.
 */
function TEST_CaptureFullSnapshot() {
  Logger.log('=== TEST: Full Snapshot ===');
  captureMonthStart();
  captureMonthEnd();
  Logger.log('=== TEST: Complete ===');
}
