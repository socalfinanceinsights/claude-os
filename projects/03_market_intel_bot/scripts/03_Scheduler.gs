/**
 * 03_Scheduler.gs
 *
 * Daily trigger scheduler for Market Intel Bot.
 * One trigger fires daily. Reads Cadence column from _CONFIG
 * and only runs tasks that are due today.
 *
 * Schedule rules:
 *   2x/week  → Monday (1) + Thursday (4)
 *   2x/month → 1st + 15th of month
 *   1x/month → 1st of month
 *
 * If Cadence is blank or unrecognized, task is skipped by the scheduler
 * (can still be run manually via runMarketIntelSweep).
 */

// ============================================================================
// CADENCE MATCHING
// ============================================================================

/**
 * Checks if a task's cadence is due today.
 * @param {string} cadence - Cadence string from _CONFIG (e.g., "2x/week")
 * @param {Date} now - Current date (injectable for testing)
 * @returns {boolean} True if the task should run today
 * @private
 */
function isDueToday_(cadence, now) {
  if (!cadence) return false;

  const dayOfWeek = now.getDay();   // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const dayOfMonth = now.getDate(); // 1-31

  switch (cadence) {
    case '2x/week':
      return dayOfWeek === 1 || dayOfWeek === 4; // Monday + Thursday

    case '2x/month':
      return dayOfMonth === 1 || dayOfMonth === 15;

    case '1x/month':
      return dayOfMonth === 1;

    default:
      Logger.log(`  Unknown cadence "${cadence}" — skipping`);
      return false;
  }
}

// ============================================================================
// SCHEDULED SWEEP
// ============================================================================

/**
 * Main scheduled function. Called by daily trigger.
 * Reads all active tasks, filters by cadence, runs pipeline for matching ones.
 */
function runScheduledSweep() {
  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  Logger.log('╔════════════════════════════════════════╗');
  Logger.log('║   SCHEDULED SWEEP - STARTED            ║');
  Logger.log('╚════════════════════════════════════════╝');
  Logger.log(`Date: ${now.toISOString().split('T')[0]} (${dayNames[now.getDay()]}), Day of month: ${now.getDate()}`);

  try {
    const allTasks = getSearchPromptsConfig();

    if (allTasks.length === 0) {
      Logger.log('\nNo active tasks found in _CONFIG');
      return;
    }

    // Filter to tasks due today
    const dueTasks = allTasks.filter(task => isDueToday_(task.cadence, now));

    Logger.log(`\nActive tasks: ${allTasks.length}`);
    Logger.log(`Due today: ${dueTasks.length}`);

    if (dueTasks.length === 0) {
      Logger.log('\nNo tasks scheduled for today. Done.');
      return;
    }

    dueTasks.forEach(task => Logger.log(`  → ${task.taskName} (${task.cadence})`));

    // Run pipeline for each due task
    let totalWritten = 0;

    dueTasks.forEach((task, index) => {
      Logger.log(`\n\n${'='.repeat(60)}`);
      Logger.log(`TASK ${index + 1}/${dueTasks.length}: ${task.taskName}`);
      Logger.log(`Cadence: ${task.cadence} | TBS: ${task.serperTbs || '(none)'}`);
      Logger.log('='.repeat(60));

      try {
        // Parse queries
        const queries = task.searchQueries
          .split('\n')
          .map(q => q.trim())
          .filter(q => q.length > 0);

        Logger.log(`Target Sheet: ${task.sheetName}`);
        Logger.log(`Queries: ${queries.length}`);

        // Phase 1: Search
        const searchResults = searchPhase_(queries, task.serperTbs || '');

        // Phase 2: Reader
        const extractedEvents = readerPhase_(searchResults, task.systemPrompt);

        // Date filter
        const recentEvents = filterByDate_(extractedEvents, 14);

        // Phase 3: Validate (if configured)
        let eventsToWrite;
        if (task.validateSoCal) {
          eventsToWrite = validatePhase_(recentEvents);
        } else {
          Logger.log('SoCal validation: SKIPPED (not configured for this task)');
          eventsToWrite = recentEvents;
        }

        // Phase 4: Write (includes dedup)
        const writtenCount = writePhase_(eventsToWrite, task.sheetName, task.bdEligible);
        totalWritten += writtenCount;

        Logger.log(`\n✓ Task complete: ${writtenCount} events written`);

        // Update LastRun timestamp
        updateLastRun_(task.taskName, now);

      } catch (taskErr) {
        Logger.log(`\n✗ ERROR in task "${task.taskName}": ${taskErr.message}`);
        Logger.log(taskErr.stack);
      }
    });

    Logger.log('\n\n╔════════════════════════════════════════╗');
    Logger.log('║   SCHEDULED SWEEP - COMPLETED          ║');
    Logger.log('╚════════════════════════════════════════╝');
    Logger.log(`Tasks run: ${dueTasks.length} | Total events written: ${totalWritten}`);

  } catch (e) {
    Logger.log(`\n\n✗ FATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
}

// ============================================================================
// LASTRUN TIMESTAMP UPDATE
// ============================================================================

/**
 * Updates the LastRun timestamp for a task in _CONFIG.
 * @param {string} taskName - The task name to update
 * @param {Date} timestamp - The timestamp to write
 * @private
 */
function updateLastRun_(taskName, timestamp) {
  try {
    const ss = SpreadsheetApp.openById(CORE_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const taskCol = headers.indexOf('Task Name');
    const lastRunCol = headers.indexOf('LastRun');

    if (taskCol === -1 || lastRunCol === -1) {
      Logger.log('  Warning: Could not find Task Name or LastRun column');
      return;
    }

    const lastRow = sheet.getLastRow();
    const taskNames = sheet.getRange(2, taskCol + 1, lastRow - 1, 1).getValues();

    for (let i = 0; i < taskNames.length; i++) {
      if (String(taskNames[i][0]).trim() === taskName) {
        sheet.getRange(i + 2, lastRunCol + 1).setValue(timestamp);
        Logger.log(`  ✓ Updated LastRun for "${taskName}"`);
        return;
      }
    }

    Logger.log(`  Warning: Task "${taskName}" not found in _CONFIG for LastRun update`);
  } catch (e) {
    Logger.log(`  Warning: Could not update LastRun: ${e.message}`);
  }
}

// ============================================================================
// TRIGGER SETUP
// ============================================================================

/**
 * Creates the daily trigger. Run this ONCE to activate scheduling.
 * Fires every day at 6:00 AM Pacific.
 */
function setupDailyTrigger() {
  // Remove any existing daily sweep triggers first
  const existing = ScriptApp.getProjectTriggers();
  let removed = 0;
  existing.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'runScheduledSweep') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  if (removed > 0) Logger.log(`Removed ${removed} existing runScheduledSweep trigger(s)`);

  // Create new daily trigger at 6 AM
  ScriptApp.newTrigger('runScheduledSweep')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  Logger.log('✓ Daily trigger created: runScheduledSweep @ 6:00 AM (every day)');
  Logger.log('Schedule:');
  Logger.log('  2x/week  tasks → Mon + Thu');
  Logger.log('  2x/month tasks → 1st + 15th');
  Logger.log('  1x/month tasks → 1st');
}

/**
 * Lists all project triggers for debugging.
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`Total triggers: ${triggers.length}`);
  triggers.forEach((t, i) => {
    Logger.log(`  [${i + 1}] ${t.getHandlerFunction()} — ${t.getEventType()} — ${t.getTriggerSource()}`);
  });
}

// ============================================================================
// MANUAL / TEST HELPERS
// ============================================================================

/**
 * Dry run: shows which tasks WOULD run today without executing them.
 */
function previewTodaysSchedule() {
  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dateStr = `${now.toISOString().split('T')[0]} (${dayNames[now.getDay()]}), Day ${now.getDate()}`;

  const tasks = getSearchPromptsConfig();
  const due = tasks.filter(t => isDueToday_(t.cadence, now));
  const skipped = tasks.filter(t => !isDueToday_(t.cadence, now));

  const lines = [`Today: ${dateStr}`, ''];
  lines.push(`DUE TODAY (${due.length}):`);
  due.forEach(t => lines.push(`  ✓ ${t.taskName} — ${t.cadence}`));
  lines.push('');
  lines.push(`SKIPPED (${skipped.length}):`);
  skipped.forEach(t => lines.push(`  - ${t.taskName} — ${t.cadence || '(no cadence)'}`));

  const result = lines.join('\n');
  Logger.log(result);
  return result;
}

/**
 * Force-run a specific task by name, ignoring cadence.
 * @param {string} taskName - Exact task name from _CONFIG
 */
function runSingleTask(taskName) {
  Logger.log(`\n=== MANUAL RUN: ${taskName} ===`);

  const tasks = getSearchPromptsConfig();
  const task = tasks.find(t => t.taskName === taskName);

  if (!task) {
    Logger.log(`✗ Task "${taskName}" not found (or not Active).`);
    return;
  }

  const queries = task.searchQueries
    .split('\n')
    .map(q => q.trim())
    .filter(q => q.length > 0);

  const searchResults = searchPhase_(queries, task.serperTbs || '');
  const extractedEvents = readerPhase_(searchResults, task.systemPrompt);
  const recentEvents = filterByDate_(extractedEvents, 14);

  let eventsToWrite;
  if (task.validateSoCal) {
    eventsToWrite = validatePhase_(recentEvents);
  } else {
    eventsToWrite = recentEvents;
  }

  const writtenCount = writePhase_(eventsToWrite, task.sheetName, task.bdEligible);
  updateLastRun_(task.taskName, new Date());

  Logger.log(`\n✓ Done: ${writtenCount} events written`);
}
