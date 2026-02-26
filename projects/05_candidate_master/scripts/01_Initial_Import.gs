/**
 * 01_Initial_Import.gs
 * Orchestrators for Bullhorn notes, LinkedIn connections, and Bullhorn candidate data imports
 *
 * PURPOSE: Top-level import functions that coordinate CSV reading, parsing, and UPSERT to Candidate_Master
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00c_CSV_Helpers.gs,
 *               00d_Name_Matching.gs, 00e_Note_Parsers.gs, 01b_Import_Helpers.gs
 *
 * HELPER FUNCTIONS: All data transformation, note filtering, UPSERT logic,
 * and field update helpers live in 01b_Import_Helpers.gs
 */

// ============================================
// BULLHORN NOTES IMPORT
// ============================================

/**
 * Import Bullhorn notes from CSV → Notes_Archive + Candidate_Master
 * Processes one CSV file at a time from BULLHORN_CSV_FOLDER_ID
 */
function importBullhornNotes() {
  Logger.log("=== Starting Bullhorn Import ===");

  try {
    const folder = DriveApp.getFolderById(BULLHORN_CSV_FOLDER_ID);
    const allFiles = folder.getFiles();
    let csvFile = null;

    while (allFiles.hasNext()) {
      const file = allFiles.next();
      if (file.getName().endsWith('.csv')) {
        csvFile = file;
        break;
      }
    }

    if (!csvFile) {
      Logger.log("No CSV files found in folder");
      return { success: true, candidateCount: 0 };
    }

    const fileName = csvFile.getName();
    Logger.log(`Processing: ${fileName}`);

    // Step 1: Parse CSV
    const notes = parseCSV(csvFile);
    Logger.log(`Found ${notes.length} notes`);

    // Step 2: Write to Notes_Archive
    writeNotesToArchive(notes);

    // Step 3: Extract unique candidates
    const candidates = extractCandidatesFromNotes(notes);
    Logger.log(`Extracted ${candidates.length} unique candidates`);

    // Step 4: Write to Candidate_Master (UPSERT) with BHNotes import stamp
    writeCandidatesToMaster(candidates, IMPORT_PREFIX_BH_NOTES);

    // Step 5: Move file to Processed folder
    const targetFolder = DriveApp.getFolderById(BULLHORN_PROCESSED_FOLDER_ID);
    targetFolder.addFile(csvFile);
    folder.removeFile(csvFile);
    Logger.log(`Moved "${fileName}" to Processed folder`);

    logImport("Bullhorn Notes", fileName, notes.length, candidates.length,
      "Success", `${candidates.length} candidates extracted from ${notes.length} notes`);

    Logger.log("=== Bullhorn Import Complete ===");
    return { success: true, candidateCount: candidates.length };

  } catch (e) {
    logImport("Bullhorn Notes", csvFile ? csvFile.getName() : "Unknown", 0, 0, "Failed", e.message);
    logError("BULLHORN_IMPORT_ERROR", e.message, e.stack);
    throw e;
  }
}

// ============================================
// LINKEDIN IMPORT
// ============================================

/**
 * Import LinkedIn connections from CSV → Candidate_Master
 * Reads ALL CSV files from LINKEDIN_CSV_FOLDER_ID, merges via UPSERT
 */
function importLinkedInConnections() {
  Logger.log("=== Starting LinkedIn Import ===");

  try {
    // Read ALL CSV files from LinkedIn folder
    const linkedInData = readAllCSVsFromDrive(LINKEDIN_CSV_FOLDER_ID);
    Logger.log(`Found ${linkedInData.length} LinkedIn connections`);

    // Count CSV files for logging
    const folder = DriveApp.getFolderById(LINKEDIN_CSV_FOLDER_ID);
    const csvFiles = [];
    const allFiles = folder.getFiles();
    while (allFiles.hasNext()) {
      const file = allFiles.next();
      if (file.getName().endsWith('.csv')) {
        csvFiles.push(file.getName());
      }
    }
    const fileNames = csvFiles.join(', ');

    // Build lookup maps
    const existingByLinkedIn = buildCandidateLookupMap('LinkedIn_URL');
    const existingByEmail = buildCandidateLookupMap('Email');

    // Process (UPSERT)
    const results = processLinkedInConnections(linkedInData, existingByLinkedIn, existingByEmail);
    Logger.log(`LinkedIn import complete: ${results.updated} updated, ${results.inserted} new`);

    // Move ALL CSV files to Processed folder
    moveAllCSVFilesToProcessed(LINKEDIN_CSV_FOLDER_ID, LINKEDIN_PROCESSED_FOLDER_ID);

    logImport("LinkedIn Connections", fileNames || "All CSV files", linkedInData.length,
      results.updated + results.inserted, "Success",
      `${results.updated} updated, ${results.inserted} new candidates`);

    Logger.log("=== LinkedIn Import Complete ===");
    return results;

  } catch (e) {
    logImport("LinkedIn Connections", "Unknown", 0, 0, "Failed", e.message);
    logError("LINKEDIN_IMPORT_ERROR", e.message, e.stack);
    throw e;
  }
}

// ============================================
// BULLHORN CANDIDATE DATA IMPORT
// ============================================

/**
 * Import structured candidate data (title, email, phone, company) from Bullhorn CSV export.
 * Different from importBullhornNotes() — this imports direct candidate fields, not note bodies.
 *
 * RECURRING DATA SOURCE: Quarterly import from colleague's Bullhorn pull.
 * Backfills gaps in Candidate_Master. Should NOT create many new candidates.
 *
 * CSV format: First Name, Last Name, Title, Email 1, Mobile Phone, Work Phone,
 *             Industry, Current Company, Status, Last Note
 * Row 2 is a mapping row (firstName, lastName, etc.) — skipped automatically.
 *
 * Match strategy: Name match → Email match → Insert as new
 * Merge strategy: Only fills empty fields (never overwrites existing data)
 */
function importBullhornCandidateData() {
  Logger.log('=== STARTING BULLHORN CANDIDATE DATA IMPORT ===');

  try {
    const folder = DriveApp.getFolderById(BULLHORN_CANDIDATE_DATA_FOLDER_ID);
    const allFiles = folder.getFiles();
    let csvFile = null;

    while (allFiles.hasNext()) {
      const file = allFiles.next();
      if (file.getName().endsWith('.csv')) {
        csvFile = file;
        break;
      }
    }

    if (!csvFile) {
      Logger.log('No CSV files found in BH Candidate Data folder');
      return { success: true, updated: 0, inserted: 0 };
    }

    const fileName = csvFile.getName();
    Logger.log(`Processing: ${fileName}`);

    // Parse CSV — skip mapping row
    const rawData = parseCSV(csvFile);
    Logger.log(`Found ${rawData.length} rows in CSV`);

    const candidates = rawData.filter(row => {
      const firstName = (row['First Name'] || row['\uFEFFFirst Name'] || '').trim();
      return firstName.toLowerCase() !== 'firstname' && firstName !== '';
    });
    Logger.log(`${candidates.length} candidate rows after filtering mapping row`);

    // Build lookup maps from Candidate_Master
    const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
    const masterData = sheet.getDataRange().getValues();
    const headers = masterData[0];
    const colMap = {};
    headers.forEach((h, i) => colMap[h] = i);

    const nameMap = {};
    const emailMap = {};

    for (let i = 1; i < masterData.length; i++) {
      const fullName = (masterData[i][colMap['Full_Name']] || '').toString().trim().toLowerCase();
      const email = (masterData[i][colMap['Email']] || '').toString().trim().toLowerCase();
      if (fullName) nameMap[fullName] = i + 1;
      if (email) emailMap[email] = i + 1;
    }

    Logger.log(`Candidate_Master: ${masterData.length - 1} existing candidates loaded`);

    let updated = 0;
    let inserted = 0;
    let skipped = 0;
    const rowsToInsert = [];
    const importStamp = generateStamp(IMPORT_PREFIX_BH_FULL);

    for (const row of candidates) {
      const firstName = (row['First Name'] || row['\uFEFFFirst Name'] || '').trim();
      const lastName = (row['Last Name'] || '').trim();
      const title = (row['Title'] || '').trim();
      const email = (row['Email 1'] || '').trim();
      const mobilePhone = (row['Mobile Phone'] || '').trim();
      const workPhone = (row['Work Phone'] || '').trim();
      const company = (row['Current Company'] || '').trim();
      const status = (row['Status'] || 'New Lead').trim();

      if (!firstName && !lastName) { skipped++; continue; }

      const fullName = toTitleCase(`${firstName} ${lastName}`.trim());
      const normalizedName = fullName.toLowerCase();
      const phone = normalizePhoneNumber(mobilePhone || workPhone);
      const cleanEmail = email.toLowerCase().trim();

      // Try to find existing candidate
      let matchRow = null;
      if (nameMap[normalizedName]) matchRow = nameMap[normalizedName];
      if (!matchRow && cleanEmail && emailMap[cleanEmail]) matchRow = emailMap[cleanEmail];

      if (matchRow) {
        // UPDATE existing — only fill empty fields
        const existingRow = masterData[matchRow - 1];
        const updates = [];

        if (!existingRow[colMap['Current_Title']] && title) {
          updates.push({ col: colMap['Current_Title'] + 1, value: title });
        }
        if (!existingRow[colMap['Current_Company']] && company) {
          updates.push({ col: colMap['Current_Company'] + 1, value: company });
        }
        if (!existingRow[colMap['Email']] && cleanEmail) {
          updates.push({ col: colMap['Email'] + 1, value: cleanEmail });
        }
        if (!existingRow[colMap['Phone']] && phone) {
          updates.push({ col: colMap['Phone'] + 1, value: phone });
        }

        // Stamp Last_Import if any data changed
        if (updates.length > 0) {
          updates.push({ col: colMap['Last_Import'] + 1, value: importStamp });
          for (const update of updates) {
            sheet.getRange(matchRow, update.col).setValue(update.value);
          }
          updated++;
          Logger.log(`Updated ${updates.length} fields for: ${fullName}`);
        } else {
          skipped++;
        }

      } else {
        // INSERT new candidate (24 columns: A through X)
        const candidateObj = { full_name: fullName, email: cleanEmail, linkedin_url: '' };
        const uid = generateUID(candidateObj);

        rowsToInsert.push([
          uid, fullName, title, company, '', cleanEmail, phone, status,
          '', '', '', '', // Location (col 12)
          '', // Region (col 13, NEW)
          '', '', '', '', false, false, '', '',
          '', // Match_Status
          importStamp, // Last_Import (W)
          ''  // Last_Enrichment (X)
        ]);
        inserted++;
      }
    }

    // Batch insert new rows (24 columns: A through X)
    if (rowsToInsert.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rowsToInsert.length, 24).setValues(rowsToInsert);
      Logger.log(`Inserted ${rowsToInsert.length} new candidates`);
    }

    // Move file to processed folder
    const targetFolder = DriveApp.getFolderById(BULLHORN_CANDIDATE_DATA_PROCESSED_FOLDER_ID);
    targetFolder.addFile(csvFile);
    folder.removeFile(csvFile);
    Logger.log(`Moved "${fileName}" to Processed folder`);

    logImport('Bullhorn Candidate Data', fileName, candidates.length, updated + inserted,
      'Success', `${updated} updated, ${inserted} inserted, ${skipped} skipped`);

    Logger.log('=== BULLHORN CANDIDATE DATA IMPORT COMPLETE ===');
    return { success: true, updated, inserted, skipped };

  } catch (error) {
    logError('BH_CANDIDATE_DATA_IMPORT_ERROR', error.message, error.stack);
    Logger.log(`ERROR: ${error.message}`);
    throw error;
  }
}

// ============================================
// MAIN ORCHESTRATION
// ============================================

/**
 * Run full initial import (Bullhorn Notes + LinkedIn)
 * Safe to run multiple times — uses UPSERT logic throughout
 */
function runInitialImport() {
  Logger.log("========================================");
  Logger.log("STARTING INITIAL IMPORT");
  Logger.log("========================================");

  try {
    Logger.log("\n--- STEP 1: Bullhorn Import ---");
    const bullhornResult = importBullhornNotes();
    Logger.log(`Bullhorn: ${bullhornResult.candidateCount} candidates processed`);

    Logger.log("\n--- STEP 2: LinkedIn Import ---");
    const linkedinResult = importLinkedInConnections();
    Logger.log(`LinkedIn: ${linkedinResult.updated} updated, ${linkedinResult.inserted} new`);

    Logger.log("\n========================================");
    Logger.log("INITIAL IMPORT COMPLETE");
    Logger.log(`Total in Candidate_Master: ${getTotalCandidateCount()}`);
    Logger.log("========================================");

    return {
      success: true,
      bullhorn: bullhornResult,
      linkedin: linkedinResult,
      total: getTotalCandidateCount()
    };

  } catch (e) {
    logError("INITIAL_IMPORT_ERROR", e.message, e.stack);
    Logger.log("Import failed - check ErrorLog tab");
    throw e;
  }
}

/**
 * Get total count of candidates in Candidate_Master
 * @returns {number} - Total candidate count (excludes header row)
 */
function getTotalCandidateCount() {
  const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
  return sheet.getLastRow() - 1;
}
