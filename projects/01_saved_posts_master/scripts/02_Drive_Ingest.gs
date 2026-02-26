/**
 * DRIVE INGEST - Process Google Drive files and extract content to Sheet
 * Model: Gemini 3 Flash Preview
 * 
 * This script processes files from a Google Drive folder and extracts:
 * - Text from Docs, PDFs, and HTML files
 * - Metadata via Gemini AI analysis
 * - Smart deduplication by URL
 */

// ============================================================================
// DRIVE-SPECIFIC CONFIGURATION
// Note: This script inherits TARGET_SPREADSHEET_ID, TARGET_SHEET_NAME, 
// PROCESSED_FOLDER_NAME, and ERROR_FOLDER_NAME from 00_Brain_Config.gs.
// ============================================================================


const SOURCE_FOLDER_ID = '1N4LoPRyCP0AJBWvCir-aGDILk9nOOZMv';
const DRIVE_GEMINI_MODEL = 'gemini-3-flash-preview';

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main function to ingest files from Drive folder to Sheet.
 * Processes files until empty or time limit reached (Greedy Worker).
 */
function ingestDriveFolder(startTime) {
  if (!startTime) startTime = new Date();

  // First, process any spreadsheet-based bookmarks
  Logger.log("--- STARTING SPREADSHEET INBOX CHECK ---");
  try {
    ingestSpreadsheetInbox(startTime);
  } catch (e) {
    Logger.log("Spreadsheet ingestion skipped/failed: " + e.toString());
  }
  Logger.log("--- PROCEEDING TO DRIVE FOLDER INGESTION ---");

  const folder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
  const processedFolder = getOrCreateFolder(folder, PROCESSED_FOLDER_NAME);
  const errorFolder = getOrCreateFolder(folder, ERROR_FOLDER_NAME);
  
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
  
  if (!sheet) {
    Logger.log("Target sheet not found: " + TARGET_SHEET_NAME);
    return;
  }

  // Map headers
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap = mapHeaders(headers);
  
  if (colMap.URL === -1 || colMap.RawText === -1) {
    Logger.log("Critical columns (URL or Raw Text) not found in headers.");
  }

  // Load existing URLs for deduplication
  const existingUrls = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1 && colMap.URL !== -1) {
    const urlData = sheet.getRange(2, colMap.URL + 1, lastRow - 1, 1).getValues();
    urlData.forEach(r => existingUrls.add(String(r[0]).trim()));
  }

  // Iterate files
  const files = folder.getFiles();
  let count = 0;
  let errorCount = 0;

  while (files.hasNext() && !isTimeRunningOut(startTime)) {
    const file = files.next();
    const fileName = file.getName();

    // Skip folder markers
    if (fileName === PROCESSED_FOLDER_NAME || fileName === ERROR_FOLDER_NAME) continue;
    
    // Check file type
    const mimeType = file.getMimeType();
    const isDoc = mimeType === MimeType.GOOGLE_DOCS;
    const isPdf = mimeType === MimeType.PDF;
    const isWord = mimeType === MimeType.MICROSOFT_WORD || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isHtml = mimeType === MimeType.HTML || fileName.toLowerCase().endsWith('.html');
    
    if (!isDoc && !isPdf && !isHtml && !isWord) {
      Logger.log(`Skipping unsupported type: ${mimeType} - ${fileName}`);
      continue;
    }

    try {
      // Pre-deduplication: Skip if Drive URL already exists
      if (existingUrls.has(file.getUrl())) {
        Logger.log(`Skipping Duplicate (Drive URL exists): ${fileName}`);
        continue;
      }

      count++;
      Logger.log(`Processing file ${count}: ${fileName}`);
      
      // Gemini analysis
      const analysis = analyzeFileWithGemini(file, isDoc, isHtml, mimeType);
      
      if (!analysis) {
        throw new Error("Gemini analysis failed or returned empty.");
      }
      
      // Post-analysis deduplication: Check extracted URL
      const finalUrl = analysis.original_url || file.getUrl();
      if (existingUrls.has(finalUrl)) {
        Logger.log(`Skipping Duplicate (Found URL in content): ${finalUrl}`);
        file.moveTo(processedFolder);
        continue;
      }

      // YouTube Enrichment Fallback: If Gemini identifies it as YouTube, get transcript
      if (normalizeSource(analysis.source) === "YouTube" && analysis.original_url) {
        const videoId = extractYouTubeVideoId(analysis.original_url);
        if (videoId) {
          Logger.log(`   → YouTube detected in Drive file. Fetching transcript for: ${videoId}`);
          const transcript = getYoutubeTranscript(videoId);
          if (transcript) {
            analysis.raw_text = `[TRANSCRIPT EXTRACTED FROM LINK]\n\n${transcript}\n\n[ORIGINAL FILE CONTENT]\n\n${analysis.raw_text}`;
            Logger.log(`   ✓ Transcript added to raw_text`);
          } else {
            Logger.log(`   ! Transcript could not be fetched for ${videoId}`);
          }
        }
      }

      // Build row data
      const sourceID = generateSourceID('DRIVE');
      
      // Date normalization
      let postDate = normalizeDate(analysis.post_date); // No longer defaulting to file creation date
      
      const rowData = new Array(headers.length).fill("");
      
      if (colMap.SourceID !== -1) rowData[colMap.SourceID] = sourceID;
      if (colMap.PostDate !== -1) rowData[colMap.PostDate] = postDate;
      if (colMap.Source !== -1) {
        rowData[colMap.Source] = normalizeSource(nullSafe(analysis.source));
      }
      
      // Title: Use extracted title, fallback to filename
      if (colMap.Title !== -1) {
        rowData[colMap.Title] = analysis.title || fileName;
      }
      
      // Author
      if (colMap.Author !== -1) rowData[colMap.Author] = analysis.author || "";

      // URL Logic: HTML uses extracted URL, Docs/PDFs use Drive link
      if (colMap.URL !== -1) {
        if (isHtml && analysis.original_url) {
          rowData[colMap.URL] = analysis.original_url;
        } else {
          rowData[colMap.URL] = file.getUrl();
        }
      }
      
      // Tags and Summary
      if (colMap.Summary !== -1) rowData[colMap.Summary] = analysis.summary || "";
      
      // Raw Text - flatten to single line
      if (colMap.RawText !== -1) {
        let text = analysis.raw_text || "";
        text = text.replace(/[\r\n]+/g, " ").replace(/\s\s+/g, " ").trim();
        rowData[colMap.RawText] = text;
      }
      
      // Append row
      sheet.appendRow(serializeRowData(rowData));
      
      // Success cleanup
      file.moveTo(processedFolder);
      
    } catch (e) {
      errorCount++;
      Logger.log(`ERROR on ${fileName}: ${e.toString()}`);
      try {
        file.moveTo(errorFolder);
      } catch (moveErr) {
        Logger.log("Failed to move failed file: " + moveErr.toString());
      }
    }
  }

  // Check if more files remain
  const hasMoreFiles = files.hasNext();
  setBacklogStatus('DRIVE', hasMoreFiles);

  // Final notification
  if (errorCount > 0) {
    try {
      SpreadsheetApp.getUi().alert(`Drive Ingest Complete. ${errorCount} file(s) failed. Check '_Errors' folder.`);
    } catch(e) { /* UI might not be available if run on timer */ }
  } else if (count > 0) {
    Logger.log(`Drive Ingest complete. Processed ${count} files. More pending: ${hasMoreFiles}`);
  } else {
    Logger.log("No files to process.");
  }
}

// ============================================================================
// GEMINI API INTEGRATION
// ============================================================================

/**
 * Analyzes file content using Gemini AI.
 * Handles Docs (text extraction), HTML (cleaned text), and PDFs (binary).
 */
function analyzeFileWithGemini(file, isDoc, isHtml, mimeType) {
  const API_KEY = getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DRIVE_GEMINI_MODEL}:generateContent?key=${API_KEY}`;
  
  let parts = [];
  
  // Prepare content part
  if (isDoc) {
    // Extract text from Google Doc
    const textContent = DocumentApp.openById(file.getId()).getBody().getText();
    parts.push({ text: `Analyze this text content:\n\n${textContent}` });
  } else if (isHtml) {
    // RECOVERY RAIL: If HTML is >10MB (SingleFile bloat), slice the first 2MB
    // 2MB of HTML easily contains the main post content and metadata.
    let rawHtml = "";
    if (file.getSize() > 10 * 1024 * 1024) {
      Logger.log(`   ! Large HTML (${Math.round(file.getSize()/1024/1024)}MB). Slicing first 2MB to capture main content...`);
      // Use Drive API via UrlFetchApp with a Range header for partial download
      const fileId = file.getId();
      const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const options = {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=0-2097151' },
        muteHttpExceptions: true
      };
      const response = UrlFetchApp.fetch(driveUrl, options);
      if (response.getResponseCode() === 206 || response.getResponseCode() === 200) {
        rawHtml = response.getContentText();
      } else {
        throw new Error(`Failed to slice large file (HTTP ${response.getResponseCode()}): ${response.getContentText()}`);
      }
    } else {
      rawHtml = file.getBlob().getDataAsString();
    }
    let cleanText = cleanHtml(rawHtml);

    // Apply GitHub-specific cleaning if content is from GitHub
    if (rawHtml.toLowerCase().includes('github.com')) {
      cleanText = cleanGitHubContent(cleanText);
      Logger.log(`   → Applied GitHub boilerplate stripping`);
    }

    parts.push({ text: `Analyze this text content (extracted from HTML):\n\n${cleanText}` });
  } else {
    // For PDF and Word DOCX, send binary data (Max 20MB)
    const normalizedMimeType = (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === MimeType.MICROSOFT_WORD) 
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
      : mimeType;

    if (file.getSize() > 20 * 1024 * 1024) {
      throw new Error(`File size (${Math.round(file.getSize()/1024/1024)}MB) exceeds 20MB limit.`);
    }
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    const base64Data = Utilities.base64Encode(bytes);
    parts.push({ 
      inlineData: {
        mime_type: normalizedMimeType,
        data: base64Data
      }
    });
  }

  // Get platform from file metadata or default to "Website"
  const platform = "Website";
  const urlHint = file.getUrl();

  // System prompt (centralized via Million Dollar Prompt)
  const systemPrompt = getMillionDollarPrompt(platform, urlHint);
  
  parts.unshift({ text: systemPrompt });

  const payload = {
    contents: [{ role: "user", parts: parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: getGeminiResponseSchema()
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    timeout: 300000 // 5 minutes - allows time for heavy file analysis
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.error) {
      Logger.log("Gemini API Error: " + json.error.message);
      throw new Error(json.error.message);
    }

    if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) {
      const textVal = json.candidates[0].content.parts[0].text;
      return JSON.parse(textVal);
    }
    
    return null;

  } catch (e) {
    Logger.log("API Request Failed: " + e.toString());
    throw e;
  }
}

/**
 * Maps Link Inbox sheet headers to column indices.
 * Expected columns: URL | Notes/Title | Manual Date
 */
function mapInboxHeaders(headers) {
  const map = { URL: -1, Notes: -1, ManualDate: -1 };
  headers.forEach((h, idx) => {
    const header = String(h).trim().toLowerCase();
    if (header === 'url') map.URL = idx;
    if (header.includes('notes') || header.includes('title')) map.Notes = idx;
    // Match "DatePosted", "Date Posted", "date", but NOT "DateProcessed" or "Date Processed"
    if ((header.includes('date') && header.includes('post')) || (header === 'date')) {
      map.ManualDate = idx;
    }
  });
  return map;
}

/**
 * Ingests links from the Desktop_Link_Inbox spreadsheet.
 * Successes go to PostMasterList and 'Processed' tab.
 * Failures go to 'ErrorLog' tab.
 * Processes until empty or time limit reached (Greedy Worker).
 */
function ingestSpreadsheetInbox(startTime) {
  if (!startTime) startTime = new Date();
  const ssInbox = SpreadsheetApp.openById(LINK_INBOX_SPREADSHEET_ID);
  const inboxSheet = ssInbox.getSheetByName(LINK_INBOX_SHEET_NAME);
  const processedSheet = ssInbox.getSheetByName(LINK_PROCESSED_SHEET_NAME);
  const errorSheet = ssInbox.getSheetByName(LINK_ERROR_SHEET_NAME);

  if (!inboxSheet) {
    Logger.log(`Inbox sheet '${LINK_INBOX_SHEET_NAME}' not found.`);
    return;
  }

  const data = inboxSheet.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log("Inbox is empty.");
    return;
  }

  // Map Link Inbox headers dynamically
  const inboxHeaders = data[0];
  const inboxColMap = mapInboxHeaders(inboxHeaders);

  const ssTarget = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const sheetTarget = ssTarget.getSheetByName(TARGET_SHEET_NAME);
  const headersTarget = sheetTarget.getRange(1, 1, 1, sheetTarget.getLastColumn()).getValues()[0];
  const colMap = mapHeaders(headersTarget);

  const rowsToDelete = [];
  let videosProcessed = 0; // Track videos processed in this run

  for (let i = 1; i < data.length && !isTimeRunningOut(startTime); i++) {
    const row = data[i];
    const url = inboxColMap.URL !== -1 ? row[inboxColMap.URL] : row[0];
    const notes = inboxColMap.Notes !== -1 ? row[inboxColMap.Notes] : row[1];
    const manualDate = inboxColMap.ManualDate !== -1 ? row[inboxColMap.ManualDate] : null;
    if (!url) continue;

    Logger.log(`Processing Inbox Link: ${url}`);
    try {
      let enrichedContent = notes || "";
      let sourceHint = "Webpage";
      let titleGuess = notes || "";
      let authorGuess = "";

      // 1. Content Enrichment
      const videoId = extractYouTubeVideoId(url);
      let ytTranscript = null;
      if (videoId) {
        // Video Batch Limit Check: Stop after processing MAX_VIDEOS_PER_RUN videos
        if (videosProcessed >= MAX_VIDEOS_PER_RUN) {
          Logger.log(`   ! VIDEO BATCH LIMIT REACHED: Processed ${videosProcessed} videos. Stopping.`);
          break; // Exit loop, remaining videos will be processed in next run
        }

        Logger.log(`   ✓ YouTube detected in spreadsheet: ${videoId}`);
        sourceHint = "YouTube";
        videosProcessed++; // Increment counter when starting video processing

        // Fetch metadata (fast operation)
        const meta = fetchYouTubeMetadata(url);
        if (meta) {
          titleGuess = meta.title;
          authorGuess = meta.author;
        }

        // Fetch transcript (potentially long operation - wrapped for better error reporting)
        try {
          ytTranscript = getYoutubeTranscript(videoId);
          if (ytTranscript) {
            Logger.log(`   ✓ Transcript fetched (${ytTranscript.length} characters)`);
          } else {
            Logger.log(`   ! Transcript fetch failed for ${videoId}`);
          }
        } catch (transcriptError) {
          // Transcript fetch failed - could be timeout, API error, or invalid video
          Logger.log(`   ! Transcript fetch error for ${videoId}: ${transcriptError.toString()}`);
          throw new Error(`Video transcript failed (likely timeout >6 min): ${transcriptError.toString()}`);
        }

        enrichedContent = `TITLE: ${titleGuess}\nAUTHOR: ${authorGuess}\n\nTRANSCRIPT FOUND: ${ytTranscript ? "YES" : "NO"}\n\nNOTES: ${notes}`;
      } else {
        const webContent = fetchWebContent(url);
        if (webContent) {
          enrichedContent = webContent;
          // Apply GitHub-specific cleaning if URL is from GitHub
          if (url.toLowerCase().includes('github.com')) {
            enrichedContent = cleanGitHubContent(enrichedContent);
            Logger.log(`   → Applied GitHub boilerplate stripping`);
          }
        }
      }

      // 2. Gemini Analysis (Metadata only extraction)
      const analysis = analyzeRawTextWithGemini(enrichedContent, url, sourceHint);
      
      if (!analysis) throw new Error("Gemini analysis failed.");

      // 3. Build PostMasterList Row
      const sourceID = generateSourceID('LINK');

      // PRIORITY: Manual Date (user-entered) -> Analysis Date (Gemini-extracted) -> Current Date (fallback)
      let postDate = null;
      let dateSource = "";

      if (manualDate) {
        postDate = parseManualDate(manualDate);
        if (postDate) {
          dateSource = `Manual DatePosted: ${manualDate} -> ${postDate}`;
        }
      }

      if (!postDate && analysis.post_date) {
        postDate = normalizeDate(analysis.post_date, new Date());
        dateSource = `Gemini extracted date: ${postDate}`;
      }

      if (!postDate) {
        postDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM.dd.yyyy");
        dateSource = `Fallback to current date: ${postDate}`;
      }

      Logger.log(`   → PostDate source: ${dateSource}`);

      const rowData = new Array(headersTarget.length).fill("");
      
      if (colMap.SourceID !== -1) rowData[colMap.SourceID] = sourceID;
      if (colMap.PostDate !== -1) rowData[colMap.PostDate] = postDate;
      if (colMap.Source !== -1) rowData[colMap.Source] = normalizeSource(nullSafe(analysis.source));
      if (colMap.Title !== -1) rowData[colMap.Title] = analysis.title || titleGuess || "Untitled";
      if (colMap.Author !== -1) rowData[colMap.Author] = analysis.author || authorGuess || "";
      if (colMap.URL !== -1) rowData[colMap.URL] = url;
      if (colMap.Summary !== -1) rowData[colMap.Summary] = analysis.summary || "";
      
      if (colMap.RawText !== -1) {
         let text = analysis.raw_text || enrichedContent;
         if (ytTranscript) {
           text = `[TRANSCRIPT EXTRACTED]\n\n${ytTranscript}\n\n[ANALYSIS TEXT]\n\n${text}`;
         }
         text = text.replace(/[\r\n]+/g, " ").replace(/\s\s+/g, " ").trim();
         rowData[colMap.RawText] = text;
      }

      // Append to Master
      sheetTarget.appendRow(serializeRowData(rowData));

      // 4. Tab-Hopping (Success)
      // Processed sheet columns: URL | Notes/Title | DatePosted | DateProcessed
      if (processedSheet) {
        processedSheet.appendRow(serializeRowData([url, analysis.title || titleGuess || notes, manualDate, new Date()]));
      }
      rowsToDelete.push(i + 1);
      Logger.log(`   ✓ Successfully ingested and moved to Processed.`);

    } catch (e) {
      Logger.log(`   ! Error processing ${url}: ${e.toString()}`);
      // Tab-Hopping (Failure)
      // ErrorLog columns: URL | Notes/Title | ErrorDate | ErrorReason
      if (errorSheet) {
        errorSheet.appendRow(serializeRowData([url, notes, new Date(), e.toString()]));
      }
      rowsToDelete.push(i + 1);
    }
  }

  // Delete processed rows (bottom-up)
  for (let j = rowsToDelete.length - 1; j >= 0; j--) {
    inboxSheet.deleteRow(rowsToDelete[j]);
  }

  // Check if more rows remain (after deletion, check if sheet has more than just header)
  const hasMoreLinks = inboxSheet.getLastRow() > 1;
  setBacklogStatus('LINK', hasMoreLinks);
  Logger.log(`Spreadsheet Inbox complete. More pending: ${hasMoreLinks}`);
}

/**
 * Analyzes raw text content using Gemini AI.
 * Used for spreadsheet and web content ingestion.
 */
function analyzeRawTextWithGemini(text, url, sourceHint) {
  const API_KEY = getGeminiKey();
  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${DRIVE_GEMINI_MODEL}:generateContent?key=${API_KEY}`;

  // System prompt (centralized via Million Dollar Prompt)
  const systemPrompt = getMillionDollarPrompt(sourceHint, url);

  const payload = {
    contents: [{ role: "user", parts: [{ text: `Analyze this content:\n\n${text}` }, { text: systemPrompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: getGeminiResponseSchema()
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    timeout: 300000 // 5 minutes - allows time for heavy spreadsheet content analysis
  };

  try {
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const json = JSON.parse(response.getContentText());
    if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) {
      return JSON.parse(json.candidates[0].content.parts[0].text);
    }
  } catch (e) {
    Logger.log("Gemini Text Analysis Failed: " + e.toString());
  }
  return null;
}

// ============================================================================
// DRIVE-SPECIFIC HELPERS (Keep existing helpers)
// ============================================================================

