/**
 * Simple test function for clasp run verification
 */
function testClaspRun() {
  return "clasp run works - 01_Recruitment_Engine";
}

/**
 * BRAIN CONFIG - Centralized Configuration & Shared Utilities
 * 
 * This file contains:
 * - API Key Management
 * - Universal Constants
 * - Shared Helper Functions
 * 
 * All other scripts in this project reference functions and constants from this file.
 */

// ============================================================================
// API KEY MANAGEMENT
// ============================================================================

/**
 * Retrieves the Gemini API Key from Script Properties.
 * This ensures no hardcoded keys and centralizes key management.
 * 
 * Setup: Go to Project Settings > Script Properties > Add Property
 * - Property: GEMINI_API_KEY
 * - Value: Your actual API key
 */
function getGeminiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key || key === 'YOUR_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY not found in Script Properties. Please configure it in Project Settings.');
  }
  return key;
}

// ============================================================================
// UNIVERSAL CONSTANTS
// ============================================================================

// Google Sheets Configuration
const TARGET_SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const TARGET_SHEET_NAME = 'PostMasterList';

// Standard Folder Names (Used across Drive workflows)
const PROCESSED_FOLDER_NAME = '_Processed';
const ERROR_FOLDER_NAME = '_Errors';

// NotebookLM Monthly Export Configuration
const NOTEBOOKLM_EXPORT_FOLDER_ID = 'YOUR_NOTEBOOKLM_FOLDER_ID';
// Monthly exports are saved as: YYYY-MM_Archive.md (e.g., 2026-01_Archive.md)
// Files are saved to the specified Drive folder

// Batch Size Configuration (Tune these based on your Gemini API tier)
const BATCH_SIZE_EMAIL = 1;       // Emails per run
const BATCH_SIZE_DRIVE = 1;       // Physical Drive files per run
const BATCH_SIZE_SPREADSHEET = 3;  // URLs from Link Inbox per run

// Link Inbox Configuration
const LINK_INBOX_SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const LINK_INBOX_SHEET_NAME = 'Inbox';
const LINK_PROCESSED_SHEET_NAME = 'Processed';
const LINK_ERROR_SHEET_NAME = 'ErrorLog';

// Reporting Configuration
const SUMMARY_RECIPIENT_EMAIL = 'your.email@example.com'; // Change this to your preferred email

// Execution Time Management (for time-based loop controls)
const MAX_EXECUTION_TIME_MS = 300000; // 5 minutes (conservative for standard 6-min limit)
const MAX_VIDEOS_PER_RUN = 1; // Maximum videos to process per execution (conservative for 6-min limit)

/**
 * RECIPIENT PERSONA (Used to steer AI summaries and reporting tone)
 * Role: Executive Search Consultant (Senior to CFO) in SoCal Finance (SaaS, Real Estate, Entertainment).
 * Tone: Clinical, critical, hyper-efficient, "ruthless" (no fluff).
 * Focus: High-level recruitment strategy, AI efficiency, Big 4 pedigree, and tech stack optimization.
 */
const RECIPIENT_PERSONA = `Executive Search Consultant (Senior to CFO) in Southern California Accounting & Finance. 
Primary sectors: SaaS, Real Estate, Entertainment. 
Operational stance: Clinical, critical, and hyper-efficient. Focus on high-level talent (Top 10%), Big 4 pedigree, and AI/Recruitment technology synergies.`;

// ============================================================================
// SHARED HELPER FUNCTIONS
// ============================================================================

/**
 * Strips HTML tags, scripts, and styles to reduce token count.
 * Unified version used by both Email and Drive ingestion.
 * 
 * @param {string} html - Raw HTML content
 * @param {number} maxLength - Optional character limit (default: no limit)
 * @return {string} Clean text content
 */
function cleanHtml(html, maxLength) {
  if (!html) return "";
  
  // 1. Remove Scripts and Styles (Content inside them is useless for analysis)
  let text = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, " ");
  text = text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, " ");
  
  // 2. Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  
  // 3. Decode common entities
  text = text.replace(/&nbsp;/g, " ")
             .replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"')
             .replace(/&#039;/g, "'");

  // 4. Second Pass: Strip tags that emerged after decoding (the "Encoded Tag" leak fix)
  text = text.replace(/<[^>]+>/g, " ");

  // 5. Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  // 6. Apply length limit if specified (prevents context window overflow)
  if (maxLength && text.length > maxLength) {
    text = text.substring(0, maxLength);
  }

  return text;
}

/**
 * Uses Gemini 1.5 Flash to extract clean body text from Reddit HTML.
 * REPLACES unstable Regex logic for Reddit content.
 *
 * Optimized for "Vibe Coder" philosophy: Low maintenance over micro-optimization.
 * Cost: ~$0.075 per 1M tokens (pennies per year for low volume).
 * Benefit: Works regardless of Reddit DOM structure changes.
 *
 * @param {string} rawHtml - The raw HTML from Reddit
 * @return {string} Clean, human-readable post text
 */
function cleanRedditContentWithGemini(rawHtml) {
  // 1. Safety Check: If HTML is empty or too short, return as is
  if (!rawHtml || rawHtml.length < 50) return rawHtml || "";

  // 2. Truncate to avoid payload limits (250K chars is enough for main body + context)
  const payloadText = rawHtml.substring(0, 250000);

  const API_KEY = getGeminiKey();
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`;

  const payload = {
    "contents": [{
      "parts": [{
        "text": `You are a data extraction engine.
I will paste raw HTML from a Reddit thread below.

Your Job: Extract the original post body text AND all substantive comments.

Format:
POST by [username]:
[full post text]

COMMENTS:
[username1]: [comment text]
[username2]: [reply text]
...

Rules:
- Remove all sidebars, navigation, "upvote" counts, user flairs, and Reddit UI boilerplate.
- Remove "AutoModerator" comments.
- Remove low-value comments (single emoji reactions, "this", "thanks", deleted/removed).
- Keep all comments that add information, context, solutions, or opinions.
- Do not summarize. Return the exact original text of each comment.
- Preserve the username (e.g. "u/HuntingSpoon") for the post author and each commenter.
- If no distinct body text is found, return nothing.

HTML Source:
${payloadText}`
      }]
    }]
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true,
      "timeout": 300000 // 5 minutes
    });

    const json = JSON.parse(response.getContentText());

    // 3. Parse Gemini Response
    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const cleanText = json.candidates[0].content.parts[0].text.trim();
      Logger.log(`✓ Gemini Flash cleaned Reddit content (${cleanText.length} chars)`);
      return cleanText;
    } else {
      Logger.log(`⚠ Gemini Flash returned no content: ${JSON.stringify(json)}`);
      return ""; // Fail gracefully
    }

  } catch (e) {
    Logger.log(`✗ Gemini Flash API Failed: ${e.toString()}`);
    // Fallback: Return raw HTML so we don't lose data
    return rawHtml;
  }
}

/**
 * Uses Gemini 1.5 Flash to extract clean body text from LinkedIn email HTML.
 * Similar to Reddit cleaner - handles LinkedIn's email format intelligently.
 *
 * Optimized for "Vibe Coder" philosophy: Low maintenance over micro-optimization.
 * LinkedIn emails often contain minimal preview text + "View on LinkedIn" links.
 * This extracts the actual post content from HTML.
 *
 * @param {string} rawHtml - The raw HTML from LinkedIn email
 * @return {string} Clean LinkedIn post text
 */
function cleanLinkedInContentWithGemini(rawHtml) {
  // 1. Safety Check: If HTML is empty or too short, return as is
  if (!rawHtml || rawHtml.length < 50) return rawHtml || "";

  // 2. Truncate to avoid payload limits (100K chars)
  const payloadText = rawHtml.substring(0, 100000);

  const API_KEY = getGeminiKey();
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`;

  const payload = {
    "contents": [{
      "parts": [{
        "text": `You are a data extraction engine.
I will paste raw HTML from a LinkedIn email below.
Your Job: Extract ONLY the FIRST/main LinkedIn post body text.

CRITICAL RULES:
- Extract ONLY the first post at the top (the one the email is about)
- IGNORE the "More Relevant Posts" section completely
- IGNORE comments section
- Remove email headers, footers, and "View on LinkedIn" links
- Remove LinkedIn UI elements, social buttons, and navigation
- Do not summarize. Return the exact original post text.
- If no post content is found, return nothing.

The email contains one main post, then "More Relevant Posts" with many other posts.
You must ONLY extract the first main post and stop before "More Relevant Posts".

HTML Source:
${payloadText}`
      }]
    }]
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true,
      "timeout": 300000 // 5 minutes
    });

    const json = JSON.parse(response.getContentText());

    // 3. Parse Gemini Response
    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const cleanText = json.candidates[0].content.parts[0].text.trim();
      Logger.log(`✓ Gemini Flash cleaned LinkedIn content (${cleanText.length} chars)`);
      return cleanText;
    } else {
      Logger.log(`⚠ Gemini Flash returned no content: ${JSON.stringify(json)}`);
      return ""; // Fail gracefully
    }

  } catch (e) {
    Logger.log(`✗ Gemini Flash API Failed: ${e.toString()}`);
    // Fallback: Return raw HTML so we don't lose data
    return rawHtml;
  }
}

/**
 * Strips GitHub-specific UI boilerplate from content.
 * Use this AFTER cleanHtml() when processing GitHub URLs.
 *
 * @param {string} text - The text to clean
 * @return {string} Cleaned text without GitHub UI elements
 */
function cleanGitHubContent(text) {
  if (!text) return "";

  // GitHub UI patterns that pollute scrapes
  const ghBoilerplate = [
    "Skip to content", "Sign in", "Sign up", "Navigation Menu",
    "Star history", "Footer navigation", "Footer", "Terms", "Privacy",
    "Security", "Status", "Docs", "Contact GitHub", "Pricing",
    "API", "Training", "Blog", "About", "© 2024 GitHub", "© 2025 GitHub",
    "© 2026 GitHub", "Star 0", "Fork 0", "Watch", "Code", "Issues",
    "Pull requests", "Actions", "Projects", "Wiki", "Security", "Insights"
  ];

  ghBoilerplate.forEach(phrase => {
    const regex = new RegExp(phrase, 'gi');
    text = text.replace(regex, " ");
  });

  // Collapse whitespace after removal
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Retry wrapper for API calls with exponential backoff.
 * Handles rate limiting (429) and service unavailability (503).
 * 
 * @param {Function} apiCallFunction - The function to retry
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @return {Object|null} API response or null on failure
 */
function retryWrapper(apiCallFunction, maxRetries) {
  if (!maxRetries) maxRetries = 3;
  
  let attempt = 0;
  
  while (attempt <= maxRetries) {
    try {
      const response = apiCallFunction();
      const code = response.getResponseCode();
      
      if (code === 200) {
        return JSON.parse(response.getContentText());
      } else if (code === 503 || code === 429) {
        attempt++;
        if (attempt <= maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          Logger.log(`API Rate Limited (${code}). Retry ${attempt}/${maxRetries} in ${waitTime}ms...`);
          Utilities.sleep(waitTime);
          continue;
        }
      } else {
        Logger.log(`API Error (${code}): ${response.getContentText()}`);
        return null;
      }
    } catch (e) {
      Logger.log(`API Exception: ${e.toString()}`);
      attempt++;
      if (attempt <= maxRetries) {
        Utilities.sleep(2000);
      } else {
        return null;
      }
    }
  }
  
  return null;
}

/**
 * Safely parses JSON with error handling.
 * Strips markdown code fences if present.
 * 
 * @param {string} jsonString - JSON string to parse
 * @return {Object|null} Parsed object or null on failure
 */
function safeJsonParse(jsonString) {
  if (!jsonString) return null;
  
  try {
    // Remove markdown code blocks if present
    let cleaned = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    Logger.log(`JSON Parse Error: ${e.toString()}`);
    return null;
  }
}

/**
 * Maps sheet headers to column indices.
 * Returns a standardized column map object.
 * 
 * @param {Array} headers - Array of header values from row 1
 * @return {Object} Map of column names to indices (0-based)
 */
function mapHeaders(headers) {
  const map = {
    SourceID: -1,
    PostDate: -1,
    Source: -1,
    Title: -1,
    Author: -1,
    URL: -1,
    Tags: -1,
    Summary: -1,
    RawText: -1,
    Type: -1,
    ProcessedDate: -1
  };
  
  headers.forEach((h, i) => {
    const name = String(h).toLowerCase().trim();
    if (name === 'sourceid') map.SourceID = i;
    else if (name === 'postdate') map.PostDate = i;
    else if (name === 'source') map.Source = i;
    else if (name === 'title') map.Title = i;
    else if (name === 'author') map.Author = i;
    else if (name === 'url') map.URL = i;
    else if (name === 'tags') map.Tags = i;
    else if (name === 'summary_thesis') map.Summary = i;
    else if (name === 'raw text' || name === 'rawtext') map.RawText = i;
    else if (name === 'type') map.Type = i;
    else if (name === 'processeddate') map.ProcessedDate = i;
  });
  
  return map;
}

/**
 * Get or create a folder by name within a parent folder.
 * 
 * @param {Folder} parentFolder - Parent folder object
 * @param {string} folderName - Name of folder to find or create
 * @return {Folder} The folder object
 */
function getOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  } else {
    return parentFolder.createFolder(folderName);
  }
}

/**
 * Normalizes date string to MM.DD.YYYY format.
 * Handles various input formats including YYYY-MM-DD.
 * 
 * @param {string} dateStr - Date string in various formats
 * @param {Date} fallbackDate - Optional: Fallback date if parsing fails (if omitted, returns null)
 * @return {string|null} Date in MM.DD.YYYY format or null
 */
function normalizeDate(dateStr, fallbackDate) {
  // If no date provided, use fallback if provided, else return null
  if (!dateStr || String(dateStr).toLowerCase() === 'null') {
    if (fallbackDate) {
      return Utilities.formatDate(fallbackDate, Session.getScriptTimeZone(), "MM.dd.yyyy");
    }
    return null;
  }
  
  // Clean string
  dateStr = String(dateStr).trim();
  
  // If already in MM.DD.YYYY format, return as-is
  if (dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
    return dateStr;
  }
  
  // If in YYYY-MM-DD format, flip it
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = dateStr.split('-');
    return `${m}.${d}.${y}`;
  }
  
  // Replace dashes/slashes with dots
  return dateStr.replace(/[-/]/g, '.');
}

/**
 * Parses user-entered manual dates in MM.DD.YY or M.D.YY format.
 * Converts to MM.dd.yyyy format for consistency.
 *
 * @param {string|Date} dateInput - Date string like "11.5.25" or "1.20.25"
 * @return {string|null} Formatted date string "MM.dd.yyyy" or null if invalid
 *
 * Examples:
 *   "11.5.25" -> "11.05.2025" (November 5, 2025)
 *   "1.20.25" -> "01.20.2025" (January 20, 2025)
 *   "12.8.25" -> "12.08.2025" (December 8, 2025)
 */
function parseManualDate(dateInput) {
  // Handle empty/null input
  if (!dateInput || String(dateInput).trim() === '' || String(dateInput).toLowerCase() === 'null') {
    return null;
  }

  // If already a Date object, format it
  if (dateInput instanceof Date) {
    return Utilities.formatDate(dateInput, Session.getScriptTimeZone(), "MM.dd.yyyy");
  }

  const dateStr = String(dateInput).trim();

  // Pattern: M.D.YY or MM.DD.YY (with dots, slashes, or dashes)
  const match = dateStr.match(/^(\d{1,2})[\.\-\/](\d{1,2})[\.\-\/](\d{2,4})$/);

  if (!match) {
    Logger.log(`parseManualDate: Invalid format '${dateStr}' - expected MM.DD.YY`);
    return null;
  }

  let month = parseInt(match[1], 10);
  let day = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);

  // Convert 2-digit year to 4-digit (assume 20xx for years 00-99)
  if (year < 100) {
    year += 2000;
  }

  // Validate ranges
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    Logger.log(`parseManualDate: Invalid date values - month: ${month}, day: ${day}, year: ${year}`);
    return null;
  }

  // Create Date object and format
  const dateObj = new Date(year, month - 1, day); // month is 0-indexed in Date()
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "MM.dd.yyyy");
}

/**
 * Generates a globally unique Source ID with millisecond precision and randomness.
 * Format: PREFIX_YYYYMMDD_HHMMSSms_RRR
 * 
 * @param {string} prefix - The prefix (e.g., 'DRIVE', 'EMAIL', 'LINK')
 * @return {string} Unique ID
 */
function generateSourceID(prefix) {
  const now = new Date();
  const datePart = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmmssSS");
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}_${datePart}_${randomPart}`;
}


/**
 * Helper to get today's date in MM.DD.YYYY format for prompt context.
 */
function getTodayFormatted() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM.dd.yyyy");
}

/**
 * Helper to get yesterday's date in MM.DD.YYYY format for report context.
 */
function getYesterdayFormatted() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return Utilities.formatDate(yesterday, Session.getScriptTimeZone(), "MM.dd.yyyy");
}

/**
 * Normalizes source platform name to standard values.
 * 
 * @param {string} sourceStr - Raw source string
 * @return {string} Standardized source name
 */
function normalizeSource(sourceStr) {
  if (!sourceStr) return "Website";
  
  const s = sourceStr.toLowerCase();
  if (s.includes('reddit')) return "Reddit";
  if (s.includes('linkedin')) return "LinkedIn";
  if (s.includes('youtube')) return "YouTube";
  if (s.includes('substack') || s.includes('independent') || s.includes('restack')) return "Substack";
  if (s.includes('pdf')) return "PDF";
  if (s.includes('notion')) return "Notion";
  if (s.includes('github')) return "GitHub";
  
  return "Website";
}

/**
 * Dynamically loads the recruiter persona from _RECRUITER_PERSONA.md.
 * Single source of truth for AI perspective.
 * 
 * @return {string} Persona description
 */
function getRecipientPersona() {
  try {
    const files = DriveApp.getFilesByName('_RECRUITER_PERSONA.md');
    if (files.hasNext()) {
      return files.next().getBlob().getDataAsString();
    }
  } catch (e) {
    Logger.log('   ! Persona file not found, using fallback constant');
  }
  return RECIPIENT_PERSONA; // Fallback to constant defined at top of config
}

/**
 * Returns the centralized "Million Dollar Prompt" for content analysis.
 * Standardizes extraction across Email, Drive, and YouTube.
 * 
 * @param {string} platform - The source platform (Reddit, GitHub, etc.)
 * @param {string} url - The source URL
 * @return {string} The formatted system prompt
 */
function getMillionDollarPrompt(platform, url) {
  const persona = getRecipientPersona();
  const refDate = getTodayFormatted();

  return `
    You are a Strategic Data Extraction Agent. Extract metadata and full content from the provided text.
    
    TARGET RECIPIENT PERSONA:
    ${persona}
    
    REFERENCE DATE: ${refDate} (Use this to resolve relative dates like "yesterday", "1 month ago", etc.)
    
    CONTEXT:
    - Source Platform: ${platform}
    - Source URL: ${url}
    
    FIELDS TO EXTRACT:
    - title: The actual headline/title of the content.
    - author: The Reddit username (e.g. "HuntingSpoon"), YouTube channel name, or original content creator. Look for "by [username]", "u/[username]", or "submitted by" patterns. NEVER return "Anonymous Reddit User" or "YOUR_NAME".
    - post_date: The date the content was ORIGINALLY PUBLISHED (format: MM.DD.YYYY). 
      * Hunt for publishing labels or timestamps.
      * Use the REFERENCE DATE (${refDate}) to calculate the exact date if relative.
      * If not found, return null. DO NOT default to the current date.
    - tags: Array of 3-7 relevant keywords (e.g., ["Tool", "Prompt", "ai-chat"]).
      MANDATORY TAG RULES:
      * ALWAYS include "Tool" if content mentions software, apps, platforms, languages, or SaaS.
      * ALWAYS include "Prompt" if content discusses prompt engineering, LLM templates, or AI strategies.
      * Use lowercase for all other tags except "Tool" and "Prompt" (which are capitalized).
      * Return as an array, NOT a semicolon-separated string.
    - summary: 2-3 sentence plain-language abstract. What is this content about and what's the key takeaway? No forced structure, no emojis, no headers. Write it like a briefing note you'd skim in 5 seconds.
    - raw_text: THE FULL READABLE CONTENT. Extract all meaningful text. Hard limit: first 45,000 characters.

    IMPORTANT RULES:
    - Do NOT summarize the raw_text field.
    - Ignore UI artifacts, email signatures, or navigation boilerplate.
    - For GitHub: Prioritize README content and repository description.
    - Return JSON only.
  `;
}

/**
 * Returns the JSON schema for Gemini API responses.
 * Enforces consistent structure across all ingestion sources.
 *
 * CRITICAL: tags field is an array of strings to prevent formatting inconsistencies.
 * This ensures tags are flattened by serializeRowData() instead of containing
 * multi-line formatted text with bullets/emojis.
 *
 * @return {Object} JSON schema object for Gemini responseSchema
 */
function getGeminiResponseSchema() {
  return {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The actual headline/title of the content"
      },
      author: {
        type: "string",
        description: "The name of the original content creator"
      },
      post_date: {
        type: "string",
        description: "Original publication date in MM.DD.YYYY format, or null if not found",
        nullable: true
      },
      tags: {
        type: "array",
        items: {
          type: "string"
        },
        description: "3-7 relevant keywords as separate array items (e.g., ['Tool', 'Prompt', 'ai-chat'])"
      },
      summary: {
        type: "string",
        description: "Structured summary with bold headers and sections"
      },
      raw_text: {
        type: "string",
        description: "Full readable content, max 45,000 characters"
      },
      source: {
        type: "string",
        description: "Source platform (Reddit, YouTube, LinkedIn, etc.)"
      },
      original_url: {
        type: "string",
        description: "Original URL if different from source URL",
        nullable: true
      }
    },
    required: ["title", "author", "tags", "summary", "raw_text"]
  };
}

/**
 * Null-safe helper: returns value or null if invalid.
 * Treats string "null" as null.
 *
 * @param {any} value - Value to check
 * @return {any|null} Value or null
 */
function nullSafe(value) {
  return (value && value.toString().toLowerCase() !== 'null') ? value : null;
}

/**
 * Ensures a value is safely converted to a string for Google Sheets.
 * Prevents [Ljava.lang.Object;@... type errors.
 * 
 * @param {any} value - The value to stringify
 * @return {string} Flattened string
 */
function safeStringify(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value; // Preserve Date objects for Google Sheets formatting
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Wraps an entire row array for safe insertion into a spreadsheet.
 * 
 * @param {Array} rowArray - The array of cell values
 * @return {Array} Standardized array of strings
 */
function serializeRowData(rowArray) {
  return rowArray.map(cell => safeStringify(cell));
}

/**
 * Logs an error to the ErrorLog sheet.
 *
 * @param {string} sourceID - The source ID (e.g., EMAIL_xxx, DRIVE_xxx)
 * @param {string} errorType - Type of error (e.g., INGEST_ERROR, API_ERROR)
 * @param {string} errorMessage - The error message
 * @param {string} context - Additional context (e.g., subject line, file name)
 */
function logErrorToSheet(sourceID, errorType, errorMessage, context) {
  try {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    const errorSheet = ss.getSheetByName('ErrorLog');

    if (!errorSheet) {
      Logger.log('ErrorLog sheet not found. Skipping error logging.');
      return;
    }

    const timestamp = new Date();
    const rowData = [
      timestamp,
      sourceID || "",
      errorType || "UNKNOWN_ERROR",
      context || "",
      errorMessage || ""
    ];

    errorSheet.appendRow(rowData);
    Logger.log(`   ! Error logged to ErrorLog sheet: ${errorType}`);

  } catch (e) {
    Logger.log(`   ! Failed to log error to sheet: ${e.toString()}`);
  }
}

// ============================================================================
// SHARED CONTENT ENRICHMENT HELPERS (YouTube & Web)
// ============================================================================

/**
 * Extracts video ID from YouTube URL.
 * Handles both youtu.be and youtube.com/watch formats.
 */
function extractYouTubeVideoId(url) {
  if (!url) return null;
  try {
    // Universal YouTube ID regex
    // Handles: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/live/ID, etc.
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    
    if (match && match[1]) {
      return match[1];
    }
    
    return null;
  } catch (e) {
    Logger.log(`   Failed to extract video ID for ${url}: ${e.toString()}`);
    return null;
  }
}

/**
 * Fetches YouTube video metadata (title, author) via oEmbed API.
 */
function fetchYouTubeMetadata(url) {
  if (!url) return null;
  try {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = UrlFetchApp.fetch(oEmbedUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return null;
    const json = JSON.parse(response.getContentText());
    return { title: json.title || "", author: json.author_name || "" };
  } catch (e) {
    Logger.log(`   YouTube metadata fetch failed: ${e.toString()}`);
    return null;
  }
}

/**
 * Fetches YouTube video transcript by scraping caption tracks from video page HTML.
 * Returns transcript as plain text string.
 */
/**
 * Fetches YouTube video transcript using Gemini's Multimodal API.
 * This method is scraping-free and bypasses YouTube's bot protection.
 * It asks Gemini to "watch" the video via its URL and return the transcript.
 */
function getYoutubeTranscript(videoId) {
  if (!videoId) return null;
  
  // Start with standard flash model
  return getYoutubeTranscriptWithModel(videoId, "gemini-3-flash-preview");
}

/**
 * Helper to call the multimodal API with a specific model.
 * Includes fallback logic for long videos.
 */
function getYoutubeTranscriptWithModel(videoId, model) {
  try {
    const API_KEY = getGeminiKey();
    const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    Logger.log(`   + Calling Gemini (${model}) for transcript: ${videoId}`);

    const payload = {
      contents: [{
        parts: [
          { text: "Please provide a complete transcript of this YouTube video. Return ONLY the transcript text. No timestamps, no intro, no outro." },
          {
            fileData: {
              mimeType: "video/mp4",
              fileUri: videoUrl
            }
          }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 16384 // Increased for potentially long transcripts
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeout: 300000 // 5 minutes - maximum allowable for long video processing
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const code = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (code !== 200) {
      const errorJson = JSON.parse(responseText);
      const errorMessage = errorJson.error ? errorJson.error.message : "";
      
      // Fallback: If Flash fails due to token limit (videos > 1hr), try Pro (2M token window)
      if (code === 400 && errorMessage.includes("exceeds the maximum number of tokens") && model !== "gemini-2.5-pro") {
        Logger.log(`   ! Video exceeds Flash token limit. Falling back to Pro model for ${videoId}...`);
        return getYoutubeTranscriptWithModel(videoId, "gemini-2.5-pro");
      }
      
      Logger.log(`   ! Gemini Transcript API Failed (${model} HTTP ${code}): ${responseText}`);
      return null;
    }

    const result = JSON.parse(responseText);
    
    if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts) {
      const transcript = result.candidates[0].content.parts[0].text;
      if (transcript && transcript.length > 50) {
        Logger.log(`   ✓ Gemini (${model}) successfully transcribed video (${transcript.length} chars)`);
        return transcript.trim();
      }
    }

    return null;

  } catch (e) {
    Logger.log(`   ! Error in getYoutubeTranscriptWithModel (${model}): ${e.toString()}`);
    return null;
  }
}

/**
 * Fetches web page content and cleans HTML.
 * Uses a robust User-Agent and follows redirects.
 */
function fetchWebContent(url) {
  if (!url) return null;
  try {
    // Shared "Imposter" options
    const options = {
      muteHttpExceptions: true,
      followRedirects: true, // Important for many sites
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    
    const response = UrlFetchApp.fetch(url, options);
    
    if (response.getResponseCode() === 200) {
      return cleanHtml(response.getContentText(), 30000);
    }
    Logger.log(`   Web fetch failed for ${url}: HTTP ${response.getResponseCode()}`);
    return null;
  } catch(e) { 
    Logger.log(`   Web fetch failed for ${url}: ${e.toString()}`);
    return null; 
  }
}

// ============================================================================
// SYSTEM STATE & BACKLOG MANAGEMENT
// ============================================================================

/**
 * Checks if all ingestion sources are clear.
 * Returns true only when Email, Drive, and Link Inbox backlogs are empty.
 */
function isBacklogEmpty() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('BACKLOG_EMAIL_PENDING') !== 'true';
  const drive = props.getProperty('BACKLOG_DRIVE_PENDING') !== 'true';
  const link = props.getProperty('BACKLOG_LINK_PENDING') !== 'true';
  return email && drive && link;
}

/**
 * Sets the pending status for a specific source.
 * 
 * @param {string} source - 'EMAIL', 'DRIVE', or 'LINK'
 * @param {boolean} pending - True if items remain in the queue
 */
function setBacklogStatus(source, pending) {
  PropertiesService.getScriptProperties()
    .setProperty(`BACKLOG_${source}_PENDING`, pending ? 'true' : 'false');
}

/**
 * Gets today's date in ISO format for report tracking.
 */
function getTodayISO() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/**
 * Checks if the daily report has already been sent today.
 */
function wasReportSentToday() {
  const lastDate = PropertiesService.getScriptProperties().getProperty('LAST_REPORT_DATE');
  return lastDate === getTodayISO();
}

/**
 * Marks the daily report as sent for today.
 */
function markReportSent() {
  PropertiesService.getScriptProperties().setProperty('LAST_REPORT_DATE', getTodayISO());
}

/**
 * Checks if execution time is approaching the limit.
 * Returns true if we should stop processing and exit gracefully.
 *
 * @param {Date} startTime - The start time of the execution
 * @return {boolean} True if time limit reached
 */
function isTimeRunningOut(startTime) {
  return (new Date() - startTime) > MAX_EXECUTION_TIME_MS;
}
