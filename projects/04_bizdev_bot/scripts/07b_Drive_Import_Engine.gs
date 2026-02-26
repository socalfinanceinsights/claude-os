/**
 * BD TRACKER - DRIVE IMPORT ENGINE
 * Version: 1.0.0 (Split from 07_Drive_Import.gs)
 * @execution manual
 *
 * CONTAINS:
 * - driveImportSource_ (generic engine for all sources)
 * - Check_Drive_Import_Status (status check utility)
 *
 * DEPENDENCIES:
 * - 00_Brain_Config.gs (DRIVE_IMPORT config)
 * - 00d_CSV_Helpers.gs (readCSVsFromDriveFolder_, moveCSVsToProcessed_)
 * - 00e_CSV_File_Utils.gs (validateCSVHeaders_, getSourceFolderId_, getProcessedFolderId_)
 * CALLED BY: 07_Drive_Import.gs (per-source functions)
 */

/** ==========================================================================
 *  GENERIC IMPORT ENGINE
 *  ========================================================================== */

/**
 * Generic Drive import handler for any source
 * Reads CSVs from Drive folder, validates, writes to helper tab, calls processor, archives
 *
 * @param {string} sourceKey - Key in DRIVE_IMPORT.sources (e.g., 'linkedin')
 * @param {Object} sourceConfig - Source config object from DRIVE_IMPORT.sources
 * @param {Function} processorFn - Function to call after writing to helper tab
 *                                  Receives (helperSheet) as argument
 * @param {Object} [options] - {silent: boolean} suppress UI alerts
 * @returns {Object} - {source, filesProcessed, rowsProcessed}
 */
function driveImportSource_(sourceKey, sourceConfig, processorFn, options) {
  const silent = options && options.silent;
  let ui = null;
  if (!silent) {
    try { ui = SpreadsheetApp.getUi(); } catch (e) { /* headless mode */ }
  }
  const ss = getSpreadsheet_();
  const log = []; // Detailed log for Run_Logs

  // Get folder IDs from ScriptProperties
  const sourceFolderId = getSourceFolderId_(sourceConfig.propKey);
  const processedFolderId = getProcessedFolderId_();

  if (!sourceFolderId || !processedFolderId) {
    const msg = `Drive Import not set up. Run "Setup Drive Import Folders" first.`;
    if (!silent) ui.alert('Setup Required', msg, ui.ButtonSet.OK);
    throw new Error(msg);
  }

  // Check for CSV files
  const csvFiles = readCSVsFromDriveFolder_(sourceFolderId);

  if (csvFiles.length === 0) {
    Logger.log(`${sourceConfig.label}: No CSV files found`);
    return { source: sourceConfig.label, filesProcessed: 0, rowsProcessed: 0 };
  }

  log.push(`Found ${csvFiles.length} CSV file(s)`);
  Logger.log(`${sourceConfig.label}: Found ${csvFiles.length} CSV file(s)`);

  let totalRows = 0;
  const fileResults = [];
  let errors = [];

  for (const csvFile of csvFiles) {
    Logger.log(`Processing: ${csvFile.fileName}`);
    const fileLog = { file: csvFile.fileName, rows: 0, status: 'OK' };

    // Determine headers to validate against
    let csvHeaders = csvFile.headers;
    let dataRows = csvFile.data;

    // Handle Bullhorn metadata rows (first N rows are metadata, not headers)
    if (sourceConfig.skipMetadataRows > 0) {
      const allRows = [csvFile.headers, ...csvFile.data];
      const headerRowIndex = sourceConfig.skipMetadataRows;

      if (allRows.length <= headerRowIndex) {
        Logger.log(`  WARNING: ${csvFile.fileName} has fewer rows than expected metadata rows, skipping`);
        fileLog.status = 'SKIPPED: too few rows';
        fileResults.push(fileLog);
        continue;
      }

      csvHeaders = allRows[headerRowIndex];
      dataRows = allRows.slice(headerRowIndex + 1);
      Logger.log(`  Bullhorn: Skipped ${sourceConfig.skipMetadataRows} metadata rows, found ${dataRows.length} data rows`);
    }

    fileLog.rows = dataRows.length;

    // Validate headers
    const validation = validateCSVHeaders_(csvHeaders, sourceConfig.expectedHeaders, sourceConfig.label);
    if (!validation.isValid) {
      Logger.log(`  HEADER VALIDATION FAILED: ${validation.message}`);
      logError_('DRIVE_IMPORT', 'HEADER_MISMATCH', `${sourceConfig.label} - ${csvFile.fileName}`, validation.message);
      fileLog.status = 'HEADER_FAIL: ' + validation.missing.join(', ');
      errors.push(`${csvFile.fileName}: header mismatch`);
      fileResults.push(fileLog);

      if (!silent) {
        ui.alert('Header Validation Failed', validation.message, ui.ButtonSet.OK);
      }
      continue;
    }

    Logger.log(`  Headers validated: ${csvHeaders.length} columns match`);

    // Get or create the helper tab
    let helperSheet = ss.getSheetByName(sourceConfig.targetTab);
    if (!helperSheet) {
      helperSheet = ss.insertSheet(sourceConfig.targetTab);
      helperSheet.hideSheet();
      Logger.log(`  Created helper tab: ${sourceConfig.targetTab}`);
    }

    // Build the 2D array to write (headers + data)
    let writeData;
    if (sourceConfig.skipMetadataRows > 0) {
      const metadataRows = [];
      for (let i = 0; i < sourceConfig.skipMetadataRows; i++) {
        const emptyRow = new Array(csvHeaders.length).fill('');
        if (i === 0) emptyRow[0] = 'Bullhorn Report';
        metadataRows.push(emptyRow);
      }
      writeData = [...metadataRows, csvHeaders, ...dataRows];
    } else {
      writeData = [csvHeaders, ...dataRows];
    }

    // Ensure all rows have the same column count (pad short rows)
    const maxCols = Math.max(...writeData.map(r => r.length));
    writeData = writeData.map(row => {
      while (row.length < maxCols) row.push('');
      return row;
    });

    // Clear helper tab and write data
    helperSheet.clear();
    ensureSheetHasRows_(helperSheet, writeData.length);
    ensureSheetHasCols_(helperSheet, maxCols);
    helperSheet.getRange(1, 1, writeData.length, maxCols).setValues(writeData);
    Logger.log(`  Wrote ${writeData.length} rows x ${maxCols} cols to ${sourceConfig.targetTab}`);

    // Call the processor
    try {
      processorFn(helperSheet);
      totalRows += dataRows.length;
      Logger.log(`  ✓ Processor completed for ${csvFile.fileName}`);
    } catch (procError) {
      Logger.log(`  ERROR in processor: ${procError.toString()}`);
      logError_('DRIVE_IMPORT', 'PROCESSOR_ERROR', `${sourceConfig.label} - ${csvFile.fileName}`, procError.toString());
      fileLog.status = 'PROCESSOR_ERROR: ' + procError.message;
      errors.push(`${csvFile.fileName}: ${procError.message}`);

      if (!silent) {
        ui.alert('Processor Error', `Error processing ${csvFile.fileName}:\n${procError.message}`, ui.ButtonSet.OK);
      }
    }

    fileResults.push(fileLog);
  }

  // Move all CSVs to processed folder
  const movedCount = moveCSVsToProcessed_(sourceFolderId, processedFolderId);
  Logger.log(`  Moved ${movedCount} CSV file(s) to Processed folder`);

  // Log the import run with full detail
  persistRunLog_('DriveImport_' + sourceKey, {
    runId: isoNow_(),
    source: sourceConfig.label,
    filesProcessed: csvFiles.length,
    rowsProcessed: totalRows,
    filesMoved: movedCount,
    files: fileResults,
    errors: errors.length > 0 ? errors : undefined
  });

  if (!silent) {
    getSpreadsheet_().toast(
      `✓ ${sourceConfig.label}: ${csvFiles.length} file(s), ${totalRows} rows processed`,
      'Drive Import',
      5
    );
  }

  return {
    source: sourceConfig.label,
    filesProcessed: csvFiles.length,
    rowsProcessed: totalRows
  };
}

/** ==========================================================================
 *  UTILITY: STATUS CHECK
 *  ========================================================================== */

/**
 * Check which Drive import folders have pending CSVs
 * Shows a summary dialog - useful for quick check before running import
 */
function Check_Drive_Import_Status() {
  let hasUI = false;
  try { SpreadsheetApp.getUi(); hasUI = true; } catch (e) { hasUI = false; }

  const sources = DRIVE_IMPORT.sources;
  let summary = 'Drive Import Folder Status:\n\n';
  let totalPending = 0;
  const status = {};

  for (const key in sources) {
    const source = sources[key];
    const folderId = getSourceFolderId_(source.propKey);

    if (!folderId) {
      summary += `${source.label}: NOT SET UP\n`;
      status[key] = { label: source.label, count: -1, error: 'NOT SET UP' };
      continue;
    }

    try {
      const count = countCSVsInFolder_(folderId);
      totalPending += count;
      status[key] = { label: source.label, count: count };
      if (count > 0) {
        summary += `${source.label}: ${count} CSV file(s) pending\n`;
      } else {
        summary += `${source.label}: empty\n`;
      }
    } catch (e) {
      summary += `${source.label}: folder access error\n`;
      status[key] = { label: source.label, count: -1, error: e.message };
    }
  }

  summary += `\nTotal pending: ${totalPending} file(s)`;
  Logger.log(summary);

  if (hasUI) {
    SpreadsheetApp.getUi().alert('Drive Import Status', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  }

  return { totalPending, status };
}
