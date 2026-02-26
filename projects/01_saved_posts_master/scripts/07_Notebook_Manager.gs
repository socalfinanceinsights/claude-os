/**
 * 07_NOTEBOOK_MANAGER.GS
 * Monthly NotebookLM Publisher
 *
 * Purpose: Export PostMasterList monthly archives to NotebookLM-ready Markdown
 *
 * Workflow:
 * 1. Runs monthly (1st of month via trigger)
 * 2. Queries PostMasterList for previous month
 * 3. Transforms to clean Markdown (no Summary_Thesis, cleaned Raw Text)
 * 4. Saves to Drive: _NotebookLM_Exports/YYYY-MM_Archive.md
 * 5. Emails user with file link
 *
 * Manual execution: runMonthlyExport(month, year)
 * Example: runMonthlyExport(0, 2026) // January 2026
 *
 * Dependencies:
 * - 00_Brain_Config.gs (TARGET_SPREADSHEET_ID, TARGET_SHEET_NAME, SUMMARY_RECIPIENT_EMAIL)
 * - mapHeaders(), nullSafe() helpers
 *
 * Created: 2026-02-11
 */

// ============================================================================
// TASK 1: EXPORT FOLDER MANAGEMENT
// ============================================================================

/**
 * Gets the NotebookLM export folder by ID.
 * @return {Folder} The export folder object
 */
function getNotebookExportFolder() {
  try {
    const folder = DriveApp.getFolderById(NOTEBOOKLM_EXPORT_FOLDER_ID);
    Logger.log(`✓ Using export folder: ${folder.getName()}`);
    return folder;
  } catch (e) {
    Logger.log(`✗ Error: Cannot access folder ID ${NOTEBOOKLM_EXPORT_FOLDER_ID}`);
    throw new Error(`Export folder not accessible: ${e.toString()}`);
  }
}

// ============================================================================
// TASK 2: MONTHLY DATA FILTER
// ============================================================================

/**
 * Retrieves all PostMasterList entries from a specific month.
 * @param {number} targetMonth - Month (0-11, JavaScript style)
 * @param {number} targetYear - Year (e.g., 2026)
 * @return {Array} Array of row data objects with row, colMap, headers
 */
function getMonthlyEntries(targetMonth, targetYear) {
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = mapHeaders(headers);

  if (colMap.PostDate === -1) {
    Logger.log('✗ Error: PostDate column not found');
    return [];
  }

  const monthlyRows = [];

  // Skip header row (start at index 1)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const postDateStr = String(row[colMap.PostDate]); // Format: "MM.dd.yyyy"

    // Parse MM.dd.yyyy format
    const parts = postDateStr.split('.');
    if (parts.length !== 3) continue;

    const rowMonth = parseInt(parts[0], 10) - 1; // Convert to 0-indexed
    const rowYear = parseInt(parts[2], 10);

    if (rowMonth === targetMonth && rowYear === targetYear) {
      monthlyRows.push({
        row: row,
        colMap: colMap,
        headers: headers
      });
    }
  }

  Logger.log(`✓ Found ${monthlyRows.length} entries for ${targetMonth + 1}/${targetYear}`);
  return monthlyRows;
}

// ============================================================================
// TASK 3: MARKDOWN TRANSFORMER (WITH ENHANCED CLEANING)
// ============================================================================

/**
 * Aggressively cleans Raw Text for NotebookLM ingestion.
 * Removes HTML artifacts, Reddit UI boilerplate, personal info, normalizes whitespace.
 *
 * @param {string} rawText - The Raw Text field from PostMasterList
 * @return {string} Clean, readable text
 */
function deepCleanRawText(rawText) {
  if (!rawText) return "";

  let text = String(rawText);

  // 1. Remove Reddit-specific boilerplate (most aggressive first)
  const redditBoilerplate = [
    // Navigation
    /jump to content/gi,
    /my subreddits/gi,
    /edit subscriptions/gi,
    /popular • -all • -users/gi,
    /limit my search to r\/\w+/gi,
    /use the following search parameters to narrow your results:/gi,
    /subreddit:subreddit find submissions in "subreddit"/gi,
    /author:username find submissions by "username"/gi,
    /site:example\.com find submissions from "example\.com"/gi,
    /url:text search for "text" in url/gi,
    /selftext:text search for "text" in self post contents/gi,
    /self:yes \(or self:no\) include \(or exclude\) self posts/gi,
    /nsfw:yes \(or nsfw:no\)/gi,
    /see the search faq for details/gi,
    /advanced search: by author, subreddit\.\.\./gi,

    // Submission UI
    /Submit a new link/gi,
    /Submit a new text post/gi,
    /Get an ad-free experience with special benefits/gi,
    /get reddit premium/gi,
    /Want to join\? Log in or sign up in seconds/gi,
    /Become a Redditor\s*and join one of thousands of communities/gi,
    /Welcome to Reddit,\s*the front page of the internet/gi,

    // Post metadata
    /this post was submitted on \d{2} \w+ \d{4}/gi,
    /\d+ points \(\d+% upvoted\)/gi,
    /shortlink: https:\/\/redd\.it\/\w+/gi,

    // Comment controls (appears 50+ times)
    /permalink • embed • save • report • reply/gi,
    /permalink • embed • save • parent • report • reply/gi,
    /sorted by: best topnewcontroversialoldrandomq&alive \(beta\)/gi,
    /Want to add to the discussion\?\s*Post a comment!\s*Create an account/gi,
    /all \d+ comments sorted by:/gi,
    /load more comments \(\d+ repl(?:y|ies)\)/gi,

    // Moderator/Admin
    /MODERATORS/gi,
    /message the mods/gi,
    /discussions in r\/\w+/gi,
    /a community for \d+ years?/gi,
    /ClaudeAI-mod-botMod\[M\]/gi,
    /\[score hidden\]/gi,
    /stickied comment/gi,

    // Sidebar clutter
    /<> X \d+/gi,
    /\d+ · \d+ comments/gi,

    // Footer
    /Use of this site constitutes acceptance of our User Agreement and Privacy Policy/gi,
    /© \d{4} reddit inc\. All rights reserved/gi,
    /REDDIT and the ALIEN Logo are registered trademarks/gi,
    /Rendered by PID \d+ on reddit-service/gi,
    /country code: [A-Z]{2}/gi,

    // Voting UI
    /\[\+\]/gi,
    /\[-\]/gi,
    /comment score below threshold/gi,

    // Misc Reddit UI
    /\[–\]/gi,
    /\[S\]/gi,  // OP indicator
    /\[🍰\]/gi, // Cake day
    /\[M\]/gi   // Moderator
  ];

  redditBoilerplate.forEach(pattern => {
    text = text.replace(pattern, " ");
  });

  // 2. Remove subreddit lists (long chains of subreddit names)
  text = text.replace(/(?:• -?\w+ ){10,}/g, " ");

  // 3. Remove comment threading artifacts
  text = text.replace(/\[–\]\w+ \d+ points?\d+ points?\d+ points?/gi, " ");

  // 4. CRITICAL: Remove personal contact info (phone numbers, emails)
  text = text.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[PHONE REDACTED]");
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[EMAIL REDACTED]");

  // 5. Decode HTML entities
  text = text.replace(/&nbsp;/gi, " ")
             .replace(/&amp;/gi, "&")
             .replace(/&lt;/gi, "<")
             .replace(/&gt;/gi, ">")
             .replace(/&quot;/gi, '"')
             .replace(/&#039;/gi, "'")
             .replace(/&apos;/gi, "'")
             .replace(/&mdash;/gi, "—")
             .replace(/&ndash;/gi, "–")
             .replace(/&hellip;/gi, "...");

  // 6. Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // 7. Remove generic boilerplate
  const genericBoilerplate = [
    /Skip to content/gi,
    /Sign in/gi,
    /Sign up/gi,
    /Share/gi,
    /Subscribe/gi,
    /Cookie Policy/gi,
    /Privacy Policy/gi,
    /Terms of Service/gi,
    /Loading\.\.\./gi
  ];

  genericBoilerplate.forEach(pattern => {
    text = text.replace(pattern, " ");
  });

  // 8. Fix smooshed words
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2");

  // 9. Normalize whitespace
  text = text.replace(/ {2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/([^\n])\n([^\n])/g, "$1 $2");

  // 10. Trim
  text = text.trim();

  // 11. Truncate if too long
  if (text.length > 50000) {
    text = text.substring(0, 50000) + "\n\n[Content truncated for length]";
  }

  return text;
}

/**
 * Transforms a PostMasterList row into semantic Markdown.
 * Optimized for NotebookLM ingestion.
 *
 * @param {Array} row - The row data array
 * @param {Object} colMap - Column map from mapHeaders()
 * @return {string} Markdown formatted entry
 */
function transformRowToMarkdown(row, colMap) {
  // 1. Safe Extraction (use nullSafe helper from Brain Config)
  const title = nullSafe(row[colMap.Title]) || "Untitled";
  const date = nullSafe(row[colMap.PostDate]) || "Unknown Date";
  const source = nullSafe(row[colMap.Source]) || "General";
  const url = nullSafe(row[colMap.URL]) || "";
  const tags = nullSafe(row[colMap.Tags]) || "";

  // Clean raw text aggressively (NO Summary_Thesis)
  const cleanedText = deepCleanRawText(row[colMap.RawText]);

  // 2. Semantic Markdown Construction
  let md = `## ${title}\n\n`;

  // Metadata block
  md += `* **Date:** ${date}\n`;
  md += `* **Source:** ${source}\n`;
  if (url) md += `* **URL:** ${url}\n`;
  if (tags) md += `* **Tags:** ${tags}\n`;
  md += `\n`;

  // 3. Content (cleaned Raw Text only)
  if (cleanedText && cleanedText.length > 10) {
    md += `### 📝 Content\n${cleanedText}\n`;
  }

  // 4. Section separator
  md += `\n---\n\n`;

  return md;
}

// ============================================================================
// TASK 4: MONTHLY MARKDOWN COMPILER
// ============================================================================

/**
 * Compiles monthly entries into a single Markdown document.
 * @param {Array} monthlyEntries - Array from getMonthlyEntries()
 * @param {string} monthName - Display name (e.g., "January 2026")
 * @return {string} Complete Markdown document
 */
function compileMonthlyMarkdown(monthlyEntries, monthName) {
  if (monthlyEntries.length === 0) {
    return `# 🧠 Brain Archive - ${monthName}\n\nNo entries found for this month.\n`;
  }

  // Document header
  let markdown = `# 🧠 Brain Archive - ${monthName}\n\n`;
  markdown += `**Source:** PostMasterList (Recruitment Engine)\n`;
  markdown += `**Entry Count:** ${monthlyEntries.length}\n`;
  markdown += `**Generated:** ${new Date().toLocaleDateString()}\n\n`;
  markdown += `---\n\n`;

  // Transform and append each entry
  monthlyEntries.forEach(entry => {
    const entryMarkdown = transformRowToMarkdown(entry.row, entry.colMap);
    markdown += entryMarkdown;
  });

  // Footer
  markdown += `\n---\n\n`;
  markdown += `*End of ${monthName} Archive*\n`;

  return markdown;
}

// ============================================================================
// TASK 5: SAVE MARKDOWN TO DRIVE
// ============================================================================

/**
 * Saves Markdown content to Drive export folder.
 * @param {string} markdownContent - The compiled Markdown
 * @param {number} month - Month (0-11)
 * @param {number} year - Year (e.g., 2026)
 * @return {string} URL of created file
 */
function saveMarkdownToDrive(markdownContent, month, year) {
  const folder = getNotebookExportFolder();

  // Format: 2026-01_Archive.md
  const monthStr = String(month + 1).padStart(2, '0');
  const fileName = `${year}-${monthStr}_Archive.md`;

  // Check if file already exists (allow re-runs)
  const existingFiles = folder.getFilesByName(fileName);
  if (existingFiles.hasNext()) {
    const existingFile = existingFiles.next();
    existingFile.setContent(markdownContent);
    Logger.log(`✓ Updated existing file: ${fileName}`);
    return existingFile.getUrl();
  }

  // Create new file
  const newFile = folder.createFile(fileName, markdownContent, MimeType.PLAIN_TEXT);
  Logger.log(`✓ Created new file: ${fileName}`);
  return newFile.getUrl();
}

// ============================================================================
// TASK 6: CALENDAR NOTIFICATION
// ============================================================================

/**
 * Creates a Google Calendar event as reminder to upload to NotebookLM.
 * @param {string} fileUrl - URL of exported Markdown file
 * @param {string} monthName - Display name (e.g., "January 2026")
 * @param {number} entryCount - Number of entries exported
 */
function createCalendarReminder(fileUrl, monthName, entryCount) {
  try {
    const calendar = CalendarApp.getDefaultCalendar();
    const eventDate = new Date();

    // Create 30-minute event starting now
    const startTime = eventDate;
    const endTime = new Date(eventDate.getTime() + 30 * 60000);

    const title = `📚 Upload NotebookLM Archive: ${monthName}`;
    const description = `Brain Archive ready for upload to NotebookLM.

**Stats:**
- ${entryCount} entries exported
- File: ${fileUrl}

**Upload Instructions:**
1. Go to https://notebooklm.google.com
2. Create new notebook or open existing
3. Click "Add sources" → Upload file
4. Download the Markdown file and upload it

**File Location:**
${fileUrl}`;

    const event = calendar.createEvent(title, startTime, endTime, {
      description: description
    });

    Logger.log(`✓ Calendar event created: ${event.getId()}`);
  } catch (e) {
    Logger.log(`✗ Failed to create calendar event: ${e.toString()}`);
  }
}

/**
 * DEPRECATED: Email notification (replaced with calendar event)
 * @param {string} fileUrl - URL of exported Markdown file
 * @param {string} monthName - Display name (e.g., "January 2026")
 * @param {number} entryCount - Number of entries exported
 * @param {Array} sampleTitles - First 3-5 titles for preview
 */
function sendExportNotification(fileUrl, monthName, entryCount, sampleTitles) {
  const subject = `📚 NotebookLM Export Ready: ${monthName}`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #202124 0%, #3c4043 100%); color: white; padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 22px;">🧠 Brain Archive Ready</h1>
        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">${monthName}</p>
      </div>

      <div style="padding: 24px;">
        <div style="background-color: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px; font-size: 14px; color: #70757a; text-transform: uppercase;">Export Summary</h3>
          <div style="font-size: 24px; font-weight: bold; color: #1a73e8;">${entryCount}</div>
          <div style="font-size: 12px; color: #666;">entries exported from PostMasterList</div>
        </div>

        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; color: #70757a; text-transform: uppercase; margin-bottom: 12px;">Sample Entries</h3>
          <ul style="padding-left: 20px; color: #3c4043; font-size: 13px; line-height: 1.8;">
            ${sampleTitles.slice(0, 5).map(title => `<li>${title}</li>`).join('')}
            ${entryCount > 5 ? `<li style="font-style: italic; color: #70757a;">... and ${entryCount - 5} more</li>` : ''}
          </ul>
        </div>

        <div style="background-color: #e6f4ea; padding: 16px; border-radius: 8px; border-left: 4px solid #34a853; margin-bottom: 20px;">
          <h3 style="margin: 0 0 8px; font-size: 14px; color: #137333;">Next Step: Upload to NotebookLM</h3>
          <ol style="margin: 0; padding-left: 20px; font-size: 13px; color: #137333; line-height: 1.6;">
            <li>Click the button below to open the Markdown file</li>
            <li>Download or copy the file</li>
            <li>Go to <a href="https://notebooklm.google.com" style="color: #1a73e8;">NotebookLM</a></li>
            <li>Create a new notebook or open existing one</li>
            <li>Click "Add sources" → Upload the Markdown file</li>
          </ol>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <a href="${fileUrl}" style="display: inline-block; padding: 12px 24px; background-color: #1a73e8; color: white; text-decoration: none; border-radius: 4px; font-weight: 500;">
            Open Markdown File
          </a>
        </div>
      </div>

      <div style="background-color: #f8f9fa; padding: 16px; text-align: center; font-size: 11px; color: #9aa0a6;">
        Automated monthly export from Recruitment Engine • ${new Date().toLocaleDateString()}
      </div>
    </div>
  `;

  try {
    GmailApp.sendEmail(
      SUMMARY_RECIPIENT_EMAIL,
      subject,
      "Please enable HTML to view this email.",
      { htmlBody: htmlBody, name: "Brain Automation Agent" }
    );
    Logger.log(`✓ Email sent to ${SUMMARY_RECIPIENT_EMAIL}`);
  } catch (e) {
    Logger.log(`✗ Failed to send email: ${e.toString()}`);
  }
}

// ============================================================================
// TASK 7: MAIN ORCHESTRATION FUNCTION
// ============================================================================

/**
 * MAIN FUNCTION: Monthly NotebookLM Export
 *
 * Runs on 1st of month to export previous month's PostMasterList to Markdown.
 * Saves to Drive and emails user with upload instructions.
 *
 * Can be run manually with custom month/year for testing or backfills.
 *
 * @param {number} customMonth - Optional: Override month (0-11)
 * @param {number} customYear - Optional: Override year
 * @return {Object} Summary object with stats
 */
function runMonthlyExport(customMonth, customYear) {
  const startTime = new Date();
  Logger.log("=== STARTING MONTHLY NOTEBOOKLM EXPORT ===");

  try {
    // 1. Calculate target month (default: previous month)
    let targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() - 1); // Go back 1 month

    const targetMonth = customMonth !== undefined ? customMonth : targetDate.getMonth();
    const targetYear = customYear !== undefined ? customYear : targetDate.getFullYear();

    const monthName = new Date(targetYear, targetMonth, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });

    Logger.log(`Target: ${monthName} (${targetMonth}/${targetYear})`);

    // 2. Retrieve monthly data
    const monthlyEntries = getMonthlyEntries(targetMonth, targetYear);

    if (monthlyEntries.length === 0) {
      Logger.log("⚠️ No entries found for target month. Skipping export.");
      return { success: true, entryCount: 0, monthName: monthName, skipped: true };
    }

    // 3. Compile Markdown
    const markdown = compileMonthlyMarkdown(monthlyEntries, monthName);
    Logger.log(`Compiled Markdown: ${markdown.length} characters`);

    // 4. Save to Drive
    const fileUrl = saveMarkdownToDrive(markdown, targetMonth, targetYear);

    // 5. Create calendar reminder
    createCalendarReminder(fileUrl, monthName, monthlyEntries.length);

    // 6. Success summary
    const duration = ((new Date() - startTime) / 1000).toFixed(1);
    Logger.log(`✅ Export complete in ${duration}s: ${monthlyEntries.length} entries → ${fileUrl}`);

    return {
      success: true,
      monthName: monthName,
      entryCount: monthlyEntries.length,
      fileUrl: fileUrl,
      duration: duration
    };

  } catch (e) {
    Logger.log(`✗ Export failed: ${e.toString()}`);
    logErrorToSheet('MONTHLY_EXPORT', 'EXPORT_ERROR', e.toString(), `Target: ${monthName || 'Unknown'}`);
    throw e;
  }
}
