/**
 * 98b_LinkedIn_Write.gs
 * BD TRACKER - LinkedIn Import Batch Writer & Pipeline Hooks
 * @execution manual
 * Version: 1.0.0
 *
 * CONTAINS:
 * - writeLinkedInBatch_: Batch-write accumulators to all destination sheets
 *   and fire post-import pipeline hooks (backfill, enrichment chain)
 *
 * SPLIT FROM: 98_LinkedIn_Import.gs (processLinkedInCSV_ lines 281-428)
 * CALLED BY: 98_LinkedIn_Import.gs (processLinkedInCSV_)
 * DEPENDENCIES: 00_Brain_Config.gs (CONFIG, isoNow_, persistRunLog_, logError_,
 *               getFirstEmptyRowA_, ensureSheetHasRows_)
 *               08_BackfillContactInfo.gs (backfillContactInfoForKeys_, appendToContactInfo_)
 *               01_Identity_Seeding.gs (addKeysToBDContacts_)
 *               07_Enrichment_Chain.gs (scheduleEnrichmentChain_)
 *               98a_LinkedIn_Helpers.gs (appendToJobChangeLog_, updateLinkedInSignals_)
 */

/**
 * Batch-write LinkedIn import accumulators to all destination sheets
 * Fires post-import pipeline hooks after writes complete
 *
 * @param {Sheet} hm - HM_Person_Master sheet reference
 * @param {number} hmLastRow - Last row of HM at read time (for bulk update range)
 * @param {Array} hmToAdd - New HM rows to append
 * @param {Array} hmToUpdate - Existing rows to update {row, title, company}
 * @param {Array} jobChangesToLog - Job change records for HM_Job_Change_Log
 * @param {Array} contactInfoToAdd - Email rows for HM_ContactInfo
 * @param {Array} signalsToAdd - Keys for HM_Signals_Master 1st-Degree flag
 * @param {number} filteredCount - Title-filtered row count (for summary)
 * @param {number} errorCount - Row-level error count (for summary)
 * @returns {Object} - {hmAdded, hmUpdated, contactInfoAdded, signalsUpdated, bdSeeded, filtered, errors}
 */
function writeLinkedInBatch_(hm, hmLastRow, hmToAdd, hmToUpdate, jobChangesToLog, contactInfoToAdd, signalsToAdd, filteredCount, errorCount) {
  const runId = isoNow_();
  const source = 'LinkedIn_Connections';

  // Batch write to HM_Person_Master (new records)
  let hmAddedCount = 0;
  let hmUpdatedCount = 0;
  if (hmToAdd.length > 0) {
    const hmStartRow = getFirstEmptyRowA_(hm);
    ensureSheetHasRows_(hm, hmStartRow + hmToAdd.length - 1);
    hm.getRange(hmStartRow, 1, hmToAdd.length, 14).setValues(hmToAdd);
    hmAddedCount = hmToAdd.length;
    Logger.log(`✓ Added ${hmAddedCount} new records to HM_Person_Master from LinkedIn`);
  }

  // Batch update existing records (columns D, E only - Title and Company)
  if (hmToUpdate.length > 0) {
    try {
      if (hmToUpdate.length < 100) {
        // Small update: individual cell writes
        for (const update of hmToUpdate) {
          hm.getRange(update.row, 4, 1, 2).setValues([[
            update.title,
            update.company
          ]]);
        }
      } else {
        // Large update (100+): read-modify-write bulk
        const allData = hm.getRange(2, 4, hmLastRow - 1, 2).getValues();
        const updateMap = new Map();
        hmToUpdate.forEach(u => updateMap.set(u.row, u));
        allData.forEach((row, index) => {
          const rowNum = index + 2;
          if (updateMap.has(rowNum)) {
            const update = updateMap.get(rowNum);
            allData[index] = [update.title, update.company];
          }
        });
        hm.getRange(2, 4, allData.length, 2).setValues(allData);
      }

      // Stamp Last_Update_Source (M) and Last_Update_Date (N)
      for (const update of hmToUpdate) {
        hm.getRange(update.row, 13, 1, 2).setValues([[source, runId]]);
      }

      hmUpdatedCount = hmToUpdate.length;
      Logger.log(`✓ Updated ${hmUpdatedCount} existing records in HM_Person_Master from LinkedIn`);
    } catch (e) {
      Logger.log(`Warning: Failed to update existing records: ${e.toString()}`);
    }
  }

  // Batch write to HM_Job_Change_Log
  let jobChangesLoggedCount = 0;
  if (jobChangesToLog.length > 0) {
    try {
      jobChangesLoggedCount = appendToJobChangeLog_(jobChangesToLog);
      Logger.log(`✓ Logged ${jobChangesLoggedCount} job changes to HM_Job_Change_Log`);
    } catch (e) {
      Logger.log(`Warning: Failed to log job changes: ${e.toString()}`);
    }
  }

  // Batch write to HM_ContactInfo
  let contactInfoAddedCount = 0;
  if (contactInfoToAdd.length > 0) {
    contactInfoAddedCount = appendToContactInfo_(contactInfoToAdd);
    Logger.log(`✓ Added ${contactInfoAddedCount} contact channels to HM_ContactInfo from LinkedIn`);
  }

  // Auto-seed BD_Contacts
  let bdSeededCount = 0;
  if (hmAddedCount > 0) {
    try {
      Utilities.sleep(2000);
      const newKeys = hmToAdd.map(row => row[0]);
      const result = addKeysToBDContacts_(newKeys);
      bdSeededCount = result.addedCount;
      Logger.log(`✓ Auto-seeded ${bdSeededCount} keys to BD_Contacts`);
    } catch (e) {
      Logger.log(`Warning: Failed to auto-seed BD_Contacts: ${e.toString()}`);
    }
  }

  // Update HM_Signals_Master col G (1st-Degree) — MUST be after auto-seed
  let signalsUpdatedCount = 0;
  if (signalsToAdd.length > 0) {
    try {
      if (hmAddedCount > 0) Utilities.sleep(2000);
      signalsUpdatedCount = updateLinkedInSignals_(signalsToAdd);
      Logger.log(`✓ Updated ${signalsUpdatedCount} rows in HM_Signals_Master (1st-Degree = Yes)`);
    } catch (e) {
      Logger.log(`Warning: Failed to update HM_Signals_Master: ${e.toString()}`);
    }
  }

  // Log operation summary
  persistRunLog_('LinkedInImport', {
    hmAdded: hmAddedCount,
    hmUpdated: hmUpdatedCount,
    contactInfoAdded: contactInfoAddedCount,
    signalsUpdated: signalsUpdatedCount,
    bdSeeded: bdSeededCount,
    filtered: filteredCount,
    errors: errorCount,
    runId: runId,
    source: source
  });

  // --- PIPELINE HOOKS ---
  // Backfill contact info from HM_ContactInfo → HM_Person_Master
  if (hmAddedCount > 0 || hmToUpdate.length > 0) {
    try {
      const allKeys = hmToAdd.map(row => row[0]).concat(hmToUpdate.map(u => u.key || ''));
      backfillContactInfoForKeys_(allKeys.filter(k => k));
      Logger.log(`✓ Backfilled contact info for ${allKeys.length} keys`);
    } catch (e) {
      Logger.log(`Warning: Failed to backfill contact info: ${e.toString()}`);
    }
  }

  // Schedule enrichment chain (1 min delay)
  if (hmAddedCount > 0 || hmUpdatedCount > 0) {
    try {
      scheduleEnrichmentChain_(1);
    } catch (e) {
      Logger.log(`Warning: Failed to schedule enrichment chain: ${e.toString()}`);
    }
  }

  return {
    hmAdded: hmAddedCount,
    hmUpdated: hmUpdatedCount,
    contactInfoAdded: contactInfoAddedCount,
    signalsUpdated: signalsUpdatedCount,
    bdSeeded: bdSeededCount,
    filtered: filteredCount,
    errors: errorCount
  };
}
