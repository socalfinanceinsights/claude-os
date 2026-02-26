/**
 * 13a_SDI_Prompts.gs
 * SDI Scout - Gemini Prompt Builders & Validation Helpers
 * @execution manual
 * Version: 1.0.0
 *
 * PURPOSE: All SDI Gemini prompt builder functions and subtype validation helpers.
 * SPLIT FROM: 13_SDI_Config.gs (lines 139-310)
 * DEPENDENCIES: 13_SDI_Config.gs (SDI_CONFIG, VALID_EVENT_TYPES, VALID_SUBTYPES, CONFIG)
 * CALLED BY: 14_SDI_Engine.gs, 14a_SDI_Ranked.gs, and other SDI pipeline files
 */

// ============================================
// GEMINI PROMPT BUILDERS
// ============================================

/**
 * Build prompt for Gemini to generate Serper search queries from a candidate profile
 * @param {string} candidateProfile - Free-text candidate profile
 * @param {string} geo - Geographic focus (default: Southern California)
 * @param {number} timeWindowDays - Lookback window
 * @returns {string} - Gemini prompt
 */
function buildQueryGenerationPrompt_(candidateProfile, geo, timeWindowDays) {
  return `You are helping a recruiter find BD targets — companies that might need to hire accounting/finance talent soon.

CANDIDATE PROFILE:
${candidateProfile}

GEOGRAPHIC FOCUS: ${geo || SDI_CONFIG.defaultGeo}
TIME WINDOW: Last ${timeWindowDays || SDI_CONFIG.defaultTimeWindowDays} days

Generate 5 Google search queries that find COMPANY-LEVEL HIRING ACTIVITY — not specific job postings.

GOOD QUERIES (what Serper finds reliably):
- "[industry] companies hiring [region] 2026"
- "SaaS startup headcount growth Orange County"
- "PE backed companies expanding Los Angeles"
- "series B startup engineering hiring San Diego"
- site:linkedin.com "[company type]" "we're hiring"
- "[industry] funding announcement [region] 2026"

BAD QUERIES (too specific, Serper won't find):
- "Senior Accountant NetSuite posting" (buried on career pages)
- "Controller CPA Orange County job" (needle in haystack)

KEY INSIGHT: The recruiter's advantage is calling BEFORE the finance posting exists. Engineering surges, sales buildouts, and funding rounds predict finance hiring need 3-6 months out. Search for those leading indicators.

Based on the candidate's background (industry, skills, level), generate queries targeting companies in similar industries/stages that show growth signals.

Return ONLY a JSON array of 5 query strings. No explanation.
Example: ["query 1", "query 2", "query 3", "query 4", "query 5"]`;
}

/**
 * Build prompt for Gemini to extract structured signals from Serper results
 * @param {Array} serperResults - Array of {title, link, snippet, date} objects
 * @returns {string} - Gemini prompt
 */
function buildExtractionPrompt_(serperResults) {
  const resultsJson = JSON.stringify(serperResults, null, 0);

  return `You are extracting company hiring and growth signals from web search results for a recruiter specializing in Accounting & Finance in Southern California.

SEARCH RESULTS:
${resultsJson}

For each result that contains a meaningful company signal, extract:
{
  "company_name": "Company Name",
  "domain": "rootdomain.com (if visible in URL or text, otherwise leave blank)",
  "event_type": "Jobs|Leadership|Infra/Compliance|Capital",
  "subtype": "must match one of the valid subtypes below",
  "event_date": "YYYY-MM-DD (best estimate from article date or context)",
  "source_url": "full URL from the search result",
  "notes": "1-2 sentence summary of the signal. Include: role counts, departments, tech stacks (NetSuite, SAP, etc), remote policy if mentioned.",
  "approach_context": "1-2 sentence pitch angle for the recruiter. How would they use this signal to open a conversation about finance/accounting hiring?"
}

VALID SUBTYPES:
Jobs: Engineering/Product Surge | Sales/GTM Surge | Multi-Department Hiring | Finance/Accounting Direct | General Hiring Activity
Leadership: CFO/Controller/Head FP&A | VP/Director Finance | COO/CHRO/People/Ops | VP Sales/Product/Eng
Infra/Compliance: IPO Preparation/S-1 Filing | SOC2/FedRAMP/HITRUST | ISO27001/PCI/SOX/ERP go-live | ERP Migration/Implementation | Audit Firm Change/First Audit | Minor security/privacy
Capital: Seed/Angel | Series A | Series B | Series C+ | PE/Growth Equity | IPO | M&A/Acquisition | Debt/Credit Facility

CLASSIFICATION RULES:
- Engineering/Product Surge = 5+ eng/product roles found. LEADING indicator of finance need.
- Sales/GTM Surge = 5+ sales/marketing/CS roles. Revenue growth → FP&A need.
- Multi-Department Hiring = 3+ departments hiring simultaneously. Broad growth.
- Finance/Accounting Direct = Actual finance posting found. Confirmed need but competitors see it too.
- General Hiring Activity = Misc roles, general growth. Low urgency.
- One company can generate MULTIPLE events (e.g., both Jobs and Capital from same article).
- Skip results that are just job board aggregators with no company-specific signal.
- Skip results about recruiting agencies or staffing firms themselves.

APPROACH CONTEXT EXAMPLES:
- "Engineering team grew 40% this quarter. Companies at this stage typically need to upgrade their finance function within 3-6 months."
- "Series B close means first Controller hire is 6-12 months out. Get ahead of the posting."
- "New CFO hire signals finance function restructure. Adjacent hires follow within 90 days."

Return ONLY a JSON array of extracted signals. Empty array [] if no meaningful signals found.`;
}

/**
 * Build prompt for domain reconciliation via Gemini
 * @param {string} companyName - Company name to resolve
 * @returns {string} - Gemini prompt
 */
function buildDomainLookupPrompt_(companyName) {
  return `What is the root domain (website) for the company "${companyName}"?

Return ONLY the root domain in lowercase, nothing else. Example: acme.com
If you cannot determine the domain with high confidence, return "UNKNOWN".`;
}

/**
 * Build prompt for dedup checking via Gemini
 * @param {Object} newEvent - New event to check
 * @param {Object} existingEvent - Potentially matching existing event
 * @returns {string} - Gemini prompt
 */
function buildDedupCheckPrompt_(newEvent, existingEvent) {
  return `Are these two events describing the same thing?

EVENT 1 (existing):
- Company: ${existingEvent.companyName} (${existingEvent.domain})
- Type: ${existingEvent.eventType} / ${existingEvent.subtype}
- Date: ${existingEvent.eventDate}
- Notes: ${existingEvent.notes}

EVENT 2 (new):
- Company: ${newEvent.company_name} (${newEvent.domain})
- Type: ${newEvent.event_type} / ${newEvent.subtype}
- Date: ${newEvent.event_date}
- Notes: ${newEvent.notes}

Return ONLY "DUPLICATE" or "NEW". No explanation.`;
}

// ============================================
// HELPERS
// ============================================

/**
 * Generate SDI Run ID
 * Format: SDI-{timestamp}
 * @returns {string}
 */
function generateSDIRunId_() {
  return SDI_CONFIG.runIdPrefix + '-' + Date.now();
}

/**
 * Generate SDI Logged_On timestamp
 * Format: SDI MM/DD/YYYY HH:MM
 * @returns {string}
 */
function generateSDITimestamp_() {
  const now = new Date();
  const formatted = Utilities.formatDate(now, CONFIG.timezone, 'MM/dd/yyyy HH:mm');
  return SDI_CONFIG.loggedOnPrefix + ' ' + formatted;
}

/**
 * Validate an event_type string
 * @param {string} eventType
 * @returns {boolean}
 */
function isValidEventType_(eventType) {
  return VALID_EVENT_TYPES.includes(eventType);
}

/**
 * Validate a subtype string for a given event_type
 * @param {string} eventType
 * @param {string} subtype
 * @returns {boolean}
 */
function isValidSubtype_(eventType, subtype) {
  const validList = VALID_SUBTYPES[eventType];
  if (!validList) return false;
  return validList.includes(subtype);
}
