/**
 * BD TRACKER - CSV HELPERS
 * Version: 1.1.0 (Split: file utils moved to 00e)
 * @execution manual, pipeline
 *
 * CONTAINS:
 * - CSV reading from Google Drive folders
 * - CSV parsing (multi-line quoted fields)
 *
 * ADAPTED FROM: 05_Candidate_Tracker/scripts/00c_CSV_Helpers.gs
 * All functions use underscore suffix (private) to avoid collisions.
 *
 * DEPENDENCIES: 00_Brain_Config.gs (DRIVE_IMPORT config)
 * SEE ALSO: 00e_CSV_File_Utils.gs (header validation, Drive file movement)
 */

/** ==========================================================================
 *  CSV READING FROM DRIVE
 *  ========================================================================== */

/**
 * Read all CSV files from a Drive folder and parse to 2D arrays
 * Returns array of {fileName, headers, data} objects
 *
 * @param {string} folderId - Google Drive folder ID
 * @returns {Array<Object>} - [{fileName, headers, data (2D array without headers)}]
 */
function readCSVsFromDriveFolder_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const allFiles = folder.getFiles();
  const results = [];

  while (allFiles.hasNext()) {
    const file = allFiles.next();
    const fileName = file.getName();

    if (!fileName.toLowerCase().endsWith('.csv')) continue;

    Logger.log(`Reading CSV: ${fileName}`);
    const content = file.getBlob().getDataAsString();
    const parsed = parseCSVContent_(content);

    if (parsed.length === 0) {
      Logger.log(`  WARNING: ${fileName} is empty, skipping`);
      continue;
    }

    const headers = parsed[0];
    const data = parsed.slice(1);

    results.push({
      fileName: fileName,
      headers: headers,
      data: data
    });

    Logger.log(`  Parsed ${data.length} data rows, ${headers.length} columns`);
  }

  return results;
}

/**
 * Check if a Drive folder has any CSV files
 *
 * @param {string} folderId - Google Drive folder ID
 * @returns {number} - Count of CSV files found
 */
function countCSVsInFolder_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const allFiles = folder.getFiles();
  let count = 0;

  while (allFiles.hasNext()) {
    const file = allFiles.next();
    if (file.getName().toLowerCase().endsWith('.csv')) count++;
  }

  return count;
}

/** ==========================================================================
 *  CSV PARSING
 *  ========================================================================== */

/**
 * Parse CSV content string to 2D array
 * Handles multi-line quoted fields, escaped quotes, and quoted commas
 *
 * @param {string} content - Raw CSV file content
 * @returns {Array<Array<string>>} - 2D array (row 0 = headers, rows 1+ = data)
 */
function parseCSVContent_(content) {
  if (!content || !content.trim()) return [];

  // Handle Windows line endings
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows = splitCSVRows_(content);
  if (rows.length === 0) return [];

  const result = [];

  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].trim()) continue;
    const values = parseCSVLine_(rows[i]);
    result.push(values);
  }

  return result;
}

/**
 * Split CSV content into rows, respecting quoted fields with embedded newlines
 *
 * @param {string} content - Full CSV content
 * @returns {Array<string>} - Array of row strings
 */
function splitCSVRows_(content) {
  const rows = [];
  let currentRow = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote ("") - keep both and skip next
        currentRow += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        currentRow += char;
      }
    } else if (char === '\n' && !inQuotes) {
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
 * Parse a single CSV line into array of values
 * Handles quoted commas and strips surrounding quotes
 *
 * @param {string} line - Single CSV row string
 * @returns {Array<string>} - Array of cell values
 */
function parseCSVLine_(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside quoted field → keep one quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

// Header validation and Drive file movement moved to 00e_CSV_File_Utils.gs
