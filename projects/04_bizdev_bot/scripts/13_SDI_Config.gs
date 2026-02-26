/**
 * 13_SDI_Config.gs
 * SDI Scout - Configuration & Prompt Templates
 * Version: 1.0.0
 *
 * PURPOSE: All SDI-specific constants, Gemini prompt builders, Serper config,
 *          and subtype validation maps.
 * DEPENDENCIES: 00_Brain_Config.gs (getSerperAPIKey, getGeminiAPIKey)
 *
 * PATTERN: Mirrors 05_Candidate_Tracker 00a_Config.gs
 */

// ============================================
// SDI CONFIGURATION
// ============================================

const SDI_CONFIG = {
  // Sheet references (BD Tracker)
  spreadsheetId: 'YOUR_SPREADSHEET_ID',
  sheetEvents: 'Company_Events',
  sheetBehavioral: 'Company_Behavioral_Score',
  sheetCompanyMaster: 'Company_Master',
  sheetRunLogs: 'Run_Logs',

  // Company_Events column indices (0-based)
  eventCols: {
    companyName: 0,    // A
    domain: 1,         // B
    eventType: 2,      // C
    subtype: 3,        // D
    eventDate: 4,      // E
    sourceUrl: 5,      // F
    loggedOn: 6,       // G
    basePoints: 7,     // H (formula — DO NOT WRITE)
    windowDays: 8,     // I (formula — DO NOT WRITE)
    decayedPoints: 9,  // J (formula — DO NOT WRITE)
    notes: 10,         // K
    runId: 11          // L
  },

  // Company_Behavioral_Score column indices (0-based)
  behavioralCols: {
    domain: 0,           // A
    jobsPts: 1,          // B
    leadershipPts: 2,    // C
    infraPts: 3,         // D
    capitalPts: 4,       // E (formula — DO NOT WRITE)
    behavioralTotal: 5   // F (formula — DO NOT WRITE)
  },

  // Company_Master funding columns (0-based)
  fundingCols: {
    domain: 0,             // A
    company: 1,            // B
    lastFundingType: 19,   // T (col 20)
    lastFundingDate: 20,   // U (col 21)
    lastFundingAmount: 21, // V (col 22)
    monthsSinceFunding: 25,// Z (col 26, formula — DO NOT WRITE)
    lastUpdated: 27        // AB (col 28)
  },

  // Scoring caps (matches sheet lookup maps)
  caps: {
    jobs: 8,
    leadership: 8,
    infra: 4,
    capital: 10  // formula-driven, not script-written
  },

  // Serper settings
  serperEndpoint: 'https://google.serper.dev/search',
  serperQueriesPerRun: 5,
  serperResultsPerQuery: 10,

  // Gemini settings
  geminiFlashModel: CONFIG.geminiModel,
  geminiFlashEndpoint: GEMINI_API_URL,

  // Run settings
  runIdPrefix: 'SDI',
  loggedOnPrefix: 'SDI',
  defaultTimeWindowDays: 90,
  defaultGeo: 'Southern California',

  // Formula columns count (H, I, J = 3 cols starting at col 8)
  formulaStartCol: 8,   // H (1-indexed = 8)
  formulaColCount: 3,    // H, I, J

  // Serper rate limit (ms between calls)
  serperDelayMs: 500,

  // Gemini rate limit (ms between calls)
  geminiDelayMs: 300,

  // Extraction batch size (Serper results per Gemini call)
  extractionBatchSize: 8
};

// ============================================
// VALID EVENT TYPES & SUBTYPES
// ============================================

const VALID_EVENT_TYPES = ['Jobs', 'Leadership', 'Infra/Compliance', 'Capital'];

const VALID_SUBTYPES = {
  'Jobs': [
    'Engineering/Product Surge',
    'Sales/GTM Surge',
    'Multi-Department Hiring',
    'Finance/Accounting Direct',
    'General Hiring Activity'
  ],
  'Leadership': [
    'CFO/Controller/Head FP&A',
    'VP/Director Finance',
    'COO/CHRO/People/Ops',
    'VP Sales/Product/Eng'
  ],
  'Infra/Compliance': [
    'IPO Preparation/S-1 Filing',
    'SOC2/FedRAMP/HITRUST',
    'ISO27001/PCI/SOX/ERP go-live',
    'ERP Migration/Implementation',
    'Audit Firm Change/First Audit',
    'Minor security/privacy'
  ],
  'Capital': [
    'Seed/Angel',
    'Series A',
    'Series B',
    'Series C+',
    'PE/Growth Equity',
    'IPO',
    'M&A/Acquisition',
    'Debt/Credit Facility'
  ]
};

// Prompt builders and helpers moved to 13a_SDI_Prompts.gs:
// buildQueryGenerationPrompt_, buildExtractionPrompt_, buildDomainLookupPrompt_,
// buildDedupCheckPrompt_, generateSDIRunId_, generateSDITimestamp_,
// isValidEventType_, isValidSubtype_
