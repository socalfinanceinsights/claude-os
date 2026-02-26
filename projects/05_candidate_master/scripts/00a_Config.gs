/**
 * Simple test function for clasp run verification
 */
function testClaspRun() {
  return "clasp run works - 05_Candidate_Master";
}

/**
 * 00a_Config.gs
 * Constants and configuration for Candidate Matching Engine
 *
 * PURPOSE: Single source of truth for all IDs, folder references, tab names, and thresholds
 * DEPENDENCIES: None (foundation file — loaded first by GAS)
 */

// ============================================
// SPREADSHEET & DRIVE IDs
// ============================================

const SHEET_ID = "YOUR_SPREADSHEET_ID";
const CANDIDATES_FOLDER_ID = "YOUR_CANDIDATES_FOLDER_ID";

// CSV Import Folders (Drive-based ETL)
const BULLHORN_CSV_FOLDER_ID = "YOUR_BULLHORN_CSV_FOLDER_ID";
const BULLHORN_PROCESSED_FOLDER_ID = "YOUR_BULLHORN_PROCESSED_FOLDER_ID";
const BULLHORN_CANDIDATE_DATA_FOLDER_ID = "YOUR_BULLHORN_CANDIDATE_DATA_FOLDER_ID";  // Quarterly BH candidate export (title/email/phone/company)
const BULLHORN_CANDIDATE_DATA_PROCESSED_FOLDER_ID = "YOUR_BULLHORN_CANDIDATE_DATA_PROCESSED_FOLDER_ID";
const LINKEDIN_CSV_FOLDER_ID = "YOUR_LINKEDIN_CSV_FOLDER_ID";
const LINKEDIN_PROCESSED_FOLDER_ID = "YOUR_LINKEDIN_PROCESSED_FOLDER_ID";

// ============================================
// TAB NAMES
// ============================================

const TAB_CANDIDATE_MASTER = "Candidate_Master";
const TAB_NOTES_ARCHIVE = "Notes_Archive";
const TAB_RESUME_ARCHIVE_MATCHES = "Resume_Archive_Matches";
const TAB_CHANGE_LOG = "LinkedIn_Change_Log";
const TAB_IMPORT_LOG = "Import_Log";
const TAB_ERROR_LOG = "ErrorLog";
const TAB_CANDIDATE_MATCH_REVIEW = "Candidate_Match_Review";

// ============================================
// GEMINI MODEL VERSIONS
// ============================================

const GEMINI_FLASH_MODEL = "gemini-3-flash-preview";
const GEMINI_PRO_MODEL = "gemini-2.5-pro";

// ============================================
// MATCHING THRESHOLDS
// ============================================

const FUZZY_MATCH_THRESHOLD = 0.85; // 85% similarity required for name matching

// ============================================
// JOB SCREENING
// ============================================

const TAB_JOB_SCREEN_CONFIG = "Job_Screen_Config";
const TAB_LOCATION_NORMALIZATION = "Location_Normalization";
const SCREENING_BATCH_SIZE = 25;   // Candidates per Gemini Flash call
const SCREENING_TOP_N = 25;        // Top N results to display

// ============================================
// IMPORT STAMP PREFIXES
// ============================================
// Used in Last_Import column: "{PREFIX} DD.MM.YYYY HH:MM"

const IMPORT_PREFIX_BH_NOTES = "BHNotes";
const IMPORT_PREFIX_BH_FULL = "BHFull";
const IMPORT_PREFIX_LINKEDIN = "LI";
const IMPORT_PREFIX_FOLDER_LINK = "FolderLink";
const IMPORT_PREFIX_TAGS = "Tags";
const IMPORT_PREFIX_DEEPDIVE = "DeepDive";

// ============================================
// FOLDER LINKER
// ============================================

const MAX_FOLDERS_PER_RUN = 500;
const ENRICHMENT_BATCH_SIZE = 20;
const TIMEOUT_BUDGET_MS = 300000; // 5 minutes total budget for linking + enrichment
