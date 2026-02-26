/**
 * DAILY READER - Automated Content Digests
 * 
 * This script scans the PostMasterList for entries processed "Today"
 * and sends a "Daily Reader" newsletter with summaries and links.
 */

/**
 * Main function to generate and send the Daily Reader digest.
 */
function generateDailySummary() {
  Logger.log("--- GENERATING DAILY READER ---");
  
  if (SUMMARY_RECIPIENT_EMAIL === 'YOUR_EMAIL_HERE') {
    Logger.log("Error: Recipient email not configured in 00_Brain_Config.gs");
    return;
  }

  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const targetDateStr = getYesterdayFormatted();
  
  // 1. Gather Content
  const digestItems = getEntriesProcessedToday(ss.getSheetByName(TARGET_SHEET_NAME), targetDateStr);
  
  // 2. Gather Stats (Tools & Prompts)
  const libStats = {
    tools: getWorkCountByDate(ss.getSheetByName('ToolLibrary'), targetDateStr),
    prompts: getWorkCountByDate(ss.getSheetByName('PromptLibrary'), targetDateStr)
  };

  // 2b. Get Error Details from both error logs
  const mainErrors = getErrorsFromToday(ss.getSheetByName('ErrorLog'), targetDateStr);

  // Also check Link Inbox ErrorLog
  let linkErrors = [];
  try {
    const ssInbox = SpreadsheetApp.openById(LINK_INBOX_SPREADSHEET_ID);
    linkErrors = getLinkInboxErrors(ssInbox.getSheetByName(LINK_ERROR_SHEET_NAME), targetDateStr);
  } catch (e) {
    Logger.log(`Could not fetch Link Inbox errors: ${e.toString()}`);
  }

  const errorDetails = mainErrors.concat(linkErrors);

  // 3. Check Backlog Status
  const backlogStatus = getBacklogStatus();

  Logger.log(`Today's Content: ${digestItems.length} items. Stats: Tools=${libStats.tools}, Prompts=${libStats.prompts}, Errors=${errorDetails.length}`);
  Logger.log(`Backlog Status: Email=${backlogStatus.email}, Drive=${backlogStatus.drive}, Links=${backlogStatus.links}`);

  // 4. Build HTML Body
  const htmlBody = buildReaderHtml(digestItems, libStats, backlogStatus, errorDetails, targetDateStr);
  
  // 5. Send Email
  sendSummaryEmail(htmlBody, targetDateStr);

  Logger.log("--- DAILY READER SENT ---");
}

/**
 * Checks backlog status across all ingestion sources.
 * Returns counts of pending items.
 */
function getBacklogStatus() {
  const status = {
    email: 0,
    drive: 0,
    links: 0,
    timestamp: new Date()
  };

  // Check Email backlog
  try {
    const threads = GmailApp.search('label:_INBOX_READING -label:_INBOX_READING/_PROCESSED');
    status.email = threads.length;
  } catch (e) {
    Logger.log(`Error checking email backlog: ${e.toString()}`);
  }

  // Check Spreadsheet Inbox backlog
  try {
    const ssInbox = SpreadsheetApp.openById(LINK_INBOX_SPREADSHEET_ID);
    const inboxSheet = ssInbox.getSheetByName(LINK_INBOX_SHEET_NAME);
    if (inboxSheet) {
      const lastRow = inboxSheet.getLastRow();
      status.links = lastRow > 1 ? lastRow - 1 : 0; // Exclude header row
    }
  } catch (e) {
    Logger.log(`Error checking spreadsheet inbox backlog: ${e.toString()}`);
  }

  // Check Drive Files backlog
  try {
    const folder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
    const files = folder.getFiles();
    let count = 0;
    while (files.hasNext()) {
      files.next();
      count++;
    }
    status.drive = count;
  } catch (e) {
    Logger.log(`Error checking drive backlog: ${e.toString()}`);
  }

  return status;
}

/**
 * Fetches full entries for items processed today.
 */
function getEntriesProcessedToday(sheet, targetDateStr) {
  if (!sheet) return [];
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {
    processedDate: headers.indexOf('ProcessedDate'),
    title: headers.indexOf('Title'),
    summary: headers.indexOf('Summary_Thesis'),
    url: headers.indexOf('URL'),
    source: headers.indexOf('Source')
  };
  
  if (col.processedDate === -1) return [];
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const items = [];
  
  for (let i = 0; i < data.length; i++) {
    const cellValue = data[i][col.processedDate];
    let cellDateStr = "";

    // Handle both Date objects and Strings
    if (cellValue instanceof Date) {
      cellDateStr = Utilities.formatDate(cellValue, Session.getScriptTimeZone(), "MM.dd.yyyy");
    } else {
      cellDateStr = String(cellValue); // Fallback for raw strings
    }

    // Strict comparison
    if (cellDateStr === targetDateStr) {
      items.push({
        title: data[i][col.title] || "Untitled Post",
        summary: data[i][col.summary] || "No summary available.",
        url: data[i][col.url] || "#",
        source: data[i][col.source] || "Unknown"
      });
    }
  }
  return items;
}

/**
 * Fetches error entries from today with full details.
 * Expected ErrorLog columns: DateLog | SourceID | ErrorCode | SourceTitle | ErrorDefinition | Resolved? | ErrorDescription
 */
function getErrorsFromToday(sheet, todayStr) {
  if (!sheet) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {
    dateLog: headers.indexOf('DateLog'),
    sourceID: headers.indexOf('SourceID'),
    errorCode: headers.indexOf('ErrorCode'),
    sourceTitle: headers.indexOf('SourceTitle'),
    errorDefinition: headers.indexOf('ErrorDefinition')
  };

  if (col.dateLog === -1) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const errors = [];

  for (let i = 0; i < data.length; i++) {
    const cellValue = data[i][col.dateLog];
    let cellDateStr = "";

    // Handle both Date objects and Strings
    if (cellValue instanceof Date) {
      cellDateStr = Utilities.formatDate(cellValue, Session.getScriptTimeZone(), "MM.dd.yyyy");
    } else {
      cellDateStr = String(cellValue);
    }

    // Match today's date
    if (cellDateStr === todayStr) {
      errors.push({
        timestamp: cellValue instanceof Date ? Utilities.formatDate(cellValue, Session.getScriptTimeZone(), "HH:mm") : "Unknown",
        sourceID: data[i][col.sourceID] || "Unknown",
        errorType: data[i][col.errorCode] || "ERROR",
        context: data[i][col.sourceTitle] || "",
        message: data[i][col.errorDefinition] || "No details available"
      });
    }
  }

  return errors;
}

/**
 * Fetches error entries from Link Inbox ErrorLog.
 * Expected columns: URL | Notes | Status | Timestamp | Error
 */
function getLinkInboxErrors(sheet, todayStr) {
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Link Inbox ErrorLog has no headers, structure: URL | Notes | Status | Timestamp | Error
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const errors = [];

  for (let i = 0; i < data.length; i++) {
    const timestamp = data[i][3]; // Column 4 (index 3)
    let cellDateStr = "";

    // Handle both Date objects and Strings
    if (timestamp instanceof Date) {
      cellDateStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "MM.dd.yyyy");
    } else {
      cellDateStr = String(timestamp);
    }

    // Match today's date
    if (cellDateStr === todayStr) {
      errors.push({
        timestamp: timestamp instanceof Date ? Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "HH:mm") : "Unknown",
        sourceID: data[i][0] || "Unknown URL", // URL
        errorType: "LINK_INBOX_ERROR",
        context: data[i][1] || "", // Notes
        message: data[i][4] || "No details available" // Error message
      });
    }
  }

  return errors;
}

/**
 * Helper to count rows where the LAST column is a Date object matching the target date.
 */
function getWorkCountByDate(sheet, targetDateStr) {
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(2, lastCol, lastRow - 1, 1).getValues();
  
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const val = data[i][0];
    if (val instanceof Date) {
      if (Utilities.formatDate(val, Session.getScriptTimeZone(), "MM.dd.yyyy") === targetDateStr) count++;
    }
  }
  return count;
}

/**
 * Constructs the "Daily Reader" HTML email.
 */
function buildReaderHtml(items, stats, backlogStatus, errorDetails, date) {
  let digestHtml = "";
  
  const totalCount = items.length;
  const displayItems = items.slice(0, 10); // Show only top 10 to prevent email size limits
  const isTruncated = totalCount > 10;

  if (totalCount === 0) {
    digestHtml = `<p style="color: #666; font-style: italic; text-align: center; padding: 20px;">No new content was ingested today.</p>`;
  } else {
    displayItems.forEach(item => {
      // Format summary - extract key sections for email display
      let formattedSummary = item.summary || "No summary available.";

      // Extract only CORE STRATEGY, 5 REASONS WHY, and NEXT STEP sections
      const sections = [];

      // Look for each desired section
      const coreStrategyMatch = formattedSummary.match(/🚀 CORE STRATEGY:([^🔧🚀💡✅]+)/u);
      const reasonsMatch = formattedSummary.match(/💡 5 REASONS WHY:([^🔧🚀💡✅]+)/u);
      const nextStepMatch = formattedSummary.match(/✅ NEXT STEP:([^🔧🚀💡✅]+)/u);

      if (coreStrategyMatch) sections.push(`<strong>CORE STRATEGY:</strong> ${coreStrategyMatch[1].trim()}`);
      if (reasonsMatch) sections.push(`<strong>5 REASONS WHY:</strong> ${reasonsMatch[1].trim()}`);
      if (nextStepMatch) sections.push(`<strong>NEXT STEP:</strong> ${nextStepMatch[1].trim()}`);

      if (sections.length > 0) {
        // Format as bullet list
        formattedSummary = '<ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #3c4043; line-height: 1.6;">' +
                           sections.map(s => `<li style="margin-bottom: 6px;">${s}</li>`).join('') +
                           '</ul>';
      } else if (formattedSummary.includes('•')) {
        // Legacy bullet point format
        const points = formattedSummary.split('•').map(p => p.trim()).filter(p => p.length > 0);
        formattedSummary = '<ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #3c4043; line-height: 1.6;">' +
                           points.map(p => `<li style="margin-bottom: 6px;">${p}</li>`).join('') +
                           '</ul>';
      } else {
        // Plain text fallback
        formattedSummary = `<p style="margin: 0 0 12px; font-size: 13px; line-height: 1.6; color: #3c4043;">${formattedSummary}</p>`;
      }

      const hasUrl = item.url && item.url !== "#" && String(item.url).toLowerCase() !== "null";

      digestHtml += `
        <div style="margin-bottom: 24px; padding: 16px; border-left: 4px solid #1a73e8; background-color: #f8f9fa;">
          <h2 style="margin: 0 0 8px; font-size: 17px; color: #202124; line-height: 1.3;">${item.title}</h2>
          <div style="font-size: 11px; color: #1a73e8; margin-bottom: 12px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Source: ${item.source}</div>
          <div style="margin-bottom: 16px;">${formattedSummary}</div>
          ${hasUrl ? `<a href="${item.url}" style="font-size: 13px; color: #1a73e8; text-decoration: none; font-weight: 500;">Read Original &rarr;</a>` : ''}
        </div>
      `;
    });

    if (isTruncated) {
      digestHtml += `
        <div style="text-align: center; padding: 10px; color: #70757a; font-size: 13px; font-style: italic;">
          ... and ${totalCount - 10} more items. View the full list in the sheet below.
        </div>
      `;
    }
  }

  return `
    <div style="font-family: 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #202124 0%, #3c4043 100%); color: white; padding: 32px 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 26px; letter-spacing: -0.5px;">Executive Intelligence Briefing</h1>
        <p style="margin: 8px 0 0; opacity: 0.8; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Strategic Content Digest • ${totalCount} Items • ${date}</p>
      </div>
      
      <div style="padding: 24px;">
        <div style="margin-bottom: 32px;">
          <h3 style="font-size: 14px; color: #70757a; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 16px;">New Content</h3>
          ${digestHtml}
        </div>
        
        <div style="background-color: #fff; border: 1px solid #eee; border-radius: 8px; padding: 20px;">
          <h3 style="font-size: 14px; color: #70757a; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 0; margin-bottom: 16px;">Library Growth</h3>
          <div style="display: flex; gap: 20px;">
            <div style="flex: 1; text-align: center; border-right: 1px solid #eee;">
              <div style="font-size: 24px; font-weight: bold; color: #34a853;">${stats.tools}</div>
              <div style="font-size: 11px; color: #666;">TOOLS</div>
            </div>
            <div style="flex: 1; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #fbbc04;">${stats.prompts}</div>
              <div style="font-size: 11px; color: #666;">PROMPTS</div>
            </div>
          </div>
        </div>

        <div style="background-color: #fff; border: 1px solid #eee; border-radius: 8px; padding: 20px; margin-top: 20px;">
          <h3 style="font-size: 14px; color: #70757a; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 0; margin-bottom: 16px;">Processing Status</h3>
          ${backlogStatus.email === 0 && backlogStatus.drive === 0 && backlogStatus.links === 0 ? `
            <div style="text-align: center; padding: 12px; background-color: #e6f4ea; border-radius: 4px; color: #137333;">
              <strong>✅ All Files Processed</strong>
              <div style="font-size: 12px; margin-top: 4px;">as of ${Utilities.formatDate(backlogStatus.timestamp, Session.getScriptTimeZone(), "MM.dd.yyyy 'at' HH:mm")}</div>
            </div>
          ` : `
            <div style="padding: 12px; background-color: #fef7e0; border-radius: 4px; color: #b06000;">
              <strong>⏳ Backlog Detected</strong>
              <div style="font-size: 13px; margin-top: 8px; line-height: 1.6;">
                ${backlogStatus.email > 0 ? `• <strong>Email Inbox:</strong> ${backlogStatus.email} unprocessed thread(s)<br>` : ''}
                ${backlogStatus.links > 0 ? `• <strong>Link Inbox:</strong> ${backlogStatus.links} unprocessed URL(s)<br>` : ''}
                ${backlogStatus.drive > 0 ? `• <strong>Drive Folder:</strong> ${backlogStatus.drive} unprocessed file(s)<br>` : ''}
              </div>
            </div>
          `}
        </div>

        ${errorDetails.length > 0 ? `
          <div style="margin-top: 24px; padding: 16px; background-color: #fce8e6; border: 1px solid #f5c2c2; border-radius: 8px;">
            <h3 style="font-size: 14px; color: #d93025; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 0; margin-bottom: 12px;">
              ⚠️ Processing Errors (${errorDetails.length})
            </h3>
            ${errorDetails.slice(0, 5).map(err => `
              <div style="margin-bottom: 12px; padding: 10px; background-color: #fff; border-left: 3px solid #d93025; font-size: 12px; line-height: 1.6;">
                <div style="color: #d93025; font-weight: bold; margin-bottom: 4px;">${err.errorType} at ${err.timestamp}</div>
                <div style="color: #666; margin-bottom: 2px;"><strong>Source:</strong> ${err.sourceID}</div>
                ${err.context ? `<div style="color: #666; margin-bottom: 2px;"><strong>Context:</strong> ${err.context}</div>` : ''}
                <div style="color: #444; margin-top: 6px;">${err.message}</div>
              </div>
            `).join('')}
            ${errorDetails.length > 5 ? `
              <div style="text-align: center; margin-top: 8px; color: #d93025; font-size: 11px; font-style: italic;">
                ... and ${errorDetails.length - 5} more errors in ErrorLog sheet
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div style="margin-top: 32px; text-align: center;">
          <a href="https://docs.google.com/spreadsheets/d/${TARGET_SPREADSHEET_ID}" style="display: inline-block; padding: 10px 20px; background-color: #1a73e8; color: white; text-decoration: none; border-radius: 4px; font-weight: 500; font-size: 14px;">View Full Master List</a>
        </div>
      </div>
      
      <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 11px; color: #9aa0a6; border-top: 1px solid #eee;">
        Sent via Universal Brain Automation Suite • Stay automated, stay human.
      </div>
    </div>
  `;
}

/**
 * Sends the formatted email using GmailApp.
 */
function sendSummaryEmail(htmlBody, date) {
  try {
    GmailApp.sendEmail(SUMMARY_RECIPIENT_EMAIL, `Daily Reader: ${date}`, "Please enable HTML to view your digest.", {
      htmlBody: htmlBody,
      name: "Brain Automation Agent"
    });
  } catch (e) {
    Logger.log("Failed to send Daily Reader email: " + e.toString());
  }
}
