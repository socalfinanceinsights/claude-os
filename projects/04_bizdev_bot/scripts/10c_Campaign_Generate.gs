/**
 * 10c_Campaign_Generate.gs
 * @execution manual
 * Multi-channel campaign copy generation via Claude API
 * Input: context object with candidate teaser, HM data, intel, cadence steps, prompt rules
 * Output: array of 8 touch objects
 */

/**
 * Generate multi-channel campaign copy for one HM via Claude API
 * @param {Object} context - Campaign generation context
 * @returns {Array} - Array of 8 touch objects
 */
function generateCampaignCopy(context) {
  // Build system prompt by concatenating prompt rules
  var systemParts = [context.generationPrompt];
  if (context.voiceRules) systemParts.push('\n\n--- VOICE RULES ---\n' + context.voiceRules);
  if (context.formatConstraints) systemParts.push('\n\n--- FORMAT CONSTRAINTS ---\n' + context.formatConstraints);
  if (context.mpcStrategy) systemParts.push('\n\n--- MPC STRATEGY ---\n' + context.mpcStrategy);
  if (context.linkedinRules) systemParts.push('\n\n--- LINKEDIN RULES ---\n' + context.linkedinRules);
  if (context.mpcComponents) systemParts.push('\n\n--- MPC COMPONENTS (reference examples) ---\n' + context.mpcComponents);
  var systemPrompt = systemParts.join('');

  // Build user prompt
  var userParts = [];
  userParts.push('CANDIDATE TEASER:\n' + context.candidateTeaser);
  userParts.push('\nHIRING MANAGER:\nName: ' + context.hmName + '\nFirst Name: ' + context.hmFirstName + '\nTitle: ' + context.hmTitle + '\nCompany: ' + context.company + '\nDomain: ' + context.companyDomain);

  // Market intel
  if (context.marketIntel && context.marketIntel.summary) {
    userParts.push('\nMARKET INTELLIGENCE:\n' + context.marketIntel.summary);
    if (context.marketIntel.events && context.marketIntel.events.length > 0) {
      var eventLines = [];
      for (var e = 0; e < context.marketIntel.events.length; e++) {
        var evt = context.marketIntel.events[e];
        eventLines.push('- [' + evt.event_type + '] ' + evt.headline + ' — ' + evt.recruiting_angle);
      }
      userParts.push(eventLines.join('\n'));
    }
  }

  // Cadence structure
  userParts.push('\nCADENCE STRUCTURE (8 touches):');
  for (var s = 0; s < context.cadenceSteps.length; s++) {
    var step = context.cadenceSteps[s];
    userParts.push('Step ' + step.step_no + ': Day ' + step.day + ' | ' + step.channel + ' | ' + step.purpose);
  }

  // LinkedIn routing
  var linkedinRouting = context.firstDegree === 'Yes' ? 'InMail (1st-degree connection)' : 'Connection Request + DM';
  userParts.push('\nLINKEDIN ROUTING: ' + linkedinRouting);

  // Mark's contact info
  userParts.push('\nSENDER INFO:\nName: YOUR_NAME\nEmail: your.email@example.com\nPhone: (555) 555-5555\nBooking: YOUR_BOOKING_URL');

  // Output format
  userParts.push('\nREQUIRED OUTPUT FORMAT (JSON only, no additional text):\n{\n  "touches": [\n    {\n      "step_no": 1,\n      "channel": "Email|Call|LinkedIn",\n      "subject": "email subject or empty for Call/LinkedIn",\n      "body": "message body text",\n      "cta": "call to action",\n      "vm_briefing_card": null\n    }\n  ]\n}\n\nRULES:\n- Email body: ready-to-send, signed "YOUR_NAME\\nYour Company Name"\n- Call touches: vm_briefing_card with HM context, previous touch summary, candidate pitch points, Mark contact info, post-call action\n- LinkedIn Connection Request: body under 300 chars\n- LinkedIn InMail: body up to 1900 chars\n- Must produce exactly 8 touches matching the cadence structure above\n- Channels must match cadence structure exactly');

  var userPrompt = userParts.join('\n');

  // Call Claude API (callClaudeForCampaign_ from 10a via global namespace)
  try {
    var responseText = callClaudeForCampaign_(systemPrompt, userPrompt, 8192);
    var parsed = JSON.parse(responseText);

    if (!parsed.touches || !Array.isArray(parsed.touches)) {
      throw new Error('Response missing touches array');
    }

    if (parsed.touches.length !== 8) {
      logCampaignError('Expected 8 touches, got ' + parsed.touches.length + '. Proceeding with available touches.');
    }

    // Validate channels match cadence
    for (var i = 0; i < parsed.touches.length; i++) {
      var touch = parsed.touches[i];
      if (i < context.cadenceSteps.length) {
        var expectedChannel = context.cadenceSteps[i].channel;
        if (touch.channel !== expectedChannel) {
          logCampaignError('Touch ' + (i + 1) + ' channel mismatch: expected ' + expectedChannel + ', got ' + touch.channel + '. Correcting.');
          touch.channel = expectedChannel;
        }
      }
    }

    logCampaignAction('Campaign copy generated for ' + context.hmName + ': ' + parsed.touches.length + ' touches');
    return parsed.touches;

  } catch (error) {
    logCampaignError('Campaign copy generation failed for ' + context.hmName + ': ' + error.message);
    throw error;
  }
}
