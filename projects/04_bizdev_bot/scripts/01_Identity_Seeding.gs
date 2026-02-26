/**
 * BD TRACKER - IDENTITY & SEEDING
 * Version: 2.1.0 (Split: HM_Signals moved to 01a)
 * @execution manual
 *
 * CONTAINS:
 * - BD_Contacts seeding operations
 * - Identity formula injection
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 * SEE ALSO: 01a_HM_Signals_Seeding.gs (HM_Signals_Master operations)
 */

/** ==========================================================================
 *  BD_CONTACTS OPERATIONS
 *  ========================================================================== */

/**
 * Add selected HMs from HM_Person_Master to BD_Contacts
 * USER-FACING FUNCTION (called from menu)
 *
 * Usage: Select keys in Column A of HM_Person_Master, then run this function
 */
function AddSelectedHMsToBD_Contacts() {
  try {
    const ss = getSpreadsheet_();
    const activeRange = ss.getActiveRange();
    const hmSheet = ss.getSheetByName(CONFIG.sheetHM);

    // Validate user selection
    if (!activeRange || activeRange.getSheet().getName() !== CONFIG.sheetHM || activeRange.getColumn() !== 1) {
      SpreadsheetApp.getUi().alert('Please select keys in Column A of HM_Person_Master.');
      return;
    }

    const rawVals = activeRange.getValues();
    const keys = rawVals.map(r => r[0]).filter(k => k); // Filter out blanks

    if (keys.length === 0) {
      ss.toast('No valid keys selected.', 'Selection Empty');
      return;
    }

    addKeysToBDContacts_(keys);

  } catch (e) {
    logError_('BD_CONTACTS_SEED', 'ADD_SELECTED_ERROR', 'AddSelectedHMsToBD_Contacts', e.toString());
    SpreadsheetApp.getUi().alert(`Error: ${e.message}`);
  }
}

/**
 * Core logic: Add keys to BD_Contacts (Idempotent)
 * Deduplicates against existing keys and only adds new ones
 *
 * @param {Array<string>} keys - Array of composite keys to add
 * @returns {Object} - {addedCount: number, skippedCount: number}
 */
function addKeysToBDContacts_(keys) {
  const ss = getSpreadsheet_();
  const bd = ss.getSheetByName(CONFIG.sheetBD);

  if (!bd) {
    throw new Error(`Sheet ${CONFIG.sheetBD} not found`);
  }

  // 1. Read existing keys to deduplicate
  const maxRows = bd.getMaxRows();
  const existingRange = bd.getRange(2, 1, Math.max(1, maxRows - 1), 1);
  const existingVals = existingRange.getValues().flat();
  const existingSet = new Set(existingVals.map(v => String(v).trim()).filter(v => v));

  // 2. Filter new keys (deduplicate inputs and check against existing)
  const uniqueKeys = [...new Set(keys.map(k => String(k).trim()))].filter(k => k);
  const toAdd = uniqueKeys.filter(k => !existingSet.has(k));

  if (toAdd.length === 0) {
    ss.toast('No new keys to add. All selected keys already exist in BD_Contacts.', 'Sync Complete');
    persistRunLog_('AddKeysToBD', { addedCount: 0, skippedCount: keys.length });
    return { addedCount: 0, skippedCount: keys.length };
  }

  // 3. Find write position (Anti-getLastRow Law)
  const startRow = getFirstEmptyRowA_(bd);

  // 4. Ensure sufficient rows
  ensureSheetHasRows_(bd, startRow + toAdd.length - 1);

  // 5. Batch write keys (Column A only - formulas in B-F should already exist)
  const writeData = toAdd.map(k => [k]);
  bd.getRange(startRow, 1, writeData.length, 1).setValues(writeData);

  Logger.log(`✓ Added ${toAdd.length} keys to BD_Contacts (formulas auto-populate)`);

  // 6. Auto-seed HM_Signals_Master (Bug #2 fix)
  if (toAdd.length > 0) {
    try {
      Utilities.sleep(1000); // Brief wait before next operation
      seedHMSignalsFromBD_();
      Logger.log(`✓ Auto-seeded HM_Signals_Master from BD_Contacts`);
    } catch (e) {
      Logger.log(`Warning: Failed to auto-seed HM_Signals: ${e.toString()}`);
    }
  }

  return { addedCount: toAdd.length, skippedCount: keys.length - toAdd.length };
}

/**
 * Ensure VLOOKUP formulas exist in BD_Contacts B, D-G, K-L
 * USER-FACING FUNCTION (called from menu)
 *
 * ⚠️ WARNING: This writes 10,000 formulas and can timeout!
 * Only use this for:
 * - Initial sheet setup
 * - Repairing broken formulas
 * - NOT during normal auto-seeding operations
 *
 * Writes formulas that lookup identity data from HM_Person_Master
 * Columns: B=LinkedIn, C=Name, D=Title, E=Company, F=Domain
 */
function Phase3_3_EnsureIdentityFormulas() {
  try {
    const ui = SpreadsheetApp.getUi();
    const response = ui.alert(
      'Repair BD_Contacts Formulas?',
      'This will overwrite formulas in columns B, D-G, and K-L for 10,000 rows.\n\nOnly use if formulas are broken.\n\nProceed?',
      ui.ButtonSet.YES_NO
    );

    if (response === ui.Button.YES) {
      ensureIdentityFormulas_();
      getSpreadsheet_().toast('Identity formulas updated successfully.', 'Formula Update Complete');
    }
  } catch (e) {
    logError_('BD_CONTACTS_FORMULAS', 'FORMULA_UPDATE_ERROR', 'EnsureIdentityFormulas', e.toString());
    SpreadsheetApp.getUi().alert(`Error updating formulas: ${e.message}`);
  }
}

/**
 * Internal: Ensure identity formulas in BD_Contacts
 * Batch writes VLOOKUP formulas to columns B, D-G, and K-L
 * Column C (1st_Degree) is NOT a VLOOKUP — filled by refreshBDContactsColumns
 * ⚠️ Only call during initial setup or manual repair
 */
function ensureIdentityFormulas_() {
  const ss = getSpreadsheet_();
  const bd = ss.getSheetByName(CONFIG.sheetBD);
  const rows = CONFIG.defaultIdentityRows;

  if (!bd) {
    throw new Error(`Sheet ${CONFIG.sheetBD} not found`);
  }

  // Ensure sheet has enough rows
  ensureSheetHasRows_(bd, rows + 1);

  // Build formula array for B (LinkedIn_URL)
  const bFormulas = [];
  for (let i = 2; i <= rows + 1; i++) {
    bFormulas.push([
      `=IF($A${i}="","",IFERROR(VLOOKUP($A${i},'${CONFIG.sheetHM}'!$A:$F,2,false),""))` // B: LinkedIn
    ]);
  }
  bd.getRange(2, 2, rows, 1).setFormulas(bFormulas);

  // Build formula array for D-G (HM_Name, HM_Title, Company, Company_Domain)
  const dgFormulas = [];
  for (let i = 2; i <= rows + 1; i++) {
    dgFormulas.push([
      `=IF($A${i}="","",IFERROR(VLOOKUP($A${i},'${CONFIG.sheetHM}'!$A:$F,3,false),""))`, // D: Name
      `=IF($A${i}="","",IFERROR(VLOOKUP($A${i},'${CONFIG.sheetHM}'!$A:$F,4,false),""))`, // E: Title
      `=IF($A${i}="","",IFERROR(VLOOKUP($A${i},'${CONFIG.sheetHM}'!$A:$F,5,false),""))`, // F: Company
      `=IF($A${i}="","",IFERROR(VLOOKUP($A${i},'${CONFIG.sheetHM}'!$A:$F,6,false),""))`  // G: Domain
    ]);
  }
  bd.getRange(2, 4, rows, 4).setFormulas(dgFormulas);

  // Build formula array for K-L (Primary_Email, Primary_Phone)
  const klFormulas = [];
  for (let i = 2; i <= rows + 1; i++) {
    klFormulas.push([
      `=IF($A${i}="","",IFERROR(VLOOKUP($A${i},'${CONFIG.sheetHM}'!$A:$H,7,false),""))`, // K: Primary Email
      `=IF($A${i}="","",IFERROR(VLOOKUP($A${i},'${CONFIG.sheetHM}'!$A:$H,8,false),""))`  // L: Primary Phone
    ]);
  }
  bd.getRange(2, 11, rows, 2).setFormulas(klFormulas);

  Logger.log(`✓ Identity formulas updated in ${CONFIG.sheetBD} B, D-G, K-L (rows 2-${rows+1})`);
}

// HM_Signals_Master operations moved to 01a_HM_Signals_Seeding.gs
