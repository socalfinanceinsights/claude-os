/**
 * DAILY ORCHESTRATOR - Unified Workflow Controller
 * 
 * This script runs all ingestion and processing stages in sequence:
 * 1. Email Ingest → 2. Drive Ingest → 3. Mining Agent → 4. Daily Report
 * 
 * SETUP: Create a time-driven trigger in Apps Script UI pointing to `runDailyWorkflow`
 * 
 * All configuration is inherited from 00_Brain_Config.gs
 */

// ============================================================================
// ORCHESTRATOR CONFIGURATION
// ============================================================================

// Enable/Disable individual stages (useful for debugging)
const ENABLE_EMAIL_INGEST = true;
const ENABLE_DRIVE_INGEST = true;
const ENABLE_MINING = true;
const ENABLE_DAILY_REPORT = true;

// Note: MAX_EXECUTION_TIME_MS is defined in 00_Brain_Config.gs to avoid duplication

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main orchestration function - runs all stages sequentially.
 * Each stage is isolated: failures in one stage don't block subsequent stages.
 * 
 * Call this function from a time-driven trigger in Apps Script UI.
 */
function runDailyWorkflow() {
  const startTime = new Date();
  Logger.log("═══════════════════════════════════════════════════════════════");
  Logger.log(`DAILY WORKFLOW STARTED at ${startTime.toISOString()}`);
  Logger.log("═══════════════════════════════════════════════════════════════");
  
  // Track results from each stage
  const results = {
    emailIngest: { completed: false, skipped: false },
    driveIngest: { completed: false, skipped: false },
    mining: { completed: false, skipped: false, reason: null },
    dailyReport: { sent: false, skipped: false },
    stageErrors: []
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 1: EMAIL INGEST
  // ─────────────────────────────────────────────────────────────────────────
  if (ENABLE_EMAIL_INGEST) {
    Logger.log("\n┌─── STAGE 1: EMAIL INGEST ───────────────────────────────────┐");
    try {
      runEmailIngestStage(startTime);
      results.emailIngest.completed = true;
      Logger.log(`└─── EMAIL INGEST COMPLETE ───┘`);
    } catch (e) {
      results.stageErrors.push({ stage: 'EMAIL_INGEST', error: e.toString() });
      Logger.log(`└─── EMAIL INGEST FAILED: ${e.toString()} ───┘`);
    }
  } else {
    results.emailIngest.skipped = true;
    Logger.log("\n[SKIPPED] Email Ingest (disabled in config)");
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 2: DRIVE INGEST
  // ─────────────────────────────────────────────────────────────────────────
  if (ENABLE_DRIVE_INGEST) {
    Logger.log("\n┌─── STAGE 2: DRIVE INGEST ───────────────────────────────────┐");
    try {
      runDriveIngestStage(startTime);
      results.driveIngest.completed = true;
      Logger.log(`└─── DRIVE INGEST COMPLETE ───┘`);
    } catch (e) {
      results.stageErrors.push({ stage: 'DRIVE_INGEST', error: e.toString() });
      Logger.log(`└─── DRIVE INGEST FAILED: ${e.toString()} ───┘`);
    }
  } else {
    results.driveIngest.skipped = true;
    Logger.log("\n[SKIPPED] Drive Ingest (disabled in config)");
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 3: MINING AGENT (with time check)
  // ─────────────────────────────────────────────────────────────────────────
  if (ENABLE_MINING) {
    if (isTimeRunningOut(startTime)) {
      Logger.log("\n⏳ TIME LIMIT APPROACHING - Skipping Mining to ensure Daily Report runs.");
      results.mining.skipped = true;
      results.mining.reason = 'TIME_LIMIT';
    } else {
      Logger.log("\n┌─── STAGE 3: MINING AGENT ──────────────────────────────────┐");
      try {
        runMiningStage(startTime);
        results.mining.completed = true;
        Logger.log(`└─── MINING COMPLETE ───┘`);
      } catch (e) {
        results.stageErrors.push({ stage: 'MINING', error: e.toString() });
        Logger.log(`└─── MINING FAILED: ${e.toString()} ───┘`);
      }
    }
  } else {
    results.mining.skipped = true;
    Logger.log("\n[SKIPPED] Mining Agent (disabled in config)");
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 4: DAILY REPORT (with Report Guard)
  // ─────────────────────────────────────────────────────────────────────────
  if (ENABLE_DAILY_REPORT) {
    // Report Guard: Only send if not already sent today
    if (!wasReportSentToday()) {
      Logger.log("\n┌─── STAGE 4: DAILY REPORT ──────────────────────────────────┐");
      try {
        generateDailySummary();
        markReportSent(); // Mark as sent for today
        results.dailyReport.sent = true;
        Logger.log(`└─── DAILY REPORT SENT ───┘`);
      } catch (e) {
        results.stageErrors.push({ stage: 'DAILY_REPORT', error: e.toString() });
        Logger.log(`└─── DAILY REPORT FAILED: ${e.toString()} ───┘`);
      }
    } else {
      results.dailyReport.skipped = true;
      const reason = wasReportSentToday() ? 'already sent today' : 'unknown';
      Logger.log(`\n[SKIPPED] Daily Report (${reason})`);
    }
  } else {
    results.dailyReport.skipped = true;
    Logger.log("\n[SKIPPED] Daily Report (disabled in config)");
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // WORKFLOW SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  const endTime = new Date();
  const durationMs = endTime - startTime;
  const durationMins = Math.round(durationMs / 1000 / 60 * 10) / 10;
  
  Logger.log("\n═══════════════════════════════════════════════════════════════");
  Logger.log(`DAILY WORKFLOW COMPLETED in ${durationMins} minutes`);
  Logger.log("═══════════════════════════════════════════════════════════════");
  Logger.log(`Email Ingest: ${results.emailIngest.skipped ? 'SKIPPED' : (results.emailIngest.completed ? 'COMPLETED' : 'ATTEMPTED')}`);
  Logger.log(`Drive Ingest: ${results.driveIngest.skipped ? 'SKIPPED' : (results.driveIngest.completed ? 'COMPLETED' : 'ATTEMPTED')}`);
  Logger.log(`Mining: ${results.mining.skipped ? 'SKIPPED' + (results.mining.reason ? ' ('+results.mining.reason+')' : '') : (results.mining.completed ? 'COMPLETED' : 'ATTEMPTED')}`);
  Logger.log(`Daily Report: ${results.dailyReport.skipped ? 'SKIPPED' : (results.dailyReport.sent ? 'SENT' : 'FAILED')}`);
  
  if (results.stageErrors.length > 0) {
    Logger.log(`\n⚠️ STAGE ERRORS (${results.stageErrors.length}):`);
    results.stageErrors.forEach(err => {
      Logger.log(`  - ${err.stage}: ${err.error}`);
    });
  }
  
  return results;
}

// ============================================================================
// STAGE WRAPPERS
// ============================================================================

// Note: isTimeRunningOut() is defined in 00_Brain_Config.gs (inherited from config)

/**
 * Wrapper for Email Ingest stage.
 * Calls the existing ingestEmailBatch() function.
 */
function runEmailIngestStage(startTime) {
  ingestEmailBatch(startTime);
  return { completed: true, skipped: false };
}

/**
 * Wrapper for Drive Ingest stage.
 * Calls the existing ingestDriveFolder() function.
 */
function runDriveIngestStage(startTime) {
  ingestDriveFolder(startTime);
  return { completed: true, skipped: false };
}

/**
 * Wrapper for Mining stage.
 * Calls the existing mineUnifiedMasterList() function.
 * Note: Mining uses batch limits (BATCH_SIZE) rather than time-based processing.
 */
function runMiningStage(startTime) {
  mineUnifiedMasterList();
  return { completed: true, skipped: false };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Test function to verify all stages can be called.
 * Runs with all stages disabled except logging.
 */
function testOrchestrator() {
  Logger.log("Testing Orchestrator Connection...");
  
  // Test Brain Config access
  try {
    const key = getGeminiKey();
    Logger.log("✓ Brain Config: API Key accessible");
  } catch (e) {
    Logger.log("✗ Brain Config: " + e.toString());
  }
  
  // Test spreadsheet access
  try {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
    Logger.log(`✓ Spreadsheet: ${TARGET_SHEET_NAME} has ${sheet.getLastRow()} rows`);
  } catch (e) {
    Logger.log("✗ Spreadsheet: " + e.toString());
  }
  
  // Test Gmail access
  try {
    const threads = GmailApp.search('label:' + INBOX_LABEL, 0, 1);
    Logger.log(`✓ Gmail: Found ${threads.length} threads with label ${INBOX_LABEL}`);
  } catch (e) {
    Logger.log("✗ Gmail: " + e.toString());
  }
  
  // Test Drive access
  try {
    const folder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
    Logger.log(`✓ Drive: Source folder "${folder.getName()}" accessible`);
  } catch (e) {
    Logger.log("✗ Drive: " + e.toString());
  }
  
  Logger.log("\nTest complete. Ready to run workflow.");
}
