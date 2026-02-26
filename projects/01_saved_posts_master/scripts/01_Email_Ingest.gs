/**
 * EMAIL INGEST - Process Gmail messages and extract content to Sheet
 * Model: Gemini 3 Flash Preview
 *
 * STABLE VERSION - Updated January 2025
 *
 * WORKFLOW:
 * - Emails sent via iOS Shortcuts with format: [PLATFORM] URL
 * - Platform tags: REDDIT, YOUTUBE, SUBSTACK, LINKEDIN, WEBPAGE
 * - URL is in subject line (not body)
 * - For Reddit: Full HTML scraped by iPhone Shortcut, included in email body
 * - Content may already be in email body (Substack, LinkedIn, Webpage)
 * - Errors automatically logged to ErrorLog sheet
 */

// ============================================================================
// EMAIL-SPECIFIC CONFIGURATION
// ============================================================================

const MAX_EMAILS_PER_RUN = 5; // Conservative limit for 6-min execution window
const EMAIL_GEMINI_MODEL = 'gemini-3-flash-preview';

// Gmail Label Configuration
const INBOX_LABEL = '_INBOX_READING';
const PROCESSED_LABEL = '_INBOX_READING/_PROCESSED';
const ERROR_LABEL = '_INBOX_READING/_ERROR';

// Updated Search Query for New Subject Format
const SEARCH_QUERY = `label:${INBOX_LABEL} -label:${PROCESSED_LABEL}`;

// ============================================================================
// EMAIL-SPECIFIC HELPERS (Subject Line Parsing)
// ============================================================================

/**
 * Extracts the platform tag from subject line.
 * Format: [PLATFORM] url
 * Returns: "Reddit", "YouTube", "Substack", "LinkedIn", "Website"
 */
function extractPlatformFromSubject(subject) {
  if (!subject) return "Website";
  
  const match = subject.match(/^\[(.*?)\]/);
  if (!match) return "Website";
  
  const tag = match[1].toUpperCase();
  
  // Map to standardized source names
  if (tag === 'REDDIT') return "Reddit";
  if (tag === 'YOUTUBE') return "YouTube";
  if (tag === 'SUBSTACK') return "Substack";
  if (tag === 'LINKEDIN') return "LinkedIn";
  if (tag === 'WEBPAGE') return "Website";
  
  return "Website";
}

/**
 * Extracts the URL from subject line.
 * Format: [PLATFORM] url
 * Returns: Clean URL string
 */
function extractUrlFromSubject(subject) {
  if (!subject) return "";

  // Remove the [PLATFORM] tag and get the URL
  const urlPart = subject.replace(/^\[.*?\]\s*/, '').trim();

  // Basic validation that it looks like a URL
  if (urlPart.startsWith('http://') || urlPart.startsWith('https://')) {
    let url = urlPart;

    // Clean redd.it shortlinks - strip trailing non-ID characters
    // redd.it IDs are lowercase alphanumeric (base36), so uppercase chars signal
    // garbage text from iOS Shortcut scraping (e.g. "Submit" button text)
    if (url.includes('redd.it/')) {
      url = url.replace(/(redd\.it\/[a-z0-9]+)[A-Z].*$/, '$1');
    }

    return url;
  }

  // No URL found (likely a standard email/newsletter)
  return "";
}

/**
 * Standardizes a string for deduplication (case-insensitive, alphanumeric only).
 * Used for content-based duplicate detection.
 */
const email_cleanKey = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, '').trim();

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main function: Process a batch of messages from Gmail inbox.
 * Uses LockService to prevent concurrent runs.
 * 
 * @param {Date} startTime - The time the orchestrator started (for greedy control)
 */
function ingestEmailBatch(startTime) {
  startTime = startTime || new Date(); // Fallback for manual runs
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    Logger.log('Could not obtain lock after 30 seconds. Exiting.');
    return;
  }

  try {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
    
    if (!sheet) {
      Logger.log("Target sheet not found: " + TARGET_SHEET_NAME);
      return;
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap = mapHeaders(headers);

    // Load existing data for deduplication
    const existingUrls = new Set();
    const existingSourceIds = new Set();
    const existingContentKeys = new Set(); 
    const lastRow = sheet.getLastRow();
    
    if (lastRow > 1) {
      const dataRange = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      dataRange.forEach(row => {
        if (colMap.URL !== -1) {
          const url = String(row[colMap.URL]).trim();
          if (url) existingUrls.add(url);
        }
        if (colMap.SourceID !== -1) {
          const id = String(row[colMap.SourceID]).trim();
          if (id) existingSourceIds.add(id);
        }
        if (colMap.Title !== -1 && colMap.Author !== -1) {
          const key = `${email_cleanKey(row[colMap.Title])}|${email_cleanKey(row[colMap.Author])}`;
          if (key.length > 5) existingContentKeys.add(key);
        }
      });
    }

    const threads = GmailApp.search(SEARCH_QUERY);
    Logger.log(`Found ${threads.length} matching threads.`);

    let totalProcessed = 0;
    let videosProcessed = 0; // Track YouTube videos separately
    const errorsToLog = [];
    let hasMoreThreads = false;

    for (let i = 0; i < threads.length; i++) {
      // Greedy Check: If time is running out, stop processing and mark backlog as pending
      if (isTimeRunningOut(startTime)) {
        Logger.log("   ! TIME EXPIRED: Partial batch processed. Marking backlog as PENDING.");
        hasMoreThreads = true;
        break;
      }

      // Batch Limit Check: Stop after processing MAX_EMAILS_PER_RUN emails
      if (totalProcessed >= MAX_EMAILS_PER_RUN) {
        Logger.log(`   ! BATCH LIMIT REACHED: Processed ${totalProcessed} emails. Marking backlog as PENDING.`);
        hasMoreThreads = true;
        break;
      }

      const thread = threads[i];
      const messages = thread.getMessages();
      let threadHasError = false;
      
      // Process messages in reverse (newest first)
      for (let j = messages.length - 1; j >= 0; j--) {
        const message = messages[j];
        const messageId = message.getId();
        const sourceID = `EMAIL_${messageId}`;

        if (existingSourceIds.has(sourceID)) continue;

        let subject = "";
        try {
          subject = message.getSubject();
          const emailDate = message.getDate();
          let body = message.getBody();
          
          // RECOVERY RAIL: If email is >10MB, slice the first 2MB
          if (body.length > 10 * 1024 * 1024) {
            Logger.log(`   ! Large email (${Math.round(body.length/1024/1024)}MB). Slicing first 2MB to capture main content...`);
            body = body.substring(0, 2 * 1024 * 1024);
          }
          
          // NEW: Extract URL and Platform from subject line
          let sourceUrl = extractUrlFromSubject(subject);
          let sourcePlatform = extractPlatformFromSubject(subject);

          // Auto-detect GitHub from URL (not subject tag)
          if (sourceUrl && sourceUrl.toLowerCase().includes('github.com')) {
            sourcePlatform = "GitHub";
          }

          if (!sourceUrl) {
            Logger.log(`   + No URL found in subject. Treating as Full-Body Email/Newsletter.`);
            sourceUrl = `https://mail.google.com/mail/u/0/#inbox/${messageId}`; // Fallback URL to Gmail message
          }

          Logger.log(`Processing ${j+1}/${messages.length}: [${sourcePlatform}] ${sourceUrl}`);

          // SPECIAL: For Reddit posts with redd.it shortlinks or /s/ share links,
          // resolve to full reddit.com/r/.../comments/... URL from the email body HTML
          if (sourcePlatform === "Reddit" && (sourceUrl.includes('redd.it/') || sourceUrl.includes('/s/'))) {
            const plainBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
            // Look for full reddit.com URL with /r/subreddit/comments/ pattern (canonical URL)
            const resolvedMatch = plainBody.match(/https:\/\/(old\.reddit\.com|www\.reddit\.com)\/r\/[^\/]+\/comments\/[^\s\"\'\<\>]+/i);
            if (resolvedMatch) {
              sourceUrl = resolvedMatch[0].replace('old.reddit.com', 'www.reddit.com');
              Logger.log(`   ✓ Resolved to full URL: ${sourceUrl}`);
            }
          }

          // Check if URL already exists (early exit)
          if (existingUrls.has(sourceUrl)) {
            Logger.log(`    ! Skipping Duplicate URL: ${sourceUrl}`);
            existingSourceIds.add(sourceID);
            message.markRead();
            continue;
          }

          if (totalProcessed > 0) Utilities.sleep(2000);

          // CONTENT ENRICHMENT BASED ON PLATFORM
          let enrichedContent = cleanHtml(body, 30000);
          let analysis = null;
          let platformData = null;  // For YouTube metadata
          let ytTranscript = null;  // Preserve for post-Gemini assembly

          if (sourcePlatform === "Reddit") {
            // Extract Reddit HTML from email body (after "jump to content") - using case-insensitive split
            const bodyParts = body.split(/jump to content/i);
            const bodyAfterHeader = bodyParts.length > 1 ? bodyParts[1] : body;
            
            // Use Gemini Flash to clean Reddit HTML
            const redditContent = cleanRedditContentWithGemini(bodyAfterHeader);
            
            if (redditContent && redditContent.length > 50) {
              Logger.log(`   + Using Gemini-cleaned Reddit content (${redditContent.length} chars)`);
              enrichedContent = `REDDIT POST:\n${redditContent}`;
            } else {
              Logger.log(`   ! Gemini Reddit cleaner returned nothing/short. Falling back to cleaned email body.`);
              // enrichedContent already has cleanHtml output
              enrichedContent = `REDDIT POST (CLEANED FALLBACK):\n${enrichedContent}`;
            }
          } else if (sourcePlatform === "LinkedIn") {
            // Use Gemini Flash to extract LinkedIn post content from HTML email
            const linkedInContent = cleanLinkedInContentWithGemini(body);
            Logger.log(`   + Using Gemini-cleaned LinkedIn content (${linkedInContent.length} chars)`);
            enrichedContent = `LINKEDIN POST:\n${linkedInContent}`;
          } else if (sourcePlatform === "YouTube") {
            // Video Batch Limit Check: Stop after processing MAX_VIDEOS_PER_RUN videos
            if (videosProcessed >= MAX_VIDEOS_PER_RUN) {
              Logger.log(`   ! VIDEO BATCH LIMIT REACHED: Processed ${videosProcessed} videos. Stopping.`);
              hasMoreThreads = true;
              break;
            }

            // Fetch YouTube metadata and transcript
            Logger.log(`   + YouTube detected. Fetching metadata and transcript...`);
            videosProcessed++; // Increment counter when starting video processing

            // Fetch metadata (fast operation)
            platformData = fetchYouTubeMetadata(sourceUrl);

            const videoId = extractYouTubeVideoId(sourceUrl);

            // Fetch transcript (potentially long operation - wrapped for better error reporting)
            if (videoId) {
              try {
                ytTranscript = getYoutubeTranscript(videoId);
                if (ytTranscript) {
                  Logger.log(`   ✓ Transcript fetched (${ytTranscript.length} chars)`);
                } else {
                  Logger.log(`   ! Transcript could not be fetched for ${videoId}`);
                }
              } catch (transcriptError) {
                // Transcript fetch failed - could be timeout, API error, or invalid video
                Logger.log(`   ! Transcript fetch error for ${videoId}: ${transcriptError.toString()}`);
                throw new Error(`Video transcript failed (likely timeout >6 min): ${transcriptError.toString()}`);
              }
            }

            if (platformData) {
              let ytContent = `YOUTUBE VIDEO:\nTitle: ${platformData.title}\nAuthor: ${platformData.author}`;
              ytContent += `\n\nTRANSCRIPT FOUND: ${ytTranscript ? "YES" : "NO"}`;
              ytContent += `\n\nORIGINAL EMAIL:\n${enrichedContent}`;
              enrichedContent = ytContent;
            } else if (ytTranscript) {
              // If metadata fails but transcript succeeds
              enrichedContent = `YOUTUBE VIDEO:\n\nTRANSCRIPT FOUND: YES\n\nORIGINAL EMAIL:\n${enrichedContent}`;
            }
          } else if (sourcePlatform === "GitHub") {
            // Apply GitHub-specific boilerplate stripping
            Logger.log(`   + GitHub detected. Applying boilerplate cleaning...`);
            enrichedContent = cleanGitHubContent(enrichedContent);
            enrichedContent = `GITHUB REPOSITORY:\n${enrichedContent}`;
          } else if (sourcePlatform === "Website" && enrichedContent.length < 300) {
            // Only scrape if body is minimal
            Logger.log(`   + Generic webpage with minimal content. Fetching...`);
            const webContent = fetchWebContent(sourceUrl);
            if (webContent && webContent.length > 300) {
              enrichedContent = webContent;
            }
          }
          // Substack and LinkedIn already have full content in email body

          // Gemini analysis
          analysis = analyzeEmailWithGemini(enrichedContent, sourceUrl, sourcePlatform);
          
          if (!analysis) {
            throw new Error("Gemini analysis failed or returned null.");
          }

          // Check for "silently failed" analysis (where Gemini returns a valid JSON but with error messages)
          if (isAnalysisError(analysis)) {
            const errorMsg = `Gemini could not process content: ${analysis.tags || "Missing content"}`;
            Logger.log(`   ! SILENT FAILURE: ${errorMsg}`);
            throw new Error(errorMsg);
          }

          totalProcessed++;

          // Use extracted URL as final URL (override Gemini if needed)
          const finalUrl = sourceUrl;

          // Build metadata - Use platform data directly when available
          let finalTitle = nullSafe(analysis.title) || subject;
          let finalAuthor = "";
          let finalRawText = "";

          // For Reddit/YouTube: Use platform data directly (more reliable than Gemini extraction)
          if (platformData && platformData.author) {
            finalAuthor = platformData.author;
            Logger.log(`   Using platform author: ${finalAuthor}`);
          } else {
            finalAuthor = nullSafe(analysis.author) || "";
          }

          // For Reddit: Use full selftext (post + comments) directly
          if (platformData && platformData.selftext) {
            finalRawText = platformData.selftext;
            Logger.log(`   Using platform raw text (${finalRawText.length} chars)`);
          } else {
            finalRawText = nullSafe(analysis.raw_text) || "";
          }
          
          // Content-based deduplication
          const contentKey = `${email_cleanKey(finalTitle)}|${email_cleanKey(finalAuthor)}`;
          if (contentKey.length > 10 && existingContentKeys.has(contentKey)) {
            Logger.log(`    ! Skipping Duplicate Content: ${finalTitle} by ${finalAuthor}`);
            existingSourceIds.add(sourceID);
            message.markRead();
            continue;
          }

          // Build row data
          const rowData = new Array(headers.length).fill("");
          if (colMap.SourceID !== -1) rowData[colMap.SourceID] = sourceID;
          if (colMap.PostDate !== -1) rowData[colMap.PostDate] = normalizeDate(analysis.post_date, emailDate); // Hard fallback to email received date
          if (colMap.Source !== -1) rowData[colMap.Source] = sourcePlatform; // Use extracted platform
          if (colMap.Title !== -1) rowData[colMap.Title] = finalTitle;
          if (colMap.Author !== -1) rowData[colMap.Author] = finalAuthor;
          if (colMap.URL !== -1) rowData[colMap.URL] = finalUrl;
          if (colMap.Tags !== -1) rowData[colMap.Tags] = nullSafe(analysis.tags) || "";
          if (colMap.Summary !== -1) rowData[colMap.Summary] = nullSafe(analysis.summary) || "";
          
          if (colMap.RawText !== -1) {
            // Use finalRawText which has platform data (Reddit comments, etc.) or Gemini extraction
            let text = finalRawText || "";
            // Prepend transcript if available (ensures it survives Gemini truncation)
            if (ytTranscript) {
              text = `[TRANSCRIPT EXTRACTED]\n\n${ytTranscript}\n\n[CONTENT]\n\n${text}`;
            }
            // Flatten all text to single line
            text = text.replace(/[\r\n]+/g, " ").replace(/\s\s+/g, " ").trim();
            rowData[colMap.RawText] = text;
          }

          // Use String Guard: Serialize row data before appending
          sheet.appendRow(serializeRowData(rowData));
          
          existingSourceIds.add(sourceID);
          existingUrls.add(finalUrl);
          if (contentKey.length > 10) existingContentKeys.add(contentKey);
          
          message.markRead();
          Logger.log(`   + Added: ${finalTitle}`);

        } catch (e) {
          Logger.log(`   X ERROR on ${sourceID}: ${e.toString()}`);
          threadHasError = true;
          errorsToLog.push({ 
            id: sourceID, 
            message: e.toString(), 
            context: subject 
          });
        }
      }

      // Thread labeling with error handling and verification
      try {
        const inboxLabelObj = GmailApp.getUserLabelByName(INBOX_LABEL);
        const threadId = thread.getId();

        if (threadHasError) {
          const errorLabelObj = GmailApp.getUserLabelByName(ERROR_LABEL) || GmailApp.createLabel(ERROR_LABEL);
          thread.addLabel(errorLabelObj);
          if (inboxLabelObj) thread.removeLabel(inboxLabelObj);

          // Verify label was applied
          const labels = thread.getLabels();
          const hasErrorLabel = labels.some(label => label.getName() === ERROR_LABEL);
          if (hasErrorLabel) {
            Logger.log(`   ! Thread ${threadId} moved to ERROR label (verified).`);
          } else {
            Logger.log(`   ✗ LABEL FAILURE: Thread ${threadId} ERROR label NOT applied despite no exception.`);
          }
        } else {
          const allProcessed = messages.every(msg => existingSourceIds.has(`EMAIL_${msg.getId()}`));
          if (allProcessed) {
            const processedLabelObj = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
            thread.addLabel(processedLabelObj);
            if (inboxLabelObj) thread.removeLabel(inboxLabelObj);
            thread.markRead();
            Logger.log(`   + Thread ${threadId} moved to PROCESSED label.`);
          }
        }
      } catch (labelError) {
        Logger.log(`   ✗ LABEL ERROR on thread ${thread.getId()}: ${labelError.toString()}`);
        // Don't throw - continue processing other threads
      }
    }

    // Log errors to sheet
    if (errorsToLog.length > 0) {
      Logger.log(`${errorsToLog.length} errors occurred during batch.`);
      errorsToLog.forEach(err => logErrorToSheet(err.id, "INGEST_ERROR", err.message, err.context));
    }

    // Update Backlog State
    setBacklogStatus('EMAIL', hasMoreThreads);
    
  } catch (e) {
    Logger.log(`Batch execution failed: ${e.toString()}`);
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// GEMINI API INTEGRATION
// ============================================================================

/**
 * Analyzes email content using Gemini AI.
 * Now includes platform hint for better context.
 */
function analyzeEmailWithGemini(textContent, sourceUrl, sourcePlatform) {
  const API_KEY = getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMAIL_GEMINI_MODEL}:generateContent?key=${API_KEY}`;
  
  const refDate = getTodayFormatted(); // Today's date as a ground-truth reference
  const minLength = 5;
  if (!textContent || textContent.length < minLength) return null;

  const systemInstruction = getMillionDollarPrompt(sourcePlatform, sourceUrl);
  
  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: `CONTENT:\n${textContent}` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: getGeminiResponseSchema(),
      temperature: 0.3
    }
  };

  const maxRetries = 3;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        timeout: 300000 // 5 minutes - allows time for heavy API processing
      };
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      const text = response.getContentText();
      
      if (code === 200) {
        const json = JSON.parse(text);
        if (json.candidates && json.candidates[0].content.parts[0].text) {
          return JSON.parse(json.candidates[0].content.parts[0].text);
        }
      } else if (code === 503 || code === 429) {
        attempt++;
        if (attempt <= maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          Logger.log(`   ! Model Overloaded (Attempt ${attempt}/${maxRetries}). Waiting ${waitTime}ms...`);
          Utilities.sleep(waitTime);
          continue;
        }
      }
      Logger.log(`Gemini API Error (${code}): ${text}`);
      return null;
    } catch (e) {
      Logger.log("API Exception: " + e.toString());
      attempt++;
      if (attempt <= maxRetries) Utilities.sleep(2000);
      else return null;
    }
  }
  return null;
}

// ============================================================================
// PLATFORM-SPECIFIC ENRICHMENT FUNCTIONS
// ============================================================================

/**
 * Detects if the Gemini analysis result is essentially an error message.
 * Catches cases where Gemini returns JSON but the content says "no content found".
 */
function isAnalysisError(analysis) {
  if (!analysis) return true;
  
  const title = (analysis.title || "").toLowerCase();
  const summary = (analysis.summary || "").toLowerCase();
  const tagsStr = Array.isArray(analysis.tags) ? analysis.tags.join(" ").toLowerCase() : (analysis.tags || "").toString().toLowerCase();
  
  const errorKeywords = ["input error", "missing content", "no content provided", "extraction error", "not applicable"];
  
  // If title or tags indicate an error
  const hasErrorKeyword = errorKeywords.some(kw => 
    title.includes(kw) || 
    tagsStr.includes(kw) || 
    summary.includes("no content was provided") ||
    summary.includes("content not provided")
  );
  
  if (hasErrorKeyword) return true;
  
  // If it's a "N/A" shell result
  if (title.length < 5 && tagsStr === "" && summary.includes("n/a")) return true;

  return false;
}

// YouTube and Web helpers removed and migrated to 00_Brain_Config.gs

// End of 01_Email_Ingest.gs
