/**
 * 08_BackfillContactInfo.gs
 * @execution manual, pipeline
 *
 * Maps HM_ContactInfo → HM_Person_Master (emails + phones)
 * Two modes: sweep-all (menu) and pipeline (import hooks)
 *
 * DEPENDENCIES: 00_Brain_Config.gs
 */

/**
 * MENU FUNCTION: Process all HM_Person_Master rows
 * Backfills Primary_Email, Primary_Phone, Secondary_Phone from HM_ContactInfo
 * Shows toast with results when complete
 */
function BackfillContactInfo_SweepAll() {
  try {
    const ss = getSpreadsheet_();
    const hmSheet = ss.getSheetByName(CONFIG.sheetHM);
    const contactSheet = ss.getSheetByName(CONFIG.sheetContactInfo);

    if (!hmSheet) {
      SpreadsheetApp.getUi().alert('Error: HM_Person_Master sheet not found');
      return;
    }

    if (!contactSheet) {
      SpreadsheetApp.getUi().alert('Error: HM_ContactInfo sheet not found');
      return;
    }

    Logger.log('Starting BackfillContactInfo_SweepAll...');

    // Read all HM_Person_Master keys
    const hmLastRow = hmSheet.getLastRow();
    if (hmLastRow <= 1) {
      SpreadsheetApp.getUi().alert('No data in HM_Person_Master');
      return;
    }

    const hmKeys = hmSheet.getRange(2, 1, hmLastRow - 1, 1).getValues()
      .map(row => String(row[0] || '').trim())
      .filter(key => key); // Remove blanks

    Logger.log(`Found ${hmKeys.length} keys in HM_Person_Master`);

    // Call pipeline function
    const result = backfillContactInfoForKeys_(hmKeys);

    // Show results
    const msg = `Backfill Complete:\n\n` +
      `Emails Filled: ${result.emailsFilled}\n` +
      `Primary Phones Filled: ${result.primaryPhonesFilled}\n` +
      `Secondary Phones Filled: ${result.secondaryPhonesFilled}`;

    SpreadsheetApp.getUi().alert(msg);
    Logger.log(msg);

    // Log to Run_Logs
    persistRunLog_('BackfillContactInfo', {
      runId: `backfill_${Date.now()}`,
      keysProcessed: hmKeys.length,
      emailsFilled: result.emailsFilled,
      primaryPhonesFilled: result.primaryPhonesFilled,
      secondaryPhonesFilled: result.secondaryPhonesFilled,
      timestamp: isoNow_()
    });

  } catch (e) {
    logError_('BACKFILL_CONTACT_INFO', 'SWEEP_FAILED', 'BackfillContactInfo_SweepAll', e.toString());
    SpreadsheetApp.getUi().alert(`Error during backfill: ${e.toString()}`);
  }
}

/**
 * PIPELINE FUNCTION: Process specific keys only
 * Called by import scripts after adding new records
 *
 * @param {Array<string>} keys - Array of Composite_Key values to process
 * @returns {Object} - {emailsFilled, primaryPhonesFilled, secondaryPhonesFilled}
 */
function backfillContactInfoForKeys_(keys) {
  if (!keys || keys.length === 0) {
    Logger.log('backfillContactInfoForKeys_: No keys provided');
    return { emailsFilled: 0, primaryPhonesFilled: 0, secondaryPhonesFilled: 0 };
  }

  try {
    const ss = getSpreadsheet_();
    const hmSheet = ss.getSheetByName(CONFIG.sheetHM);
    const contactSheet = ss.getSheetByName(CONFIG.sheetContactInfo);

    if (!hmSheet || !contactSheet) {
      Logger.log('backfillContactInfoForKeys_: Required sheets not found');
      return { emailsFilled: 0, primaryPhonesFilled: 0, secondaryPhonesFilled: 0 };
    }

    // Read all HM_ContactInfo into memory
    const contactLastRow = contactSheet.getLastRow();
    if (contactLastRow <= 1) {
      Logger.log('backfillContactInfoForKeys_: No data in HM_ContactInfo');
      return { emailsFilled: 0, primaryPhonesFilled: 0, secondaryPhonesFilled: 0 };
    }

    const contactData = contactSheet.getRange(2, 1, contactLastRow - 1, 7).getValues();

    // Group contact info by Composite_Key
    const contactMap = {};
    for (const row of contactData) {
      const key = String(row[CONFIG.contactInfoCols.key] || '').trim();
      const channelType = String(row[CONFIG.contactInfoCols.channelType] || '').trim();
      const channelValue = String(row[CONFIG.contactInfoCols.channelValue] || '').trim();
      const lastSeen = row[CONFIG.contactInfoCols.lastSeen];

      if (!key || !channelValue) continue; // Skip invalid rows

      if (!contactMap[key]) {
        contactMap[key] = [];
      }

      contactMap[key].push({
        type: channelType,
        value: channelValue,
        lastSeen: lastSeen
      });
    }

    Logger.log(`Grouped ${Object.keys(contactMap).length} unique keys from HM_ContactInfo`);

    // Read all HM_Person_Master data
    const hmLastRow = hmSheet.getLastRow();
    if (hmLastRow <= 1) {
      Logger.log('backfillContactInfoForKeys_: No data in HM_Person_Master');
      return { emailsFilled: 0, primaryPhonesFilled: 0, secondaryPhonesFilled: 0 };
    }

    const hmData = hmSheet.getRange(2, 1, hmLastRow - 1, CONFIG.hmPersonCols.secondaryPhone + 1).getValues();

    // Build key-to-row index for quick lookup
    const keyToRowIndex = {};
    for (let i = 0; i < hmData.length; i++) {
      const key = String(hmData[i][CONFIG.hmPersonCols.key] || '').trim();
      if (key) {
        keyToRowIndex[key] = i;
      }
    }

    // Process each requested key
    const updates = []; // Array of {row, email, primaryPhone, secondaryPhone}
    let emailsFilled = 0;
    let primaryPhonesFilled = 0;
    let secondaryPhonesFilled = 0;

    const keysSet = new Set(keys.map(k => String(k).trim()));

    for (const key of keysSet) {
      if (!key) continue;

      const rowIndex = keyToRowIndex[key];
      if (rowIndex === undefined) {
        // Key not found in HM_Person_Master — skip silently
        continue;
      }

      const hmRow = hmData[rowIndex];
      const contacts = contactMap[key];

      if (!contacts || contacts.length === 0) {
        // No contact info for this key — skip silently
        continue;
      }

      // Sort contacts by Last_Seen descending (most recent first)
      contacts.sort((a, b) => {
        const dateA = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
        const dateB = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        return dateB - dateA; // Descending
      });

      // Extract current values (check if blank)
      const currentEmail = String(hmRow[CONFIG.hmPersonCols.primaryEmail] || '').trim();
      const currentPrimaryPhone = String(hmRow[CONFIG.hmPersonCols.primaryPhone] || '').trim();
      const currentSecondaryPhone = String(hmRow[CONFIG.hmPersonCols.secondaryPhone] || '').trim();

      let newEmail = null;
      let newPrimaryPhone = null;
      let newSecondaryPhone = null;

      // Primary_Email: First "Work Email", fallback to first "Personal Email"
      if (!currentEmail) {
        const workEmail = contacts.find(c => c.type === 'Work Email');
        if (workEmail) {
          newEmail = workEmail.value;
        } else {
          const personalEmail = contacts.find(c => c.type === 'Personal Email');
          if (personalEmail) {
            newEmail = personalEmail.value;
          }
        }
        if (newEmail) emailsFilled++;
      }

      // Primary_Phone: First "Office Phone" (no fallback)
      if (!currentPrimaryPhone) {
        const officePhone = contacts.find(c => c.type === 'Office Phone');
        if (officePhone) {
          newPrimaryPhone = officePhone.value;
          primaryPhonesFilled++;
        }
      }

      // Secondary_Phone: First "Mobile Phone", fallback to first "Direct Phone"
      if (!currentSecondaryPhone) {
        const mobilePhone = contacts.find(c => c.type === 'Mobile Phone');
        if (mobilePhone) {
          newSecondaryPhone = mobilePhone.value;
        } else {
          const directPhone = contacts.find(c => c.type === 'Direct Phone');
          if (directPhone) {
            newSecondaryPhone = directPhone.value;
          }
        }
        if (newSecondaryPhone) secondaryPhonesFilled++;
      }

      // Record update if any field changed
      if (newEmail || newPrimaryPhone || newSecondaryPhone) {
        updates.push({
          rowIndex: rowIndex,
          email: newEmail,
          primaryPhone: newPrimaryPhone,
          secondaryPhone: newSecondaryPhone
        });
      }
    }

    // Write updates back to sheet (batch operation)
    if (updates.length > 0) {
      for (const update of updates) {
        const sheetRow = update.rowIndex + 2; // Convert to 1-indexed sheet row

        if (update.email) {
          hmSheet.getRange(sheetRow, CONFIG.hmPersonCols.primaryEmail + 1).setValue(update.email);
        }
        if (update.primaryPhone) {
          hmSheet.getRange(sheetRow, CONFIG.hmPersonCols.primaryPhone + 1).setValue(update.primaryPhone);
        }
        if (update.secondaryPhone) {
          hmSheet.getRange(sheetRow, CONFIG.hmPersonCols.secondaryPhone + 1).setValue(update.secondaryPhone);
        }
      }

      Logger.log(`✓ Backfilled ${emailsFilled} emails, ${primaryPhonesFilled} primary phones, ${secondaryPhonesFilled} secondary phones`);
    } else {
      Logger.log('No updates needed — all fields already populated');
    }

    return {
      emailsFilled: emailsFilled,
      primaryPhonesFilled: primaryPhonesFilled,
      secondaryPhonesFilled: secondaryPhonesFilled
    };

  } catch (e) {
    logError_('BACKFILL_CONTACT_INFO', 'PIPELINE_FAILED', 'backfillContactInfoForKeys_', e.toString());
    Logger.log(`Error in backfillContactInfoForKeys_: ${e.toString()}`);
    return { emailsFilled: 0, primaryPhonesFilled: 0, secondaryPhonesFilled: 0 };
  }
}
