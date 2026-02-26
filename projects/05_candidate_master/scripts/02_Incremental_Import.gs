/**
 * 02_Incremental_Import.gs
 * Quarterly incremental imports (LinkedIn + Bullhorn)
 *
 * PURPOSE: Import only NEW data since last import (Connected On date filtering)
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00c_CSV_Helpers.gs,
 *               00d_Name_Matching.gs, 01b_Import_Helpers.gs, 96b_Dedup_Helpers.gs
 */

// ============================================
// INCREMENTAL LINKEDIN IMPORT
// ============================================

/**
 * Import only NEW LinkedIn connections (Connected On > last import date)
 * USER-FACING: Run quarterly after exporting new LinkedIn CSV
 */
function importLinkedInIncremental() {
  Logger.log("=== Starting LinkedIn Incremental Import ===");

  try {
    // Step 1: Get last LinkedIn import date from Import_Log
    const lastImportDate = getLastImportDate('LinkedIn Connections');
    Logger.log(`Last LinkedIn import: ${lastImportDate}`);

    // Step 2: Read ALL CSV files from LinkedIn folder
    Logger.log("Step 2: Reading CSV files...");
    const linkedInData = readAllCSVsFromDrive(LINKEDIN_CSV_FOLDER_ID);
    Logger.log(`Found ${linkedInData.length} total connections in CSV`);

    // Step 3: Filter to only NEW connections (Connected On > last import)
    const newConnections = linkedInData.filter(conn => {
      const connectedOn = parseLinkedInDate(conn['Connected On']);
      return connectedOn > lastImportDate;
    });

    Logger.log(`Filtered to ${newConnections.length} NEW connections (Connected On > ${lastImportDate})`);

    if (newConnections.length === 0) {
      Logger.log("No new connections to import.");
      return { success: true, inserted: 0, updated: 0 };
    }

    // Step 4: Build lookup map of existing candidates
    Logger.log("Step 4: Building existing candidate lookup...");
    const existingByLinkedIn = buildCandidateLookupMap('LinkedIn_URL');
    const existingByEmail = buildCandidateLookupMap('Email');

    // Step 5: Process new LinkedIn connections (UPSERT)
    Logger.log("Step 5: Processing new connections...");
    const results = processLinkedInConnections(newConnections, existingByLinkedIn, existingByEmail);

    Logger.log(`LinkedIn incremental import complete: ${results.updated} updated, ${results.inserted} new`);

    // Step 6: Move ALL CSV files to Processed folder
    Logger.log("Step 6: Moving processed files...");
    moveAllCSVFilesToProcessed(LINKEDIN_CSV_FOLDER_ID, LINKEDIN_PROCESSED_FOLDER_ID);

    // Count CSV files for logging
    const folder = DriveApp.getFolderById(LINKEDIN_PROCESSED_FOLDER_ID);
    const csvFiles = [];
    const allFiles = folder.getFiles();
    while (allFiles.hasNext()) {
      const file = allFiles.next();
      if (file.getName().endsWith('.csv')) {
        csvFiles.push(file.getName());
      }
    }
    const fileNames = csvFiles.slice(-3).join(', '); // Last 3 files moved

    // Log successful import
    logImport(
      "LinkedIn Connections (Incremental)",
      fileNames || "CSV files",
      newConnections.length,
      results.updated + results.inserted,
      "Success",
      `${results.updated} updated, ${results.inserted} new candidates (filtered from ${linkedInData.length} total)`
    );

    Logger.log("=== LinkedIn Incremental Import Complete ===");
    return results;

  } catch (e) {
    // Log failed import
    logImport(
      "LinkedIn Connections (Incremental)",
      "Unknown",
      0,
      0,
      "Failed",
      e.message
    );
    logError("LINKEDIN_INCREMENTAL_IMPORT_ERROR", e.message, e.stack);
    throw e;
  }
}

/**
 * Get last successful import date for a given import type
 * @param {string} importType - Import type to search for (e.g., "LinkedIn Connections")
 * @returns {Date} - Last import date, or epoch if no imports found
 */
function getLastImportDate(importType) {
  const sheet = getSheetByName(TAB_IMPORT_LOG);
  const data = sheet.getDataRange().getValues();

  // Find most recent successful import of this type
  const headers = data[0];
  const colTimestamp = headers.indexOf('Timestamp');
  const colType = headers.indexOf('Import_Type');
  const colStatus = headers.indexOf('Status');
  let lastDate = new Date(0); // Epoch (1970-01-01)

  for (let i = data.length - 1; i >= 1; i--) { // Start from bottom, work up
    const row = data[i];
    const timestamp = row[colTimestamp];
    const type = row[colType];
    const status = row[colStatus];

    if (type.includes(importType) && status === 'Success') {
      return new Date(timestamp);
    }
  }

  Logger.log(`No previous ${importType} import found. Using epoch date.`);
  return lastDate;
}

/**
 * Parse LinkedIn "Connected On" date string to Date object
 * LinkedIn format: "8 Feb 2026" or "08 Feb 2026"
 * @param {string} dateStr - LinkedIn date string
 * @returns {Date} - Parsed date
 */
function parseLinkedInDate(dateStr) {
  if (!dateStr) return new Date(0);

  try {
    // LinkedIn format: "8 Feb 2026"
    const parts = dateStr.trim().split(' ');
    if (parts.length !== 3) return new Date(0);

    const day = parseInt(parts[0]);
    const monthStr = parts[1];
    const year = parseInt(parts[2]);

    const monthMap = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };

    const month = monthMap[monthStr];
    if (month === undefined) return new Date(0);

    return new Date(year, month, day);

  } catch (e) {
    Logger.log(`Error parsing date: ${dateStr} - ${e.message}`);
    return new Date(0);
  }
}

// ============================================
// INCREMENTAL BULLHORN IMPORT
// ============================================

/**
 * Import only NEW Bullhorn notes (from last 3 months export)
 * USER-FACING: Run quarterly after exporting new Bullhorn CSV
 *
 * NOTE: Bullhorn exports are already date-filtered (last 3 months)
 * So this function just runs the normal import - no date filtering needed
 */
function importBullhornIncremental() {
  Logger.log("=== Starting Bullhorn Incremental Import ===");
  Logger.log("NOTE: Bullhorn export should already be filtered to last 3 months");

  try {
    // Get first CSV file in the folder
    const folder = DriveApp.getFolderById(BULLHORN_CSV_FOLDER_ID);
    const allFiles = folder.getFiles();
    let csvFile = null;

    while (allFiles.hasNext()) {
      const file = allFiles.next();
      if (file.getName().endsWith('.csv')) {
        csvFile = file;
        break; // Process only the FIRST CSV file found
      }
    }

    if (!csvFile) {
      Logger.log("No CSV files found in folder");
      return { success: true, inserted: 0, updated: 0 };
    }

    const fileName = csvFile.getName();
    Logger.log(`Processing: ${fileName}`);

    // Step 1: Parse CSV
    const notes = parseCSV(csvFile);
    Logger.log(`Found ${notes.length} notes`);

    // Step 2: Write to Notes_Archive
    Logger.log("Writing to Notes_Archive...");
    writeNotesToArchive(notes);

    // Step 3: Extract unique candidates
    Logger.log("Extracting unique candidates...");
    const candidates = extractCandidatesFromNotes(notes);
    Logger.log(`Extracted ${candidates.length} unique candidates`);

    // Step 4: Write to Candidate_Master (UPSERT) with BHNotes import stamp
    Logger.log("Writing to Candidate_Master...");
    const results = writeCandidatesToMaster(candidates, IMPORT_PREFIX_BH_NOTES);

    // Step 5: Move THIS file to Processed folder
    Logger.log("Moving processed file...");
    const targetFolder = DriveApp.getFolderById(BULLHORN_PROCESSED_FOLDER_ID);
    targetFolder.addFile(csvFile);
    folder.removeFile(csvFile);
    Logger.log(`Moved "${fileName}" to Processed folder`);

    // Log successful import
    logImport(
      "Bullhorn Notes (Incremental)",
      fileName,
      notes.length,
      results.inserted + results.updated,
      "Success",
      `${results.inserted} new, ${results.updated} updated from ${notes.length} notes`
    );

    Logger.log("=== Bullhorn Incremental Import Complete ===");
    return results;

  } catch (e) {
    // Log failed import
    logImport(
      "Bullhorn Notes (Incremental)",
      csvFile ? csvFile.getName() : "Unknown",
      0,
      0,
      "Failed",
      e.message
    );
    logError("BULLHORN_INCREMENTAL_IMPORT_ERROR", e.message, e.stack);
    throw e;
  }
}

// ============================================
// QUARTERLY ORCHESTRATION
// ============================================

/**
 * Run full quarterly update workflow
 * USER-FACING: Run this quarterly to update both LinkedIn and Bullhorn
 *
 * WORKFLOW:
 * 1. Import new LinkedIn connections (Connected On > last import)
 * 2. Import new Bullhorn notes (last 3 months export)
 * 3. Run incremental deduplication (new vs new only)
 */
function runQuarterlyUpdate() {
  Logger.log("=== Starting Quarterly Update ===");

  const results = {
    linkedin: { inserted: 0, updated: 0 },
    bullhorn: { inserted: 0, updated: 0 },
    deduplication: { exactMatches: 0, fuzzyMatches: 0, noMatches: 0 }
  };

  try {
    // Step 1: Import new LinkedIn connections
    Logger.log("Step 1: Importing new LinkedIn connections...");
    results.linkedin = importLinkedInIncremental();

    // Step 2: Import new Bullhorn notes
    Logger.log("Step 2: Importing new Bullhorn notes...");
    results.bullhorn = importBullhornIncremental();

    // Step 3: Run incremental deduplication
    Logger.log("Step 3: Running incremental deduplication...");
    results.deduplication = runIncrementalDeduplication();

    Logger.log("=== Quarterly Update Complete ===");
    Logger.log(`LinkedIn: ${results.linkedin.inserted} new, ${results.linkedin.updated} updated`);
    Logger.log(`Bullhorn: ${results.bullhorn.inserted} new, ${results.bullhorn.updated} updated`);
    Logger.log(`Deduplication: ${results.deduplication.exactMatches} merged, ${results.deduplication.fuzzyMatches} for review`);

    return results;

  } catch (e) {
    Logger.log(`ERROR in runQuarterlyUpdate: ${e.message}`);
    logError("QUARTERLY_UPDATE_ERROR", e.message, e.stack);
    throw e;
  }
}

/**
 * Run incremental deduplication
 * Matches NEW LinkedIn connections against NEW Bullhorn candidates only
 *
 * @returns {Object} - Deduplication results
 */
function runIncrementalDeduplication() {
  Logger.log("=== Starting Incremental Deduplication ===");

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const masterSheet = ss.getSheetByName(TAB_CANDIDATE_MASTER);

    // Get cutoff date (last LinkedIn import before this one)
    const importLog = getSheetByName(TAB_IMPORT_LOG);
    const logData = importLog.getDataRange().getValues();
    let cutoffDate = new Date(0);

    // Find second-to-last LinkedIn import (current import is most recent)
    const logHeaders = logData[0];
    const logColTimestamp = logHeaders.indexOf('Timestamp');
    const logColType = logHeaders.indexOf('Import_Type');

    let linkedInImportCount = 0;
    for (let i = logData.length - 1; i >= 1; i--) {
      const type = logData[i][logColType];
      if (type.includes('LinkedIn')) {
        linkedInImportCount++;
        if (linkedInImportCount === 2) {
          cutoffDate = new Date(logData[i][logColTimestamp]);
          break;
        }
      }
    }

    Logger.log(`Cutoff date: ${cutoffDate}`);

    // Get NEW LinkedIn candidates (Last_LinkedIn_Refresh > cutoff)
    const newLinkedInCandidates = getNewLinkedInCandidates(masterSheet, cutoffDate);
    Logger.log(`Found ${newLinkedInCandidates.length} new LinkedIn candidates`);

    // Get NEW Bullhorn candidates (Last_Bullhorn_Contact > cutoff)
    const newBullhornCandidates = getNewBullhornCandidates(masterSheet, cutoffDate);
    Logger.log(`Found ${newBullhornCandidates.length} new Bullhorn candidates`);

    if (newLinkedInCandidates.length === 0) {
      Logger.log("No new LinkedIn candidates to match. Skipping deduplication.");
      return { exactMatches: 0, fuzzyMatches: 0, noMatches: 0 };
    }

    // Run matching for each new LinkedIn candidate
    let exactMatches = 0;
    let fuzzyMatches = 0;
    let noMatches = 0;

    for (const linkedInCandidate of newLinkedInCandidates) {
      Logger.log(`Matching: ${linkedInCandidate.fullName} @ ${linkedInCandidate.currentCompany}`);

      const geminiMatches = findMatchesWithGemini(linkedInCandidate, newBullhornCandidates);

      if (geminiMatches.length === 0) {
        Logger.log(`  → NO MATCH`);
        markAsProcessed(masterSheet, linkedInCandidate.rowNum, 'NO_MATCH');
        noMatches++;
      } else if (geminiMatches[0].confidence >= 95) {
        Logger.log(`  → AUTO-MERGE (${geminiMatches[0].confidence}%)`);
        mergeLinkedInToBullhorn(masterSheet, linkedInCandidate, geminiMatches[0].bullhornCandidate);
        exactMatches++;
      } else {
        Logger.log(`  → REVIEW TAB (${geminiMatches[0].confidence}%)`);
        writeToReviewTab(ss, linkedInCandidate, geminiMatches.slice(0, 3));
        markAsProcessed(masterSheet, linkedInCandidate.rowNum, 'REVIEW');
        fuzzyMatches++;
      }

      Utilities.sleep(500); // Rate limit
    }

    Logger.log("=== Incremental Deduplication Complete ===");
    Logger.log(`Exact matches: ${exactMatches}, Fuzzy matches: ${fuzzyMatches}, No matches: ${noMatches}`);

    return {
      exactMatches: exactMatches,
      fuzzyMatches: fuzzyMatches,
      noMatches: noMatches
    };

  } catch (error) {
    Logger.log(`ERROR in runIncrementalDeduplication: ${error.message}`);
    logError("INCREMENTAL_DEDUPLICATION_ERROR", error.message, error.stack);
    throw error;
  }
}

/**
 * Get NEW LinkedIn candidates (Last_LinkedIn_Refresh > cutoff date)
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {Date} cutoffDate - Only include candidates added after this date
 * @returns {Array} - Array of new LinkedIn candidate objects
 */
function getNewLinkedInCandidates(masterSheet, cutoffDate) {
  const data = masterSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const candidates = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const lastLinkedInRefresh = row[colMap['Last_LinkedIn_Refresh']];
    const lastBullhornContact = row[colMap['Last_Bullhorn_Contact']];

    // LinkedIn-only candidates added after cutoff
    if (!lastBullhornContact && lastLinkedInRefresh && new Date(lastLinkedInRefresh) > cutoffDate) {
      candidates.push({
        rowNum: i + 1,
        uid: row[colMap['UID']],
        fullName: row[colMap['Full_Name']],
        currentTitle: row[colMap['Current_Title']],
        currentCompany: row[colMap['Current_Company']],
        linkedInUrl: row[colMap['LinkedIn_URL']],
        email: row[colMap['Email']],
        phone: row[colMap['Phone']],
        location: row[colMap['Location']],
        keySkills: row[colMap['Key_Skills']]
      });
    }
  }

  return candidates;
}

/**
 * Get NEW Bullhorn candidates (Last_Bullhorn_Contact > cutoff date)
 * @param {Sheet} masterSheet - Candidate_Master sheet
 * @param {Date} cutoffDate - Only include candidates added after this date
 * @returns {Array} - Array of new Bullhorn candidate objects
 */
function getNewBullhornCandidates(masterSheet, cutoffDate) {
  const data = masterSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const candidates = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const lastBullhornContact = row[colMap['Last_Bullhorn_Contact']];

    // Bullhorn candidates added after cutoff
    if (lastBullhornContact && new Date(lastBullhornContact) > cutoffDate) {
      candidates.push({
        rowNum: i + 1,
        uid: row[colMap['UID']],
        fullName: row[colMap['Full_Name']],
        currentTitle: row[colMap['Current_Title']],
        currentCompany: row[colMap['Current_Company']]
      });
    }
  }

  return candidates;
}
