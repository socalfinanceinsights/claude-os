/**
 * 06_Job_Screening.gs
 * Job Screening Engine - Orchestrator
 *
 * PURPOSE: Screen candidates against job descriptions using Gemini-powered
 *          dynamic screening matrices. Produces ranked Top 25 results.
 * DEPENDENCIES: 00a_Config.gs, 00b_Sheet_Helpers.gs, 00f_Gemini_API.gs,
 *               06b_Screening_Helpers.gs
 *
 * WORKFLOW:
 * 1. User pastes JD + notes via sidebar
 * 2. Gemini Pro generates screening matrix (1 API call)
 * 3. Gemini Flash ranks candidates in batches of 25 (~240 API calls for 6k candidates)
 * 4. Top 25 written to results tab with conditional formatting
 */

// ============================================
// SIDEBAR ENTRY POINTS (called from HTML)
// ============================================

/**
 * Open the screening sidebar
 * Called from menu: Candidate Tracker → Job Screening → Screen Candidates for Job
 */
function openScreeningSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('06c_Screening_Sidebar')
    .setTitle('🎯 Job Screening Engine')
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Get candidate count for given filters (called from sidebar)
 *
 * @param {Object} filters - { hasData, location, excludeAboveLevel }
 * @returns {number} - Count of candidates matching filters
 */
function sidebarGetCandidateCount(filters) {
  return getCandidateCountForScreening(filters || { hasData: true });
}

/**
 * Step 1: Generate screening matrix from JD + notes (called from sidebar)
 *
 * @param {string} jdText - Full job description
 * @param {string} clientNotes - Recruiter notes about role/client
 * @returns {Object} - { success, screenId, summary, error }
 */
function sidebarGenerateMatrix(jdText, clientNotes) {
  try {
    if (!jdText || jdText.trim().length < 50) {
      return { success: false, error: 'JD text too short. Paste the full job description.' };
    }

    Logger.log('=== GENERATING SCREENING MATRIX ===');
    Logger.log(`JD length: ${jdText.length} chars`);

    // Call Gemini Pro to generate matrix
    const matrix = generateScreeningMatrixWithGemini(jdText, clientNotes);

    if (!matrix) {
      return { success: false, error: 'Gemini failed to generate a screening matrix. Check logs.' };
    }

    // Generate screen ID and save config
    const screenId = generateScreenId();
    createScreeningConfig(screenId, matrix.role_title, jdText, clientNotes, matrix, {});

    // Format summary for sidebar display
    const summary = formatMatrixSummary(matrix);

    Logger.log(`Matrix generated successfully: ${screenId}`);

    return {
      success: true,
      screenId: screenId,
      summary: summary
    };

  } catch (error) {
    Logger.log(`ERROR in sidebarGenerateMatrix: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Step 2: Run screening against all candidates (called from sidebar)
 * Processes in batches, returns progress updates via polling
 *
 * @param {string} screenId - Screen ID from matrix generation step
 * @param {Object} filters - Pre-filter settings from sidebar
 * @returns {Object} - { success, resultsTab, totalScreened, topScore, error }
 */
function sidebarRunScreening(screenId, filters) {
  // Declare outside try so catch block can access
  let processedCount = 0;

  try {
    // CRITICAL: Reset start time NOW, not at module load
    _screeningStartTime = new Date().getTime();

    Logger.log(`=== STARTING SCREENING: ${screenId} ===`);
    Logger.log(`Filters: ${JSON.stringify(filters)}`);

    // Update status FIRST so we can tell "never started" from "started but failed"
    updateScreeningConfig(screenId, 'SCREENING', 0, '');

    // Get the matrix
    const matrix = getScreeningMatrix(screenId);
    if (!matrix) {
      updateScreeningConfig(screenId, 'ERROR', 0, '');
      return { success: false, error: `Matrix not found for ${screenId}` };
    }

    // Apply above-level exclusion from matrix if filter is on
    if (filters.excludeAboveLevel && matrix.title_tier_map && matrix.title_tier_map.above_level) {
      filters.aboveLevelTitles = matrix.title_tier_map.above_level;
    }

    // Get candidates
    const candidates = getCandidatesForScreening(filters);
    Logger.log(`Candidates to screen: ${candidates.length}`);

    if (candidates.length === 0) {
      updateScreeningConfig(screenId, 'ERROR', 0, '');
      return { success: false, error: 'No candidates match the current filters.' };
    }

    // Build UID lookup for result writing
    const candidateLookup = {};
    candidates.forEach(c => { candidateLookup[c.uid] = c; });

    // Process in batches
    const allResults = [];
    const batchSize = SCREENING_BATCH_SIZE;
    const totalBatches = Math.ceil(candidates.length / batchSize);
    let errorCount = 0;
    let timedOut = false;

    Logger.log(`Processing ${totalBatches} batches of ${batchSize}`);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const start = batchIdx * batchSize;
      const end = Math.min(start + batchSize, candidates.length);
      const batch = candidates.slice(start, end);

      Logger.log(`Batch ${batchIdx + 1}/${totalBatches}: candidates ${start + 1}-${end}`);

      // Call Gemini Flash for this batch
      try {
        const batchResults = rankCandidatesWithGemini(batch, matrix);

        if (batchResults && Array.isArray(batchResults)) {
          allResults.push(...batchResults);
          processedCount += batch.length;
        } else {
          Logger.log(`  WARNING: Batch ${batchIdx + 1} returned no results`);
          errorCount++;
        }
      } catch (batchError) {
        Logger.log(`  ERROR in batch ${batchIdx + 1}: ${batchError.message}`);
        errorCount++;
        // Continue with next batch — don't abort entire screening
      }

      // Rate limiting delay between batches
      if (batchIdx < totalBatches - 1) {
        Utilities.sleep(500);
      }

      // Check if approaching 6-minute timeout (leave 30s buffer)
      const elapsed = (new Date().getTime() - _screeningStartTime) / 1000;
      if (elapsed > 330) {
        Logger.log(`Approaching timeout at ${elapsed}s. Processed ${processedCount}/${candidates.length} candidates.`);
        // Save partial results — we'll still rank what we have
        timedOut = true;
        break;
      }
    }

    // 2.4 Sparse-data score cap
    // If a candidate is missing 3+ of the 5 key profile fields, cap their score at 55
    // and flag it so reviewers know the rating is unreliable.
    allResults.forEach(result => {
      if (result.disqualified || !result.match_pct) return;
      const c = candidateLookup[result.uid] || {};
      const fieldsPresent = [
        c.current_title, c.current_company, c.key_skills,
        c.notes_summary, c.location
      ].filter(f => f && f.toString().trim().length > 0).length;

      if (fieldsPresent < 3) {
        if (result.match_pct > 55) result.match_pct = 55;
        result.concerns = result.concerns || [];
        result.concerns.push('Insufficient data for reliable scoring');
      }
    });

    // Generate results tab
    const resultsTabName = generateResultsTabName(matrix.role_title, matrix.company);
    writeScreeningResults(resultsTabName, allResults, candidateLookup);

    // 2.5 Timeout status: PARTIAL vs COMPLETE
    const finalStatus = timedOut ? 'PARTIAL' : 'COMPLETE';
    updateScreeningConfig(screenId, finalStatus, processedCount, resultsTabName);

    // Find top score for summary
    const topScore = allResults.length > 0
      ? Math.max(...allResults.filter(r => !r.disqualified).map(r => r.match_pct || 0))
      : 0;

    // Build list of unscreened candidates when timed out
    let unscreenedNames = [];
    if (timedOut) {
      const screenedUids = new Set(allResults.map(r => r.uid));
      unscreenedNames = candidates
        .filter(c => !screenedUids.has(c.uid))
        .map(c => c.full_name);
    }

    Logger.log(`=== SCREENING ${finalStatus}: ${screenId} ===`);
    Logger.log(`Screened: ${processedCount}, Errors: ${errorCount}, Top score: ${topScore}`);
    if (timedOut) {
      Logger.log(`Unscreened (${unscreenedNames.length}): ${unscreenedNames.join(', ')}`);
    }

    return {
      success: true,
      status: finalStatus,
      resultsTab: resultsTabName,
      totalScreened: processedCount,
      totalCandidates: candidates.length,
      topScore: topScore,
      errorBatches: errorCount,
      timedOut: timedOut,
      unscreenedNames: unscreenedNames
    };

  } catch (error) {
    Logger.log(`ERROR in sidebarRunScreening: ${error.message}`);
    Logger.log(`Stack: ${error.stack || 'no stack'}`);
    try {
      updateScreeningConfig(screenId, 'ERROR', processedCount || 0, '');
      logError('SCREENING_ERROR', error.message, `screenId=${screenId}, stack=${error.stack || 'none'}`);
    } catch (e) {
      Logger.log(`Could not update error status: ${e.message}`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Activates the specified results tab in the spreadsheet.
 * Called from sidebar after screening completes.
 * @execution manual
 */
function sidebarActivateResultsTab(tabName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(tabName);
  if (sheet) {
    ss.setActiveSheet(sheet);
    SpreadsheetApp.flush();
  }
}

// Track start time for timeout detection
var _screeningStartTime = new Date().getTime();

// ============================================
// MENU HANDLERS
// ============================================

/**
 * Menu handler: Open screening sidebar
 */
function menuStartScreening() {
  openScreeningSidebar();
}

/**
 * Menu handler: View summary of last screening run
 */
function menuViewScreeningSummary() {
  const ui = SpreadsheetApp.getUi();

  try {
    const configSheet = getOrCreateScreenConfigTab();
    const data = configSheet.getDataRange().getValues();

    if (data.length <= 1) {
      ui.alert('No Screenings', 'No screening runs found. Use "Screen Candidates for Job" to start.', ui.ButtonSet.OK);
      return;
    }

    // Get last row
    const headers = data[0];
    const colMap = {};
    headers.forEach((h, i) => colMap[h] = i);

    const lastRow = data[data.length - 1];

    const screenId = lastRow[colMap['Screen_ID']];
    const roleTitle = lastRow[colMap['Role_Title']];
    const status = lastRow[colMap['Status']];
    const screened = lastRow[colMap['Candidates_Screened']];
    const resultsTab = lastRow[colMap['Results_Tab']];
    const created = lastRow[colMap['Created_Date']];

    ui.alert(
      'Last Screening Summary',
      `Screen ID: ${screenId}\n` +
      `Role: ${roleTitle}\n` +
      `Status: ${status}\n` +
      `Candidates Screened: ${screened}\n` +
      `Results Tab: ${resultsTab || 'N/A'}\n` +
      `Created: ${created}`,
      ui.ButtonSet.OK
    );

  } catch (error) {
    ui.alert('Error', `Could not load summary: ${error.message}`, ui.ButtonSet.OK);
  }
}

/**
 * Menu handler: Resume a screening batch (for timeout recovery)
 */
function menuResumeScreeningBatch() {
  const ui = SpreadsheetApp.getUi();

  try {
    const configSheet = getOrCreateScreenConfigTab();
    const data = configSheet.getDataRange().getValues();

    if (data.length <= 1) {
      ui.alert('No Screenings', 'No screening runs to resume.', ui.ButtonSet.OK);
      return;
    }

    // Find last SCREENING status entry
    const headers = data[0];
    const colMap = {};
    headers.forEach((h, i) => colMap[h] = i);

    let resumeRow = null;
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][colMap['Status']] === 'SCREENING') {
        resumeRow = data[i];
        break;
      }
    }

    if (!resumeRow) {
      ui.alert('Nothing to Resume', 'No in-progress screening found. Start a new screening from the sidebar.', ui.ButtonSet.OK);
      return;
    }

    const screenId = resumeRow[colMap['Screen_ID']];
    ui.alert('Resume', `Found in-progress screening: ${screenId}. Opening sidebar to continue.`, ui.ButtonSet.OK);

    // Open sidebar (user can re-run from there)
    openScreeningSidebar();

  } catch (error) {
    ui.alert('Error', `Could not resume: ${error.message}`, ui.ButtonSet.OK);
  }
}
