/**
 * MINING AGENT - Extract Tools and Prompts from Master List
 * Model: Gemini 3 Flash Preview
 * 
 * This script processes rows from PostMasterList and extracts:
 * - Tools (software, platforms, languages)
 * - Prompts (AI prompt templates and workflows)
 * 
 * Uses Smart Resume to continue from last unprocessed row.
 */

// ============================================================================
// MINING-SPECIFIC CONFIGURATION
// ============================================================================

const BATCH_SIZE = 2; // Reduced to 2 based on observed 2.3 min/entry avg (prevents 6-minute timeout)
const SOURCE_SHEET_NAME = 'PostMasterList';
const TOOL_SHEET_NAME = 'ToolLibrary';
const PROMPT_SHEET_NAME = 'PromptLibrary';
const MINING_GEMINI_MODEL = 'gemini-3-flash-preview';

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main function to process rows and extract Tools AND Prompts using Gemini AI.
 * Uses "Smart Resume" by finding the first empty ProcessedDate.
 */
function mineUnifiedMasterList() {
  const API_KEY = getGeminiKey();
  
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const sourceSheet = ss.getSheetByName(SOURCE_SHEET_NAME);
  const toolSheet = ss.getSheetByName(TOOL_SHEET_NAME);
  const promptSheet = ss.getSheetByName(PROMPT_SHEET_NAME);

  if (!sourceSheet || !toolSheet || !promptSheet) {
    Logger.log("Error: Target or Source sheet not found.");
    return;
  }

  // Map columns
  const headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues()[0];
  const colMap = mapHeaders(headers);

  // Validate required columns
  if (colMap.SourceID === -1 || colMap.RawText === -1 || colMap.ProcessedDate === -1) {
    Logger.log("Error: Required columns (SourceID, Raw Text, or ProcessedDate) missing.");
    return;
  }

  // Smart Resume: Find first empty ProcessedDate
  const lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("Sheet is empty (only headers). Nothing to mine.");
    return;
  }
  
  const processedData = sourceSheet.getRange(2, colMap.ProcessedDate + 1, lastRow - 1, 1).getValues();
  
  let startRow = -1;
  for (let i = 0; i < processedData.length; i++) {
    if (processedData[i][0] === "") {
      startRow = i + 2; // +2 because sheet is 1-indexed and we started at row 2
      break;
    }
  }

  if (startRow === -1) {
    Logger.log("All rows have a ProcessedDate. Nothing new to mine.");
    return;
  }

  const numRows = Math.min(BATCH_SIZE, lastRow - startRow + 1);
  const dataRange = sourceSheet.getRange(startRow, 1, numRows, sourceSheet.getLastColumn());
  const rows = dataRange.getValues();

  Logger.log(`Smart Resume: Starting at Row ${startRow}. Processing batch of ${numRows} rows...`);

  // Process each row
  rows.forEach((row, index) => {
    const currentRowIndex = startRow + index;
    const sourceID = row[colMap.SourceID];
    const typeValue = colMap.Type !== -1 ? String(row[colMap.Type]).toLowerCase() : "";
    const tagsValue = colMap.Tags !== -1 ? String(row[colMap.Tags]).toLowerCase() : "";
    // Clean raw text upfront (strips Reddit UI boilerplate, HTML artifacts, etc.)
    // deepCleanRawText() defined in 07_Notebook_Manager.gs, shared via Apps Script global namespace
    const rawText = deepCleanRawText(row[colMap.RawText]);
    const summaryThesis = colMap.Summary !== -1 ? row[colMap.Summary] : "";

    // Filter Logic: Check for 'tool' or 'prompt' keywords
    const hasToolKeyword = 
      typeValue.includes('tool') || 
      tagsValue.includes('tool') || 
      String(summaryThesis).toLowerCase().includes('tool') || 
      String(rawText).toLowerCase().includes('tool');

    const hasPromptKeyword = 
      typeValue.includes('prompt') || 
      tagsValue.includes('prompt') || 
      String(summaryThesis).toLowerCase().includes('prompt') || 
      String(rawText).toLowerCase().includes('prompt');

    if (!hasToolKeyword && !hasPromptKeyword) {
      Logger.log(`Skipping Row ${currentRowIndex}: No 'tool' or 'prompt' keywords.`);
      markRowProcessed(sourceSheet, currentRowIndex, colMap.ProcessedDate);
      return;
    }

    const combinedText = `SUMMARY/THESIS: ${summaryThesis}\n\nRAW TEXT: ${rawText}`;
    if (!combinedText || combinedText.trim() === "") {
      markRowProcessed(sourceSheet, currentRowIndex, colMap.ProcessedDate);
      return;
    }

    // TOOL EXTRACTION
    if (hasToolKeyword) {
      Logger.log(`Row ${currentRowIndex}: Detection [TOOL]`);
      const tools = callGeminiAPI_Tools(combinedText, API_KEY);
      if (tools && Array.isArray(tools)) {
        tools.forEach(tool => {
          if (isToolDuplicate(toolSheet, sourceID, tool.Tool_Name, tool.UseCase, API_KEY)) {
            Logger.log(`  > Skipping Duplicate Tool: ${tool.Tool_Name}`);
            return;
          }
          const toolID = generateToolID(toolSheet, tool.Tool_Name);
          toolSheet.appendRow(serializeRowData([sourceID, toolID, tool.Tool_Name, tool.UseCase, tool.Example, new Date()]));
        });
      }
    }

    // PROMPT EXTRACTION
    if (hasPromptKeyword) {
      Logger.log(`Row ${currentRowIndex}: Detection [PROMPT]`);
      const prompts = callGeminiAPI_Prompts(combinedText, API_KEY);
      if (prompts && Array.isArray(prompts)) {
        prompts.forEach(p => {
          // Fuzzy Deduplication (75% Match)
          if (isPromptDuplicate(promptSheet, p.CleanPrompt)) {
            Logger.log(`  > Skipping Duplicate Prompt: Similar to existing entry.`);
            return;
          }

          const promptID = generatePromptID(promptSheet, sourceID);

          // Explicitly stringify prompt fields to prevent object/array leakage
          const rawPromptStr = String(p.RawPrompt || "");
          const cleanPromptStr = String(p.CleanPrompt || "");

          promptSheet.appendRow(serializeRowData([
            promptID,
            sourceID,
            rawPromptStr,
            cleanPromptStr,
            p.UseCase,
            `${p.PromptTitle} - ${p.PromptSummary}`,
            p.Tags,
            new Date()
          ]));
        });
      }
    }

    // Mark row as processed
    markRowProcessed(sourceSheet, currentRowIndex, colMap.ProcessedDate);
  });
  
  Logger.log("Batch complete.");
}

// ============================================================================
// GEMINI API CALLS
// ============================================================================

/**
 * Calls Gemini API to extract TOOL data.
 */
function callGeminiAPI_Tools(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MINING_GEMINI_MODEL}:generateContent?key=${apiKey}`;
  
  const systemPrompt = "You are a Technical Resource Analyst. Extract structured tool data. Rules: Include languages (Python, SQL), platforms (LinkedIn), and specific software.";

  const schema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        Tool_Name: { type: "STRING" },
        UseCase: { type: "STRING" },
        Example: { type: "STRING" }
      },
      required: ["Tool_Name", "UseCase", "Example"]
    }
  };
  
  const payload = {
    contents: [{
      role: "user",
      parts: [{
        text: `${systemPrompt}\n\nContent to analyze:\n${text}`
      }]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);
    
    if (json.error) {
      Logger.log("API Error: " + json.error.message);
      return null;
    }

    if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) {
      let resultText = json.candidates[0].content.parts[0].text;
      Logger.log("Raw AI Response: " + resultText);
      return safeJsonParse(resultText);
    } else {
      Logger.log("No valid response parts from Gemini. Full Response: " + responseText);
    }
  } catch (e) {
    Logger.log("Network or Unexpected Error: " + e.toString());
  }
  return null;
}

/**
 * Calls Gemini API to extract PROMPT data.
 */
function callGeminiAPI_Prompts(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MINING_GEMINI_MODEL}:generateContent?key=${apiKey}`;
  
  const systemPrompt = `
    You are a PromptLibrary extractor. Extract *one object per distinct prompt* found in the text.
    
    GOAL: Extract structured data for a Prompt Library.
    
    FIELDS TO EXTRACT:
    - RawPrompt: The full, copy-pastable prompt text. Preserve wording.
    - CleanPrompt: A version optimized for ChatGPT (remove fluff).
    - PromptTitle: Short, human-readable label (max 80 chars).
    - PromptSummary: 1-2 sentence description of what it produces.
    - UseCase: Short phrase describing WHEN to use this (e.g., "Explore adjacent job titles").
    - Variables: Semicolon-separated list of placeholders (e.g., "resume_text;target_titles").
    - Tags: 3-8 semicolon-separated lowercase tags (e.g., "job_search;prompts").
    - Author: Name of the author if visible, or "Unknown".
    
    RULES:
    - If a list contains *distinct* prompts, create separate objects.
    - If a post is a *single workflow*, keep it as one RawPrompt.
    - Do NOT invent prompts.
    - If no prompts are found, return an empty list.
  `;

  const schema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        RawPrompt: { type: "STRING" },
        CleanPrompt: { type: "STRING" },
        PromptTitle: { type: "STRING" },
        PromptSummary: { type: "STRING" },
        UseCase: { type: "STRING" },
        Variables: { type: "STRING" },
        Tags: { type: "STRING" },
        Author: { type: "STRING" }
      },
      required: ["RawPrompt", "CleanPrompt", "UseCase", "Tags"]
    }
  };
  
  const payload = {
    contents: [{
      role: "user",
      parts: [{
        text: `${systemPrompt}\n\nContent to analyze:\n${text}`
      }]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) {
      let resultText = json.candidates[0].content.parts[0].text;
      return safeJsonParse(resultText);
    }
  } catch (e) {
    Logger.log("Error calling Gemini API for Prompts: " + e.toString());
  }
  return null;
}

// ============================================================================
// MINING-SPECIFIC HELPERS
// ============================================================================

/**
 * Marks a row as processed in the source sheet.
 */
function markRowProcessed(sheet, rowIndex, colIndex) {
  sheet.getRange(rowIndex, colIndex + 1).setValue(new Date());
}

/**
 * Generates a ToolID by checking existing entries in ToolLibrary.
 * Format: ToolName_001
 */
function generateToolID(sheet, toolName) {
  if (!toolName) return "Unknown_000";
  
  const cleanName = toolName.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
  const data = sheet.getDataRange().getValues();
  let maxCount = 0;

  // Search ToolID column (Col B / Index 1)
  for (let i = 1; i < data.length; i++) {
    const existingID = String(data[i][1]);
    if (existingID.startsWith(cleanName + "_")) {
      const parts = existingID.split("_");
      const count = parseInt(parts[parts.length - 1]);
      if (!isNaN(count) && count > maxCount) {
        maxCount = count;
      }
    }
  }

  const nextCount = (maxCount + 1).toString().padStart(3, '0');
  return `${cleanName}_${nextCount}`;
}

/**
 * Generates a PromptID based on SourceID.
 * Pattern: REDDIT_111525_003 -> REDDITPROMPT_111525_XXX
 */
function generatePromptID(sheet, sourceID) {
  const parts = sourceID.split('_');
  if (parts.length < 2) return `PROMPT_${new Date().getTime()}`;

  const prefix = parts[0];
  const dateStr = parts[1];
  
  const targetPrefix = `${prefix}PROMPT_${dateStr}_`;
  
  const data = sheet.getDataRange().getValues();
  let maxCount = 0;

  // Search PromptID column (Col A / Index 0)
  for (let i = 1; i < data.length; i++) {
    const existingID = String(data[i][0]);
    if (existingID.startsWith(targetPrefix)) {
      const idParts = existingID.split('_');
      const count = parseInt(idParts[idParts.length - 1]);
      if (!isNaN(count) && count > maxCount) {
        maxCount = count;
      }
    }
  }

  const nextCount = (maxCount + 1).toString().padStart(3, '0');
  return `${targetPrefix}${nextCount}`;
}

/**
 * Checks if a tool is a duplicate.
 * 1. Strict: Same SourceID + Same Name
 * 2. Semantic: Same Name + Similar UseCase (via Gemini)
 */
function isToolDuplicate(sheet, sourceID, toolName, newUseCase, apiKey) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;

  const cleanName = toolName.toLowerCase().trim();
  const cleanSourceID = String(sourceID).toLowerCase().trim();
  
  const existingUseCases = [];

  // Col A: SourceID (0), Col C: Tool_Name (2), Col D: UseCase (3)
  for (let i = 1; i < data.length; i++) {
    const existingSourceID = String(data[i][0]).toLowerCase().trim();
    const existingToolName = String(data[i][2]).toLowerCase().trim();
    const existingUseCase = String(data[i][3]);

    // Check 1: Strict Dupe (Same Post)
    if (existingSourceID === cleanSourceID && existingToolName === cleanName) {
      return true;
    }
    
    // Collect use cases for Semantic Check
    if (existingToolName === cleanName) {
      existingUseCases.push(existingUseCase);
    }
  }

  // Check 2: Semantic Dupe (Same Tool, Similar Use Case)
  if (existingUseCases.length > 0) {
    return checkSemanticDuplicate(newUseCase, existingUseCases, apiKey);
  }

  return false;
}

/**
 * Uses Gemini to check if a new use case matches any existing ones.
 */
function checkSemanticDuplicate(newUseCase, existingUseCases, apiKey) {
  // Limit existing cases to avoid token overflow
  const recentCases = existingUseCases.slice(-20); 
  
  const prompt = `
    I have a tool with a new use case: "${newUseCase}".
    Here is a list of existing use cases for this same tool:
    ${JSON.stringify(recentCases)}
    
    Does the new use case describe the same fundamental functionality or activity as ANY of the existing ones? 
    Ignore minor wording differences. "Sourcing candidates" and "Finding talent" ARE the same.
    
    Return ONLY JSON: {"isDuplicate": boolean}
  `;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MINING_GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    if (json.candidates && json.candidates[0].content.parts[0].text) {
      const result = JSON.parse(json.candidates[0].content.parts[0].text);
      return result.isDuplicate;
    }
  } catch (e) {
    Logger.log("Error in semantic check: " + e.toString());
  }
  return false;
}

/**
 * Checks if a Prompt is a duplicate using Fuzzy Matching (75% similarity).
 */
function isPromptDuplicate(sheet, newPromptText) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;

  const cleanNew = newPromptText.toLowerCase().trim();
  
  // Search CleanPrompt column (Col D / Index 3)
  for (let i = 1; i < data.length; i++) {
    const existingPrompt = String(data[i][3]).toLowerCase().trim();
    
    // 1. Exact Match
    if (existingPrompt === cleanNew) return true;

    // 2. Fuzzy Match (Dice Coefficient)
    const similarity = calculateSimilarity(cleanNew, existingPrompt);
    if (similarity >= 0.75) {
      return true;
    }
  }
  return false;
}

/**
 * Calculates Dice Coefficient similarity between two strings (0.0 to 1.0).
 * Good for comparing text overlap.
 */
function calculateSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const bigrams1 = new Set();
  for (let i = 0; i < s1.length - 1; i++) {
    bigrams1.add(s1.substring(i, i + 2));
  }

  const bigrams2 = new Set();
  for (let i = 0; i < s2.length - 1; i++) {
    bigrams2.add(s2.substring(i, i + 2));
  }

  let intersection = 0;
  bigrams1.forEach(bg => {
    if (bigrams2.has(bg)) intersection++;
  });

  return (2.0 * intersection) / (bigrams1.size + bigrams2.size);
}