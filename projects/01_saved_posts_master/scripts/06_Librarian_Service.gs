/**
 * LIBRARIAN SERVICE
 * 
 * Provides direct access to specific rows in the PostMasterList by SourceID.
 * Used for precise retrieval of content for analysis.
 * 
 * Usage: fetchRowData("EMAIL_123...")
 */

/**
 * Fetches the full JSON object for a specific SourceID.
 * 
 * @param {string} sourceId - The unique ID to find (e.g., EMAIL_123, DRIVE_456)
 * @return {string} JSON string of the row data, or null if not found.
 */
function fetchRowData(sourceId) {
  if (!sourceId) {
    Logger.log("Error: No SourceID provided.");
    return null;
  }

  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Map headers using shared helper if available, or manual map
  // We use the shared CONSTANTS from 00_Brain_Config.gs
  
  let colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  // Manual fallback map in case headers drift
  const idCol = colMap['SourceID'];
  
  if (idCol === undefined) {
    Logger.log("Error: SourceID column not found in " + TARGET_SHEET_NAME);
    return null;
  }

  Logger.log("Librarian searching for: " + sourceId);

  // Scan rows
  for (let i = 1; i < data.length; i++) {
    // String comparison to be safe
    if (String(data[i][idCol]).trim() === String(sourceId).trim()) {
      const row = data[i];
      
      // Construct a clean object with all fields
      const result = {};
      headers.forEach((h, index) => {
        result[h] = row[index];
      });

      Logger.log("✅ Librarian found: " + result['Title']);
      return JSON.stringify(result);
    }
  }
  
  Logger.log("❌ Librarian: Item not found [" + sourceId + "]");
  return null;
}

/**
 * Exports specific rows to a JSON file in Drive for easy ingestion.
 * 
 * @param {Array<string>} sourceIds - List of SourceIDs to export
 * @return {string} Status message
 */
function exportRowsToDrive(sourceIds) {
  if (!sourceIds || sourceIds.length === 0) {
    return "Error: No IDs provided.";
  }

  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Map headers
  let colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  const idCol = colMap['SourceID'];
  
  if (idCol === undefined) return "Error: SourceID column missing.";

  const exportData = [];
  
  // Scan for matches (O(N*M) but fast enough for 3500 rows)
  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][idCol]).trim();
    if (sourceIds.includes(rowId)) {
      const item = {};
      headers.forEach((h, index) => {
        item[h] = data[i][index];
      });
      exportData.push(item);
    }
  }

  if (exportData.length === 0) return "No matching IDs found.";

  // Save to Drive Root (or specific folder)
  const fileName = "_Brain_Checkout.json";
  const content = JSON.stringify(exportData, null, 2);
  
  const files = DriveApp.getFilesByName(fileName);
  if (files.hasNext()) {
    files.next().setContent(content);
  } else {
    DriveApp.createFile(fileName, content, MimeType.PLAIN_TEXT);
  }
  
  return `Exported ${exportData.length} items to ${fileName}`;
}

/**
 * Test function for manual checkout.
 */
function testCheckout() {
  const ids = ["EMAIL_19bc7d0a41ca2eaf", "DRIVE_011926_808", "DRIVE_011926_393"];
  Logger.log(exportRowsToDrive(ids));
}
