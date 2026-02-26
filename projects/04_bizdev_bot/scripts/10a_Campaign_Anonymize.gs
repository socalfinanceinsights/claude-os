/**
 * 10a_Campaign_Anonymize.gs
 * @execution manual
 * Candidate anonymization via Claude API
 * Input: full candidate writeup + prompt text from Prompt_Config
 * Output: 150-250 word MPC teaser
 */

/**
 * Anonymize a candidate writeup into an MPC teaser via Claude API
 * @param {string} writeup - Full candidate writeup
 * @param {string} anonymizationPrompt - Prompt text from Prompt_Config
 * @returns {string} - Anonymized teaser text
 */
function anonymizeCandidate(writeup, anonymizationPrompt) {
  if (!writeup || !writeup.trim()) {
    throw new Error('Candidate writeup is required for anonymization');
  }

  // If writeup looks like it's already a teaser (under 300 words), use as-is
  var wordCount = writeup.trim().split(/\s+/).length;
  if (wordCount < 300) {
    logCampaignAction('Writeup appears to be pre-anonymized (under 300 words). Using as-is.');
    return writeup.trim();
  }

  try {
    var result = callClaudeForCampaign_(anonymizationPrompt, writeup, 2048);
    logCampaignAction('Candidate anonymization complete');
    return result;
  } catch (error) {
    logCampaignError('Anonymization failed: ' + error.message);
    throw error;
  }
}

/**
 * Call Claude API for campaign operations (shared helper)
 * Used by 10a (anonymization) and 10c (generation)
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - User message
 * @param {number} maxTokens - Max tokens for response
 * @returns {string} - Response text from Claude
 */
function callClaudeForCampaign_(systemPrompt, userMessage, maxTokens) {
  var apiKey = getClaudeAPIKey();
  if (!apiKey) {
    throw new Error('Claude API key not configured. Add CLAUDE_API_KEY to Script Properties.');
  }

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens || 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage
      }
    ]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var lastError = null;

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
      var responseCode = response.getResponseCode();

      if (responseCode !== 200) {
        lastError = new Error('Claude API error ' + responseCode + ': ' + response.getContentText());
        logCampaignError('Claude API attempt ' + attempt + ' failed: ' + responseCode);
        if (attempt < 3) {
          Utilities.sleep(2000);
          continue;
        }
        throw lastError;
      }

      var result = JSON.parse(response.getContentText());

      if (!result.content || result.content.length === 0) {
        throw new Error('Empty response from Claude API');
      }

      var text = result.content[0].text;

      // Strip markdown code blocks if present
      if (text.startsWith('```json')) {
        text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (text.startsWith('```')) {
        text = text.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }

      return text;

    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        logCampaignError('Claude API attempt ' + attempt + ' failed, retrying...');
        Utilities.sleep(2000);
      }
    }
  }

  throw lastError || new Error('Failed to get response from Claude API after 3 attempts');
}
