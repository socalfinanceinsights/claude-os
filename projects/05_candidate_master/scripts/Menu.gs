/**
 * Menu.gs
 * Custom menu for user actions
 *
 * PURPOSE: Provide UI buttons for all major functions
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, and all orchestrator scripts
 */

/**
 * Create custom menu on spreadsheet open
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('🎯 Candidate Tracker')
    .addSubMenu(ui.createMenu('📥 Import')
      .addItem('Run Initial Import (Bullhorn + LinkedIn)', 'menuRunInitialImport')
      .addSeparator()
      .addItem('Import Bullhorn Notes CSV', 'menuImportBullhornOnly')
      .addItem('Import Bullhorn Candidate Data CSV', 'menuImportBullhornCandidateData')
      .addItem('Import LinkedIn CSV Only', 'menuImportLinkedInOnly'))
    .addSeparator()
    .addSubMenu(ui.createMenu('🔄 Refresh & Update')
      .addItem('Link Drive Folders', 'menuRunFolderLinker')
      .addItem('Match Resume Archive', 'menuRunResumeArchiveMatcher')
      .addItem('Stamp Region Column', 'menuStampRegionColumn'))
    .addSeparator()
    .addSubMenu(ui.createMenu('✨ Enrichment')
      .addItem('Run Gemini Batch Enrichment (50 at a time)', 'menuRunGeminiBatch')
      .addSeparator()
      .addItem('Enrich All (with Drive Folders)', 'menuEnrichAll')
      .addItem('Enrich Selected UIDs', 'menuEnrichSelected'))
    .addSeparator()
    .addSubMenu(ui.createMenu('🔗 Deduplication')
      .addItem('Run Gemini Matching Batch (40 at a time)', 'menuRunGeminiMatchingBatch')
      .addItem('Process Review Decisions', 'menuProcessReviewDecisions')
      .addSeparator()
      .addItem('Reset NO_MATCH Candidates', 'menuResetNoMatch'))
    .addSeparator()
    .addSubMenu(ui.createMenu('🎯 Job Screening')
      .addItem('Screen Candidates for Job', 'menuStartScreening')
      .addItem('Resume Screening Batch', 'menuResumeScreeningBatch')
      .addSeparator()
      .addItem('View Last Screening Summary', 'menuViewScreeningSummary'))
    .addSeparator()
    .addItem('📊 Show Import Summary', 'menuShowImportSummary')
    .addToUi();
}

/**
 * Menu handler: Run Initial Import (Bullhorn + LinkedIn)
 */
function menuRunInitialImport() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Run Initial Import',
    'This will import CSV files from both Bullhorn and LinkedIn folders.\n\n' +
    'Existing records will be updated. New records will be inserted.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      ui.alert('Import started. This may take a few minutes...');
      const result = runInitialImport();
      ui.alert(
        'Import Complete',
        `Bullhorn: ${result.bullhorn.inserted} inserted, ${result.bullhorn.updated} updated\n` +
        `LinkedIn: ${result.linkedin.inserted} inserted, ${result.linkedin.updated} updated`,
        ui.ButtonSet.OK
      );
    } catch (error) {
      ui.alert('Error', `Import failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Import Bullhorn CSV Only
 */
function menuImportBullhornOnly() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Import Bullhorn CSV',
    'This will import Bullhorn candidate notes from CSV.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      ui.alert('Import started...');
      importBullhornNotes();
      ui.alert('Bullhorn import complete!');
    } catch (error) {
      ui.alert('Error', `Import failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Import Bullhorn Candidate Data CSV
 * (title, email, phone, company — NOT notes)
 */
function menuImportBullhornCandidateData() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Import Bullhorn Candidate Data',
    'This will import candidate fields (title, email, phone, company) from a Bullhorn export CSV.\n\n' +
    'Only empty fields will be filled — existing data is never overwritten.\n\n' +
    'New candidates (not already in the sheet) will be inserted.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      const result = importBullhornCandidateData();
      ui.alert(
        'Import Complete',
        `Updated: ${result.updated}\nInserted: ${result.inserted}\nSkipped (no changes): ${result.skipped}`,
        ui.ButtonSet.OK
      );
    } catch (error) {
      ui.alert('Error', `Import failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Import LinkedIn CSV Only
 */
function menuImportLinkedInOnly() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Import LinkedIn CSV',
    'This will import LinkedIn 1st connections from CSV.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      ui.alert('Import started...');
      importLinkedInConnections();
      ui.alert('LinkedIn import complete!');
    } catch (error) {
      ui.alert('Error', `Import failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Link Drive Folders
 */
function menuRunFolderLinker() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Link Drive Folders',
    'This will scan your Candidates folder and auto-link folders to matching candidates.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      const result = runFolderLinker();

      let message = `Linked: ${result.linked}\n` +
        `Already Linked (skipped): ${result.alreadyLinked}\n` +
        `Unmatched Folders: ${result.unmatchedFolders}\n` +
        `Enriched (DeepDive/Tags): ${result.enriched}`;

      if (result.enrichedPartial) {
        message += '\n\nNote: Enrichment was partial due to timeout. Run "Enrich All" from menu to complete remaining.';
      }

      if (result.unmatchedFolderNames && result.unmatchedFolderNames.length > 0 && result.unmatchedFolderNames.length <= 10) {
        message += '\n\nUnmatched: ' + result.unmatchedFolderNames.join(', ');
      } else if (result.unmatchedFolderNames && result.unmatchedFolderNames.length > 10) {
        message += '\n\nSee Import_Log for unmatched folder names.';
      }

      ui.alert('Linking Complete', message, ui.ButtonSet.OK);
    } catch (error) {
      ui.alert('Error', `Linking failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Scheduled wrapper for daily folder linking
 * Runs runFolderLinker() silently — only logs to Import_Log if something happened
 * Safe to run daily: already-linked skip logic handles idempotency
 */
function scheduledFolderLink() {
  const result = runFolderLinker();
  if (result.linked > 0 || result.enriched > 0) {
    logImport(
      "Folder Link (Scheduled)",
      "Auto",
      result.linked + result.enriched,
      result.linked,
      "Success",
      `Linked: ${result.linked}, Enriched: ${result.enriched}, Unmatched: ${result.unmatchedFolderNames.join(', ')}`
    );
  }
}

/**
 * Menu handler: Match Resume Archive
 */
function menuRunResumeArchiveMatcher() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Match Resume Archive',
    'This will match resume files from your archive to candidates.\n\n' +
    'Results will be written to Resume_Archive_Matches tab for human review.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      ui.alert('Matching started...');
      const result = runResumeArchiveMatcher();
      ui.alert(
        'Matching Complete',
        `Total matches: ${result.totalMatches}\n\n` +
        'Review matches in Resume_Archive_Matches tab.',
        ui.ButtonSet.OK
      );
    } catch (error) {
      ui.alert('Error', `Matching failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Enrich All (with Drive Folders)
 */
function menuEnrichAll() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Enrich All Candidates',
    'This will enrich ALL candidates that have Drive_Folder_Link populated.\n\n' +
    'DeepDive.md files will be parsed for Tech_Stack and Key_Skills.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      ui.alert('Enrichment started...');
      const result = runSelectiveEnrichment();
      ui.alert(
        'Enrichment Complete',
        `Enriched: ${result.enriched}\n` +
        `Skipped (no data): ${result.skipped}`,
        ui.ButtonSet.OK
      );
    } catch (error) {
      ui.alert('Error', `Enrichment failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Enrich Selected UIDs
 */
function menuEnrichSelected() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    'Enrich Selected Candidates',
    'Enter UIDs to enrich (comma-separated):',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const input = response.getResponseText().trim();

    if (!input) {
      ui.alert('No UIDs provided. Cancelled.');
      return;
    }

    const uids = input.split(',').map(uid => uid.trim()).filter(uid => uid.length > 0);

    try {
      ui.alert(`Enriching ${uids.length} candidates...`);
      const result = runSelectiveEnrichment(uids);
      ui.alert(
        'Enrichment Complete',
        `Enriched: ${result.enriched}\n` +
        `Skipped (no data): ${result.skipped}`,
        ui.ButtonSet.OK
      );
    } catch (error) {
      ui.alert('Error', `Enrichment failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Show Import Summary
 */
function menuShowImportSummary() {
  const ui = SpreadsheetApp.getUi();

  try {
    const sheet = getSheetByName(TAB_CANDIDATE_MASTER);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colMap = {};
    headers.forEach((h, i) => colMap[h] = i);

    const totalCandidates = data.length - 1; // Exclude header

    let withLinkedIn = 0;
    let withEmail = 0;
    let withDriveFolder = 0;
    let withResume = 0;
    let withDeepDive = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];

      if (row[colMap['LinkedIn_URL']]) withLinkedIn++;
      if (row[colMap['Email']]) withEmail++;
      if (row[colMap['Drive_Folder_Link']]) withDriveFolder++;
      if (row[colMap['Has_Resume']] === 'Yes' || row[colMap['Has_Resume']] === true) withResume++;
      if (row[colMap['Has_DeepDive']] === 'Yes' || row[colMap['Has_DeepDive']] === true) withDeepDive++;
    }

    ui.alert(
      'Import Summary',
      `Total Candidates: ${totalCandidates}\n\n` +
      `With LinkedIn URL: ${withLinkedIn}\n` +
      `With Email: ${withEmail}\n` +
      `With Drive Folder: ${withDriveFolder}\n` +
      `With Resume: ${withResume}\n` +
      `With DeepDive: ${withDeepDive}`,
      ui.ButtonSet.OK
    );

  } catch (error) {
    ui.alert('Error', `Could not generate summary: ${error.message}`, ui.ButtonSet.OK);
  }
}

/**
 * Menu handler: Run Gemini Batch Enrichment
 */
function menuRunGeminiBatch() {
  const ui = SpreadsheetApp.getUi();

  // Check remaining count
  const remaining = countCandidatesNeedingEnrichment();

  if (remaining === 0) {
    ui.alert(
      'Enrichment Complete',
      'All candidates with structured notes have been enriched!\n\n' +
      'No more candidates need Gemini processing.',
      ui.ButtonSet.OK
    );
    return;
  }

  const response = ui.alert(
    'Gemini Batch Enrichment',
    `This will process 50 candidates with Gemini Flash API.\n\n` +
    `Remaining candidates: ${remaining}\n` +
    `Estimated time: 3-5 minutes\n` +
    `Estimated cost: ~$0.015 (1.5 cents)\n\n` +
    `Run enrichment now?`,
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      ui.alert('Enrichment started...');
      const result = runGeminiBatchEnrichment();
      ui.alert(
        'Enrichment Complete',
        `Processed: ${result.processed}\n` +
        `Skipped (no structured note): ${result.skipped}\n` +
        `Remaining: ${result.remaining}\n\n` +
        (result.remaining > 0 ? 'Run again to continue enrichment.' : 'All done!'),
        ui.ButtonSet.OK
      );
    } catch (error) {
      ui.alert('Error', `Enrichment failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

// ============================================
// DEDUPLICATION MENU HANDLERS
// ============================================

/**
 * Menu handler: Run Gemini Matching Batch
 */
function menuRunGeminiMatchingBatch() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Gemini Matching Batch',
    'This will process 40 LinkedIn candidates against Bullhorn records using Gemini.\n\n' +
    '95%+ matches auto-merge. Lower matches go to review tab.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      const result = runGeminiMatchingBatch();
      ui.alert(
        'Matching Complete',
        `Auto-merged: ${result.exactMatches}\n` +
        `Sent to review: ${result.fuzzyMatches}\n` +
        `No matches: ${result.noMatches}\n` +
        `Remaining: ${result.remaining}`,
        ui.ButtonSet.OK
      );
    } catch (error) {
      ui.alert('Error', `Matching failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Process Review Decisions
 */
function menuProcessReviewDecisions() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Process Review Decisions',
    'This will process all decisions you made in the Candidate_Match_Review tab.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      const result = processReviewDecisions();
      ui.alert(
        'Processing Complete',
        `Merged: ${result.merged}\n` +
        `Marked NO_MATCH: ${result.noMatch}\n` +
        `Rows cleared: ${result.processed}`,
        ui.ButtonSet.OK
      );
    } catch (error) {
      ui.alert('Error', `Processing failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Stamp Region Column
 */
function menuStampRegionColumn() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Stamp Region Column',
    'This will map each candidate\'s Location to a region (South OC, SFV, Central SD, etc.) using the Location_Normalization table.\n\n' +
    'Rows that already have a Region value will be skipped.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );
  if (response === ui.Button.YES) {
    try {
      stampRegionColumn();
    } catch (error) {
      ui.alert('Error', `Region stamp failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu handler: Reset NO_MATCH Candidates
 */
function menuResetNoMatch() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Reset NO_MATCH Candidates',
    'This will clear all NO_MATCH statuses so those candidates can be re-processed.\n\n' +
    'Use this after improving matching logic.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      const result = resetNoMatchCandidates();
      ui.alert('Reset Complete', `Reset ${result.resetCount} candidates.`, ui.ButtonSet.OK);
    } catch (error) {
      ui.alert('Error', `Reset failed: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}
