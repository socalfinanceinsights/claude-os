/**
 * 15a_Funding_Sweep.gs
 * SDI Scout - Capital Funding Sweep & Manual Trigger
 * @execution manual
 * Version: 1.0.0
 *
 * PURPOSE: Upsert Company_Master funding columns from Capital events.
 *          Also provides manual menu trigger for behavioral rollup.
 * SPLIT FROM: 15_Behavioral_Rollup.gs (lines 123-281)
 * DEPENDENCIES: 13_SDI_Config.gs (SDI_CONFIG, generateSDITimestamp_, generateSDIRunId_)
 *               15_Behavioral_Rollup.gs (runBehavioralRollup_)
 *               00_Brain_Config.gs (persistRunLog_, logError_)
 * CALLED BY: 14_SDI_Engine.gs (sdiScoutRun), menu
 */

// ============================================
// FUNDING SWEEP
// ============================================

/**
 * Check Capital events in Company_Events and upsert Company_Master T/U/V if newer.
 * Rules: newer-date-wins, never overwrite with blanks, stamp AB.
 *
 * @param {Array<string>} capitalDomains - Domains that had Capital events written
 * @returns {Object} - { upserted: number, skipped: number, changes: Array }
 */
function runFundingSweep_(capitalDomains) {
  if (!capitalDomains || capitalDomains.length === 0) {
    return { upserted: 0, skipped: 0, changes: [] };
  }

  const ss = SpreadsheetApp.openById(SDI_CONFIG.spreadsheetId);
  const cols = SDI_CONFIG.eventCols;
  const fc = SDI_CONFIG.fundingCols;

  // 1. Read Capital events from Company_Events
  const eventsSheet = ss.getSheetByName(SDI_CONFIG.sheetEvents);
  const lastRow = eventsSheet.getLastRow();
  if (lastRow <= 1) return { upserted: 0, skipped: 0, changes: [] };

  const eventsData = eventsSheet.getRange(2, 1, lastRow - 1, 12).getValues();

  // Group Capital events by domain (keep most recent per domain)
  const capitalByDomain = {};
  const targetSet = new Set(capitalDomains.map(d => d.toLowerCase()));

  for (const row of eventsData) {
    const domain = String(row[cols.domain] || '').trim().toLowerCase();
    const eventType = String(row[cols.eventType] || '').trim();
    if (eventType !== 'Capital' || !targetSet.has(domain)) continue;

    const eventDate = row[cols.eventDate] instanceof Date ? row[cols.eventDate] : new Date(row[cols.eventDate]);
    if (isNaN(eventDate.getTime())) continue;

    const subtype = String(row[cols.subtype] || '').trim();
    const notes = String(row[cols.notes] || '').trim();

    // Keep most recent Capital event per domain
    if (!capitalByDomain[domain] || eventDate > capitalByDomain[domain].date) {
      capitalByDomain[domain] = {
        date: eventDate,
        type: subtype,
        notes: notes
      };
    }
  }

  // 2. Read Company_Master funding columns
  const cmSheet = ss.getSheetByName(SDI_CONFIG.sheetCompanyMaster);
  const cmLastRow = cmSheet.getLastRow();
  if (cmLastRow <= 1) return { upserted: 0, skipped: 0, changes: [] };

  const cmDomains = cmSheet.getRange(2, 1, cmLastRow - 1, 1).getValues(); // Col A
  const cmFunding = cmSheet.getRange(2, fc.lastFundingType + 1, cmLastRow - 1, 3).getValues(); // T, U, V

  // Build domain → row map
  const cmRowMap = {};
  for (let i = 0; i < cmDomains.length; i++) {
    const d = String(cmDomains[i][0] || '').trim().toLowerCase();
    if (d) cmRowMap[d] = i;
  }

  // 3. Upsert logic
  let upserted = 0;
  let skipped = 0;
  const changes = [];
  const timestamp = generateSDITimestamp_();

  for (const domain of Object.keys(capitalByDomain)) {
    const rowIdx = cmRowMap[domain];
    if (rowIdx === undefined) {
      Logger.log(`  Funding sweep: domain "${domain}" not in Company_Master — skipping`);
      skipped++;
      continue;
    }

    const sdiEvent = capitalByDomain[domain];
    const existingDate = cmFunding[rowIdx][1]; // Col U (Last Funding Date)
    const existingDateParsed = existingDate instanceof Date ? existingDate : new Date(existingDate);

    // Rule: skip if existing date is same or newer
    if (existingDateParsed instanceof Date && !isNaN(existingDateParsed.getTime())) {
      if (sdiEvent.date <= existingDateParsed) {
        Logger.log(`  Funding sweep: ${domain} — SDI date ${sdiEvent.date.toISOString().slice(0,10)} <= existing ${existingDateParsed.toISOString().slice(0,10)}, skipping`);
        skipped++;
        continue;
      }
    }

    // Build update: only write fields where SDI has data
    const sheetRow = rowIdx + 2; // +2 for header + 0-index
    const change = { domain: domain, fields: [] };

    // Col T: Last Funding Type
    if (sdiEvent.type) {
      cmSheet.getRange(sheetRow, fc.lastFundingType + 1).setValue(sdiEvent.type);
      change.fields.push('T=' + sdiEvent.type);
    }

    // Col U: Last Funding Date
    cmSheet.getRange(sheetRow, fc.lastFundingDate + 1).setValue(sdiEvent.date);
    change.fields.push('U=' + sdiEvent.date.toISOString().slice(0, 10));

    // Col V: Last Funding Amount — only if extractable from notes
    const amountMatch = sdiEvent.notes.match(/\$[\d,.]+[MBK]?/i);
    if (amountMatch) {
      cmSheet.getRange(sheetRow, fc.lastFundingAmount + 1).setValue(amountMatch[0]);
      change.fields.push('V=' + amountMatch[0]);
    }

    // Col AB: Last_Updated stamp
    cmSheet.getRange(sheetRow, fc.lastUpdated + 1).setValue(timestamp);
    change.fields.push('AB=' + timestamp);

    changes.push(change);
    upserted++;
    Logger.log(`  Funding sweep: ${domain} — upserted (${change.fields.join(', ')})`);
  }

  Logger.log(`Funding sweep: ${upserted} upserted, ${skipped} skipped`);
  return { upserted, skipped, changes };
}

// ============================================
// MANUAL TRIGGER (Menu Entry)
// ============================================

/**
 * Manual behavioral rollup — runs for ALL domains.
 * Triggered from menu: SDI Scout → Manual Behavioral Rollup
 */
function manualBehavioralRollup() {
  const ui = SpreadsheetApp.getUi();

  try {
    Logger.log('=== MANUAL BEHAVIORAL ROLLUP ===');
    const result = runBehavioralRollup_(null);
    const msg = `Behavioral rollup complete.\n\nDomains updated: ${result.domainsUpdated}`;
    ui.alert('Rollup Complete', msg, ui.ButtonSet.OK);

    persistRunLog_('Manual_Behavioral_Rollup', {
      runId: generateSDIRunId_(),
      domainsUpdated: result.domainsUpdated,
      details: result.details
    });

  } catch (e) {
    Logger.log(`ERROR in manual rollup: ${e.message}`);
    ui.alert('Rollup Error', e.message, ui.ButtonSet.OK);
    logError_('BEHAVIORAL_ROLLUP', 'ROLLUP_FAILED', 'Manual trigger', e.message);
  }
}
