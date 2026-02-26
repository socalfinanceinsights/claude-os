/**
 * 00c_CSV_Helpers.gs
 * CSV parsing and Drive file movement utilities
 *
 * PURPOSE: Read CSV files from Drive, parse content, move processed files
 * DEPENDENCIES: 00a_Config.gs (constants)
 */

/**
 * Read CSV file from Drive folder
 * @param {string} folderId - Drive folder ID
 * @param {string} filename - CSV filename (partial match OK)
 * @returns {Array<Object>} - Array of row objects
 */
function readCSVFromDrive(folderId, filename) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(filename);

  if (!files.hasNext()) {
    // Try partial match
    const allFiles = folder.getFiles();
    while (allFiles.hasNext()) {
      const file = allFiles.next();
      if (file.getName().includes(filename.replace('.csv', ''))) {
        return parseCSV(file);
      }
    }
    throw new Error(`CSV file "${filename}" not found in folder ${folderId}`);
  }

  const file = files.next();
  return parseCSV(file);
}

/**
 * Read ALL CSV files from a Drive folder and combine them
 * @param {string} folderId - Drive folder ID
 * @returns {Array<Object>} - Combined array of row objects from all CSV files
 */
function readAllCSVsFromDrive(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const allFiles = folder.getFiles();
  const combinedData = [];
  let fileCount = 0;

  while (allFiles.hasNext()) {
    const file = allFiles.next();
    const fileName = file.getName();

    // Read ANY .csv file
    if (fileName.endsWith('.csv')) {
      Logger.log(`Reading file: ${fileName}`);
      const csvData = parseCSV(file);
      combinedData.push(...csvData);
      fileCount++;
    }
  }

  Logger.log(`Combined ${combinedData.length} rows from ${fileCount} CSV files`);
  return combinedData;
}

/**
 * Parse CSV file content to array of objects
 * Standard CSV format: Headers in row 1, data starts row 2
 * Handles multi-line quoted fields (newlines inside quotes)
 * @param {File} file - Drive file object
 * @returns {Array<Object>} - Array of row objects with headers as keys
 */
function parseCSV(file) {
  const content = file.getBlob().getDataAsString();

  // Split into rows, respecting quotes (handles newlines inside quoted fields)
  const rows = splitCSVRows(content);

  if (rows.length === 0) return [];

  // Headers are in row 1 (index 0)
  const headers = parseCSVLine(rows[0]).map(h => h.trim().replace(/"/g, ''));

  Logger.log(`Found ${headers.length} headers: ${headers.join(', ')}`);

  const parsedRows = [];

  // Data starts from row 2 (index 1)
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].trim()) continue; // Skip empty lines

    const values = parseCSVLine(rows[i]);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    parsedRows.push(row);
  }

  return parsedRows;
}

/**
 * Split CSV content into rows, respecting quoted fields with newlines
 * @param {string} content - Full CSV content
 * @returns {Array<string>} - Array of row strings
 */
function splitCSVRows(content) {
  const rows = [];
  let currentRow = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      // Handle escaped quotes ("")
      if (nextChar === '"') {
        currentRow += '""';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
        currentRow += char;
      }
    } else if (char === '\n' && !inQuotes) {
      // End of row (only if not inside quotes)
      if (currentRow.trim()) {
        rows.push(currentRow);
      }
      currentRow = '';
    } else {
      currentRow += char;
    }
  }

  // Add last row if exists
  if (currentRow.trim()) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Parse single CSV line (handles quoted commas)
 * @param {string} line - CSV line
 * @returns {Array<string>} - Array of values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values.map(v => v.replace(/^"|"$/g, '')); // Remove surrounding quotes
}

// ============================================
// DRIVE FILE MOVEMENT
// ============================================

/**
 * Move file from source folder to processed folder
 * @param {string} sourceFolderId - Source folder ID
 * @param {string} targetFolderId - Target folder ID
 * @param {string} filename - File to move
 */
function moveFileToProcessed(sourceFolderId, targetFolderId, filename) {
  const sourceFolder = DriveApp.getFolderById(sourceFolderId);
  const targetFolder = DriveApp.getFolderById(targetFolderId);
  const files = sourceFolder.getFilesByName(filename);

  if (files.hasNext()) {
    const file = files.next();
    file.addToFolder(targetFolder);
    file.removeFromFolder(sourceFolder);
    Logger.log(`Moved file "${filename}" to Processed folder`);
  } else {
    Logger.log(`File "${filename}" not found for moving`);
  }
}

/**
 * Move ALL CSV files matching a pattern to processed folder
 * @param {string} sourceFolderId - Source folder ID
 * @param {string} targetFolderId - Target folder ID
 * @param {string} filenamePattern - Pattern to match (e.g., "CandidateDetailedNotes")
 */
function moveAllFilesToProcessed(sourceFolderId, targetFolderId, filenamePattern) {
  const sourceFolder = DriveApp.getFolderById(sourceFolderId);
  const targetFolder = DriveApp.getFolderById(targetFolderId);
  const allFiles = sourceFolder.getFiles();
  let movedCount = 0;

  while (allFiles.hasNext()) {
    const file = allFiles.next();
    const fileName = file.getName();

    if (fileName.includes(filenamePattern) && fileName.endsWith('.csv')) {
      targetFolder.addFile(file);
      sourceFolder.removeFile(file);
      Logger.log(`Moved file "${fileName}" to Processed folder`);
      movedCount++;
    }
  }

  Logger.log(`Moved ${movedCount} files to Processed folder`);
}

/**
 * Move ALL CSV files to processed folder (no pattern matching)
 * @param {string} sourceFolderId - Source folder ID
 * @param {string} targetFolderId - Target folder ID
 */
function moveAllCSVFilesToProcessed(sourceFolderId, targetFolderId) {
  const sourceFolder = DriveApp.getFolderById(sourceFolderId);
  const targetFolder = DriveApp.getFolderById(targetFolderId);
  const allFiles = sourceFolder.getFiles();
  let movedCount = 0;

  while (allFiles.hasNext()) {
    const file = allFiles.next();
    const fileName = file.getName();

    if (fileName.endsWith('.csv')) {
      targetFolder.addFile(file);
      sourceFolder.removeFile(file);
      Logger.log(`Moved file "${fileName}" to Processed folder`);
      movedCount++;
    }
  }

  Logger.log(`Moved ${movedCount} CSV files to Processed folder`);
}
