/**
 * 04_Menu.gs
 *
 * Custom menu for the Market Intel Bot spreadsheet.
 * Provides "Run All" and per-prompt manual execution from the sheet UI.
 *
 * onOpen() is a simple trigger — limited auth, so it reads _CONFIG
 * via getActiveSpreadsheet() (not openById). Handler functions run
 * with full auth when clicked.
 *
 * Dispatcher pattern: onOpen() assigns menuRunTask0..N to the Nth
 * active task. When clicked, runNthActiveTask_() re-reads _CONFIG
 * to resolve the task name, then calls runSingleTask().
 */

// ============================================================================
// MENU CONSTRUCTION (simple trigger)
// ============================================================================

/**
 * Builds the Market Intel custom menu when the spreadsheet opens.
 * Reads _CONFIG to list active prompts dynamically.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('Market Intel');

  menu.addItem('Run All Active Prompts', 'menuRunAll');
  menu.addItem('Preview Today\'s Schedule', 'menuPreviewSchedule');
  menu.addSeparator();

  // Read active tasks from the active spreadsheet (simple trigger safe)
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName('_CONFIG');

    if (configSheet && configSheet.getLastRow() > 1) {
      const data = configSheet.getDataRange().getValues();
      const headers = data[0];
      const taskCol = headers.indexOf('Task Name');
      const activeCol = headers.indexOf('Active');

      if (taskCol !== -1 && activeCol !== -1) {
        let taskIndex = 0;
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][activeCol]).toUpperCase() === 'TRUE') {
            menu.addItem(String(data[i][taskCol]), 'menuRunTask' + taskIndex);
            taskIndex++;
          }
        }
      }
    }
  } catch (e) {
    // Simple trigger auth limits — menu still works, just without individual items
  }

  menu.addSeparator();
  menu.addItem('Export Newsletter CSV', 'exportNewsletterCSV');

  menu.addToUi();
}

// ============================================================================
// MENU HANDLERS (full auth)
// ============================================================================

/**
 * Runs all active prompts (same as the main sweep).
 */
function menuRunAll() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    'Run All Active Prompts',
    'This will run the full Market Intel sweep for all active prompts. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result !== ui.Button.YES) return;

  ui.alert('Started', 'Running all active prompts. This may take several minutes.\n\nCheck Executions log for progress.', ui.ButtonSet.OK);
  runMarketIntelSweep();
}

/**
 * Shows which tasks are scheduled for today.
 */
function menuPreviewSchedule() {
  const preview = previewTodaysSchedule();
  SpreadsheetApp.getUi().alert('Today\'s Schedule', preview, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================================
// TASK DISPATCHERS
// ============================================================================

/**
 * Resolves the Nth active task from _CONFIG and runs it.
 * @param {number} n - 0-based index into active tasks
 * @private
 */
function runNthActiveTask_(n) {
  const ui = SpreadsheetApp.getUi();
  const tasks = getSearchPromptsConfig();

  if (n >= tasks.length) {
    ui.alert('Error', 'Task not found. The config may have changed — reload the spreadsheet.', ui.ButtonSet.OK);
    return;
  }

  const task = tasks[n];
  const result = ui.alert(
    'Run Task',
    'Run "' + task.taskName + '" now?',
    ui.ButtonSet.YES_NO
  );

  if (result !== ui.Button.YES) return;

  ui.alert('Started', 'Running "' + task.taskName + '". This may take a few minutes.\n\nCheck Executions log for progress.', ui.ButtonSet.OK);
  runSingleTask(task.taskName);
}

// Pre-defined dispatchers (0-14 covers growth beyond current 7 active + 4 disabled)
function menuRunTask0()  { runNthActiveTask_(0); }
function menuRunTask1()  { runNthActiveTask_(1); }
function menuRunTask2()  { runNthActiveTask_(2); }
function menuRunTask3()  { runNthActiveTask_(3); }
function menuRunTask4()  { runNthActiveTask_(4); }
function menuRunTask5()  { runNthActiveTask_(5); }
function menuRunTask6()  { runNthActiveTask_(6); }
function menuRunTask7()  { runNthActiveTask_(7); }
function menuRunTask8()  { runNthActiveTask_(8); }
function menuRunTask9()  { runNthActiveTask_(9); }
function menuRunTask10() { runNthActiveTask_(10); }
function menuRunTask11() { runNthActiveTask_(11); }
function menuRunTask12() { runNthActiveTask_(12); }
function menuRunTask13() { runNthActiveTask_(13); }
function menuRunTask14() { runNthActiveTask_(14); }
