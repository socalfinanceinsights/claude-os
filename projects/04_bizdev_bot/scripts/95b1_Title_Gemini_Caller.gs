/**
 * 95b1_Title_Gemini_Caller.gs
 * BD TRACKER - Title Inference Gemini API Caller
 * @execution batch
 * Version: 1.0.0
 *
 * CONTAINS:
 * - inferTitleWithGemini_: Gemini API call to infer job title
 *
 * SPLIT FROM: 95b_Enrich_Title_Gemini.gs (lines 267-355)
 * CALLED BY: 95b_Enrich_Title_Gemini.gs (enrichTitleHeadless_)
 * DEPENDENCIES: 00_Brain_Config.gs (GEMINI_API_URL)
 */

/**
 * Call Gemini API to infer job title for a person
 *
 * @param {Object} context - {name, company, linkedInUrl}
 * @param {string} apiKey - Gemini API key
 * @returns {Object} - {title: string}
 */
function inferTitleWithGemini_(context, apiKey) {
  const prompt = `Infer the most likely current job title for this person.

Person Name: ${context.name}
Company: ${context.company}
LinkedIn Profile: ${context.linkedInUrl}

INSTRUCTIONS:
1. Based on the person's name, their company, and LinkedIn profile URL slug (if available), infer their most likely current job title.
2. Focus on accounting and finance titles when context suggests that industry (common titles: Staff Accountant, Senior Accountant, Accounting Manager, Controller, Director of Finance, VP of Finance, CFO).
3. If the LinkedIn URL slug contains job-related keywords, use those as hints.
4. Return ONLY a JSON object in this exact format:
{
  "title": "inferred job title"
}

IMPORTANT:
- If you cannot determine a title with reasonable confidence, return {"title": ""}
- The title should be a standard job title, not a guess (e.g., "Senior Accountant", not "Probably an accountant")
- Return ONLY the JSON object, no explanation or additional text`;

  const url = `${GEMINI_API_URL}?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 5000
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseText = response.getContentText();
  const json = JSON.parse(responseText);

  if (!inferTitleWithGemini_.logged) {
    Logger.log('Gemini API response structure:');
    Logger.log(JSON.stringify(json, null, 2));
    inferTitleWithGemini_.logged = true;
  }

  if (json.usageMetadata) {
    Logger.log(`  Token usage: Prompt=${json.usageMetadata.promptTokenCount || 0}, Output=${json.usageMetadata.candidatesTokenCount || 0}, Thoughts=${json.usageMetadata.thoughtsTokenCount || 0}, Total=${json.usageMetadata.totalTokenCount || 0}`);
  }

  if (json.candidates && json.candidates[0] && json.candidates[0].content) {
    const text = json.candidates[0].content.parts[0].text.trim();

    try {
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleanText);

      return {
        title: result.title || ''
      };
    } catch (parseError) {
      Logger.log(`Failed to parse Gemini JSON response: ${text}`);
      return { title: '' };
    }
  }

  Logger.log('Unexpected Gemini response format:');
  Logger.log(JSON.stringify(json));
  return { title: '' };
}
