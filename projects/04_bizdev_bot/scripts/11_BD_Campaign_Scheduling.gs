/**
 * 11_BD_Campaign_Scheduling.gs
 * @execution manual
 * Schedule Google Calendar events for campaign touches
 * 8 events per HM across multiple channels (Email/Call/LinkedIn)
 * Separate menu action from campaign creation
 */

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Schedule campaign events (called from menu)
 */
function scheduleCampaignEvents() {
  var ui = SpreadsheetApp.getUi();

  // Get active campaigns
  var campaigns = getActiveCampaigns_();

  if (campaigns.length === 0) {
    ui.alert('No Campaigns', 'No active campaigns found to schedule.', ui.ButtonSet.OK);
    return;
  }

  // Show selection dialog
  var message = 'Select a campaign to schedule:\n\n' + campaigns.map(function(c, i) { return (i + 1) + '. ' + c; }).join('\n');
  var response = ui.prompt('Schedule Campaign Events', message, ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var selection = parseInt(response.getResponseText());
  if (isNaN(selection) || selection < 1 || selection > campaigns.length) {
    ui.alert('Invalid Selection', 'Please enter a valid campaign number.', ui.ButtonSet.OK);
    return;
  }

  var campaignID = campaigns[selection - 1];

  // Get campaign start date
  var startDate = getCampaignStartDate_(campaignID);
  if (!startDate) {
    ui.alert('Error', 'No Start_Date found for campaign: ' + campaignID, ui.ButtonSet.OK);
    return;
  }

  // Get all Campaign_Drafts for this campaign, grouped by HM
  var hmDrafts = getCampaignDrafts_(campaignID);
  var hmKeys = Object.keys(hmDrafts);

  if (hmKeys.length === 0) {
    ui.alert('No Drafts', 'No campaign drafts found for: ' + campaignID, ui.ButtonSet.OK);
    return;
  }

  // Load cadence config (cached for day lookups)
  var cadenceCache = loadCadenceCache_();

  // Load BD_Contacts data for HM details
  var bdData = loadBDContactsData_();

  // Batch chunking: process 15 HMs at a time
  var chunkSize = 15;
  var totalEvents = 0;
  var totalHMs = 0;
  var errors = [];

  for (var chunkStart = 0; chunkStart < hmKeys.length; chunkStart += chunkSize) {
    // If not the first chunk, ask to continue
    if (chunkStart > 0) {
      var continueResponse = ui.alert(
        'Continue Scheduling?',
        'Scheduled ' + totalHMs + ' HMs (' + totalEvents + ' events). ' + (hmKeys.length - chunkStart) + ' HMs remaining. Continue?',
        ui.ButtonSet.YES_NO
      );
      if (continueResponse !== ui.Button.YES) break;
    }

    var chunkEnd = Math.min(chunkStart + chunkSize, hmKeys.length);

    for (var h = chunkStart; h < chunkEnd; h++) {
      var hmKey = hmKeys[h];
      var drafts = hmDrafts[hmKey];

      try {
        var eventsCreated = scheduleEventsForHM_(campaignID, drafts, startDate, cadenceCache, bdData);
        totalEvents += eventsCreated;
        totalHMs++;
      } catch (hmError) {
        logCampaignError('Scheduling error for ' + hmKey + ': ' + hmError.message);
        errors.push(hmKey + ': ' + hmError.message);
      }
    }
  }

  // Summary
  var summary = 'Calendar Events Created\n\n';
  summary += 'Campaign: ' + campaignID + '\n';
  summary += totalHMs + ' hiring managers\n';
  summary += totalEvents + ' events scheduled\n';

  if (errors.length > 0) {
    summary += '\n' + errors.length + ' errors:\n' + errors.slice(0, 5).join('\n');
    if (errors.length > 5) summary += '\n... and ' + (errors.length - 5) + ' more';
  }

  ui.alert('Events Scheduled', summary, ui.ButtonSet.OK);
  logCampaignAction('Campaign scheduled: ' + campaignID + ' — ' + totalHMs + ' HMs, ' + totalEvents + ' events');
}

// ============================================================================
// PER-HM SCHEDULING
// ============================================================================

/**
 * Schedule 8 calendar events for one HM
 * @param {string} campaignID
 * @param {Array} drafts - 8 Campaign_Drafts rows for this HM
 * @param {Date} startDate - Campaign start date
 * @param {Object} cadenceCache - Cadence config cache
 * @param {Object} bdData - BD_Contacts data
 * @returns {number} - Number of events created
 */
function scheduleEventsForHM_(campaignID, drafts, startDate, cadenceCache, bdData) {
  // Sort by Touch_No
  drafts.sort(function(a, b) { return a.touchNo - b.touchNo; });

  var calendar = CalendarApp.getDefaultCalendar();
  var eventsCreated = 0;

  // Get BD_Contacts data for this HM (for title, company, firstDegree)
  var hmKey = drafts[0].hmCompositeKey;
  var bdContact = bdData[hmKey] || {};

  for (var d = 0; d < drafts.length; d++) {
    var draft = drafts[d];

    // Look up day offset from cadence config
    var dayOffset = getCadenceDayOffset_(cadenceCache, draft.variantId, draft.touchNo);
    var timeSlot = getCadenceTimeSlot_(cadenceCache, draft.variantId, draft.touchNo);
    var displayLabel = draft.displayLabel || ('Touch ' + draft.touchNo + ' - ' + draft.channel);

    // Calculate event date
    var eventDate = new Date(startDate);
    eventDate.setDate(eventDate.getDate() + (dayOffset - 1)); // Day 1 = start date

    // Parse time slot
    var eventStart = parseTimeSlot_(timeSlot, eventDate);

    // Create event based on channel
    if (draft.channel === 'Email') {
      createEmailCalendarEvent_(calendar, campaignID, draft, bdContact, displayLabel, eventStart);
    } else if (draft.channel === 'Call') {
      createCallCalendarEvent_(calendar, campaignID, draft, bdContact, displayLabel, eventStart);
    } else if (draft.channel === 'LinkedIn') {
      createLinkedInCalendarEvent_(calendar, campaignID, draft, bdContact, displayLabel, eventStart);
    }

    eventsCreated++;
  }

  return eventsCreated;
}

// ============================================================================
// CALENDAR EVENT CREATORS
// ============================================================================

/**
 * Create email calendar event (Blue, 30 min)
 */
function createEmailCalendarEvent_(calendar, campaignID, draft, bdContact, displayLabel, eventStart) {
  var title = displayLabel + ' — ' + draft.hmName + ' @ ' + (bdContact.company || '');

  var endTime = new Date(eventStart);
  endTime.setMinutes(endTime.getMinutes() + 30);

  // Build mailto link
  var mailtoSubject = encodeURIComponent(draft.subject || '');
  var mailtoBody = encodeURIComponent(draft.body || '');
  var mailtoLink = 'mailto:' + (draft.toEmail || '') + '?subject=' + mailtoSubject + '&body=' + mailtoBody;

  var description = mailtoLink + '\n\n---\n';
  description += 'Campaign: ' + campaignID + '\n';
  description += 'To: ' + (draft.toEmail || '') + '\n';
  description += 'Subject: ' + (draft.subject || '') + '\n\n';
  description += (draft.body || '') + '\n\n';
  description += (draft.cta || '');

  var event = calendar.createEvent(title, eventStart, endTime, {
    description: description,
    guests: 'your.email@example.com',
    sendInvites: false
  });

  event.setColor(CalendarApp.EventColor.BLUE);
}

/**
 * Create call calendar event (Orange, 15 min) with VM briefing card
 */
function createCallCalendarEvent_(calendar, campaignID, draft, bdContact, displayLabel, eventStart) {
  var title = displayLabel + ' — ' + draft.hmName + ' @ ' + (bdContact.company || '');

  var endTime = new Date(eventStart);
  endTime.setMinutes(endTime.getMinutes() + 15);

  // Use VM_Briefing_Card from drafts if available, otherwise build basic one
  var description = draft.vmBriefingCard;

  if (!description || description.trim() === '') {
    description = 'BRIEFING CARD\n';
    description += 'HM: ' + draft.hmName + ', ' + (bdContact.title || '') + ' @ ' + (bdContact.company || '') + '\n';
    description += 'Phone: ' + (draft.phoneNumber || '') + '\n\n';
    description += 'Candidate Pitch: See campaign teaser in BD_Campaigns\n\n';
    description += 'Post-Call: Send follow-up (see next calendar event)\n\n';
    description += 'Mark\'s Info:\n';
    description += '- Phone: (555) 555-5555\n';
    description += '- Email: your.email@example.com\n';
    description += '- Booking: YOUR_BOOKING_URL';
  }

  var event = calendar.createEvent(title, eventStart, endTime, {
    description: description,
    guests: 'your.email@example.com',
    sendInvites: false
  });

  event.setColor(CalendarApp.EventColor.ORANGE);
}

/**
 * Create LinkedIn calendar event (Green, 15 min) with profile URL and routing
 */
function createLinkedInCalendarEvent_(calendar, campaignID, draft, bdContact, displayLabel, eventStart) {
  var title = displayLabel + ' — ' + draft.hmName + ' @ ' + (bdContact.company || '');

  var endTime = new Date(eventStart);
  endTime.setMinutes(endTime.getMinutes() + 15);

  var firstDegree = bdContact.firstDegree || '';
  var routing = firstDegree === 'Yes' ? 'InMail (1st-degree connection)' : 'Connection Request + DM';

  var description = 'LinkedIn Profile: ' + (draft.linkedinUrl || '') + '\n';
  description += 'Routing: ' + routing + '\n\n';
  description += '---\n';
  description += (draft.body || '') + '\n\n';
  description += (draft.cta || '');

  var event = calendar.createEvent(title, eventStart, endTime, {
    description: description,
    guests: 'your.email@example.com',
    sendInvites: false
  });

  event.setColor(CalendarApp.EventColor.GREEN);
}

// Data helpers moved to 11a_Campaign_Schedule_Helpers.gs:
// getActiveCampaigns_, getCampaignStartDate_, getCampaignDrafts_,
// loadBDContactsData_, loadCadenceCache_, getCadenceDayOffset_,
// getCadenceTimeSlot_, parseTimeSlot_
