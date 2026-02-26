/**
 * BD TRACKER - CSV FILE UTILITIES
 * Version: 1.0.0 (Split from 00d_CSV_Helpers.gs)
 * @execution manual, pipeline
 *
 * CONTAINS:
 * - CSV header validation
 * - Drive file movement utilities
 *
 * DEPENDENCIES: 00_Brain_Config.gs (DRIVE_IMPORT config)
 * SEE ALSO: 00d_CSV_Helpers.gs (CSV reading and parsing)
 */

/** ==========================================================================
 *  HEADER VALIDATION
 *  ========================================================================== */

/**
 * Validate CSV headers against expected schema
 * Checks that all expected headers are present (order doesn't matter for validation,
 * but the CSV column order is preserved as-is for writing to the helper tab)
 *
 * @param {Array<string>} csvHeaders - Headers from the CSV file
 * @param {Array<string>} expectedHeaders - Expected headers from config
 * @param {string} sourceName - Source name for error messages
 * @returns {Object} - {isValid, missing, extra, message}
 */
function validateCSVHeaders_(csvHeaders, expectedHeaders, sourceName) {
  const cleanCSV = csvHeaders.map(h => String(h).trim());
  const cleanExpected = expectedHeaders.map(h => String(h).trim());

  // Case-insensitive comparison (CSV sources may change casing between exports)
  const csvLower = cleanCSV.map(h => h.toLowerCase());
  const expectedLower = cleanExpected.map(h => h.toLowerCase());

  const missing = cleanExpected.filter((h, i) => !csvLower.includes(expectedLower[i]));
  const extra = cleanCSV.filter((h, i) => !expectedLower.includes(csvLower[i]));

  const isValid = missing.length === 0;

  let message = '';
  if (!isValid) {
    message = `Header validation FAILED for ${sourceName}.\n`;
    message += `Missing headers: ${missing.join(', ')}\n`;
    if (extra.length > 0) {
      message += `Extra headers found: ${extra.join(', ')}\n`;
    }
    message += `Expected ${expectedHeaders.length} columns, got ${csvHeaders.length}`;
  }

  return { isValid, missing, extra, message };
}

/** ==========================================================================
 *  DRIVE FILE MOVEMENT
 *  ========================================================================== */

/**
 * Move all CSV files from source folder to processed folder
 * Files are moved (not copied) - removed from source, added to target
 *
 * @param {string} sourceFolderId - Source folder ID
 * @param {string} processedFolderId - Processed/archive folder ID
 * @returns {number} - Number of files moved
 */
function moveCSVsToProcessed_(sourceFolderId, processedFolderId) {
  const sourceFolder = DriveApp.getFolderById(sourceFolderId);
  const processedFolder = DriveApp.getFolderById(processedFolderId);
  const allFiles = sourceFolder.getFiles();
  let movedCount = 0;

  while (allFiles.hasNext()) {
    const file = allFiles.next();
    const fileName = file.getName();

    if (!fileName.toLowerCase().endsWith('.csv')) continue;

    // Atomic move — single operation, no duplicate risk
    file.moveTo(processedFolder);
    Logger.log(`  Moved "${fileName}" → Processed folder`);
    movedCount++;
  }

  return movedCount;
}

/**
 * Get the processed folder ID from ScriptProperties
 * @returns {string|null} - Folder ID or null if not set up
 */
function getProcessedFolderId_() {
  return PropertiesService.getScriptProperties().getProperty(DRIVE_IMPORT.processedPropKey);
}

/**
 * Get a source folder ID from ScriptProperties
 * @param {string} propKey - Property key for the source folder
 * @returns {string|null} - Folder ID or null if not set up
 */
function getSourceFolderId_(propKey) {
  return PropertiesService.getScriptProperties().getProperty(propKey);
}
