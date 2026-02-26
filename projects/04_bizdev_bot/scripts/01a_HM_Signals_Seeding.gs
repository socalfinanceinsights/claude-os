/**
 * BD TRACKER - HM_SIGNALS_MASTER SEEDING
 * Version: 1.0.0 (Split from 01_Identity_Seeding.gs)
 * @execution manual
 *
 * CONTAINS:
 * - HM_Signals_Master seeding operations
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 * CALLED BY: 01_Identity_Seeding.gs (addKeysToBDContacts_ auto-seeds)
 */

/** ==========================================================================
 *  HM_SIGNALS_MASTER OPERATIONS
 *  ========================================================================== */

/**
 * Internal helper: Seed HM_Signals_Master from BD_Contacts
 * Can be called by menu function or auto-seeding logic
 */
function seedHMSignalsFromBD_() {
  const ss = getSpreadsheet_();
  const bd = ss.getSheetByName(CONFIG.sheetBD);
  let sig = ss.getSheetByName(CONFIG.sheetSignals);

  if (!bd) {
    throw new Error(`Sheet ${CONFIG.sheetBD} not found`);
  }

  // Create HM_Signals_Master if missing
  if (!sig) {
    sig = ss.insertSheet(CONFIG.sheetSignals);
    // Add headers (matching SHEET_MAPPING.md structure)
    sig.appendRow([
      'Composite Key', 'LinkedIn URL', 'HM Name', 'HM Title', 'Company', 'Company Domain',
      '1st-Degree (Yes/No)', 'Referral (Yes/No)', 'Referral Source',
      'Public Activity (Yes/No)', 'Candidate Intel (Yes/No)', 'Recent Joiner (Yes/No)', 'Manager Notes'
      // Additional columns handled by formulas in sheet
    ]);
  }

  // Read source keys from BD_Contacts
  const bdLastRow = bd.getLastRow();
  if (bdLastRow < 2) {
    ss.toast('No data in BD_Contacts to seed.', 'Seed Signals');
    return;
  }

  const bdKeys = bd.getRange(2, 1, bdLastRow - 1, 1).getValues().flat().filter(v => String(v).trim());

  // Read target keys from HM_Signals_Master
  const sigLastRow = sig.getLastRow() || 1;
  const sigKeys = sigLastRow > 1
    ? sig.getRange(2, 1, sigLastRow - 1, 1).getValues().flat().filter(v => String(v).trim())
    : [];

  const sigSet = new Set(sigKeys);

  // Find keys to add
  const toAdd = bdKeys.filter(k => !sigSet.has(k));

  if (toAdd.length === 0) {
    ss.toast('HM_Signals_Master is up to date. No new keys to seed.', 'Seed Signals');
    persistRunLog_('SeedSignals', { added: 0, alreadyExist: bdKeys.length });
    return;
  }

  // Find write position (Anti-getLastRow Law)
  const startRow = getFirstEmptyRowA_(sig);

  // Ensure sufficient rows
  ensureSheetHasRows_(sig, startRow + toAdd.length - 1);

  // Write keys to Column A only (formulas in B-F should already exist in sheet)
  const keyData = toAdd.map(k => [k]);
  sig.getRange(startRow, 1, toAdd.length, 1).setValues(keyData);

  // Log operation
  persistRunLog_('SeedSignals', { added: toAdd.length, startRow: startRow });

  Logger.log(`✓ Seeded ${toAdd.length} new rows to HM_Signals_Master`);
}

/**
 * Seed HM_Signals_Master from BD_Contacts
 * USER-FACING FUNCTION (called from menu)
 *
 * Ensures every key in BD_Contacts exists in HM_Signals_Master
 * Adds missing keys with identity formulas
 */
function Seed_HM_Signals_From_BD() {
  try {
    seedHMSignalsFromBD_();
    getSpreadsheet_().toast('HM_Signals_Master seeded successfully.', 'Seed Signals');
  } catch (e) {
    logError_('SIGNALS_SEED', 'SEED_ERROR', 'Seed_HM_Signals_From_BD', e.toString());
    SpreadsheetApp.getUi().alert(`Error seeding signals: ${e.message}`);
  }
}
