# Candidate Master — Sheet Walkthrough

A recruiter's candidate database and AI-powered screening system built on Google Sheets + Apps Script. Designed for a specialist executive search consultant working accounting and finance roles (Senior Accountant to CFO) in Southern California.

GitHub repo: [socalfinanceinsights/claude-os](https://github.com/socalfinanceinsights/claude-os) — code lives in `projects/05_candidate_master/`

---

## What This Is

Three data sources feed one master sheet:

- **Bullhorn** — CRM export. Historical notes, compensation targets, recruiter-for-life status, contact history.
- **LinkedIn** — 1st-degree connections export. Current title, current company, profile URL.
- **Google Drive** — Per-candidate folders containing resumes and AI-generated deep-dive writeups.

These three sources are imported, deduplicated, and merged into a single flat `Candidate_Master` tab. Gemini then reads each candidate's Drive folder and fills structured enrichment fields (skills, tech stack, job history). A job screening tool pastes a JD into a sidebar, generates a scoring matrix, and ranks candidates — results land in a dedicated `Screen_` tab.

The goal: identify top candidates for a search in under 5 minutes instead of 30–45.

---

## Sheet Structure

| Tab | Purpose |
|-----|---------|
| `Candidate_Master` | Main data store. One row per candidate. 25 columns, ~10,700 rows in production. |
| `Active_Searches` | Open searches with stage, pipeline counts, sourcing notes, and blockers. Maintained by a separate automation layer (not by import scripts). |
| `Job_Screen_Config` | Stores job descriptions and client notes used as input to the screening engine. One row per screening run. |
| `Screen_AccoManaInte_...` | Screening results. Tab name encodes the role and timestamp. One results tab per screening run. |
| `Candidate_Match_Review` | Staging area for dedup review decisions that require a human call. |
| `Dedup_Review` | Historical snapshot from the LinkedIn-to-Bullhorn dedup run. Shows match pairs and outcomes. Not a live queue. |
| `Notes_Archive` | Archive of raw Bullhorn note text. Cleared in the demo copy — contained full email threads in production. |
| `Import_Log` | Timestamped record of every import run: source, row count, duration. |
| `LinkedIn_Change_Log` | Tracks field-level changes detected during LinkedIn refresh runs. |
| `Location_Normalization` | 228-row lookup table. Maps raw city/location text to a normalized SoCal sub-region bucket (South OC, LA City, San Diego, etc.). Used to stamp column M (Region) on import. |
| `ErrorLog` | Catches GAS exceptions from background operations — enrichment, folder linking, dedup. |

### How the tabs connect

`Candidate_Master` is the hub. `Location_Normalization` feeds it on import (Region lookup). `Job_Screen_Config` feeds the screening engine as input. `Screen_` tabs receive screening output. `Dedup_Review` and `Candidate_Match_Review` are decision surfaces for the merge workflow. The log tabs (`Import_Log`, `ErrorLog`, `LinkedIn_Change_Log`) are written by GAS functions during operation and are purely observational.

---

## The 25-Column Schema

All data in `Candidate_Master` is flat — no formulas, no array spill. Every cell is a stamped value written by an import or enrichment function.

### Identity

| Col | Field | Notes |
|-----|-------|-------|
| A | UID | Hash-based primary key. Derived from email → LinkedIn URL → SHA-256 of name (in that priority order). Stable across imports. |
| B | Full_Name | |
| E | LinkedIn_URL | Composite dedup key. Never overwritten by resume extraction (explicit guard in place — see the Bugs section in STATE.md for why). |
| F | Email | |
| G | Phone | Normalized on import. |

### Professional

| Col | Field | Notes |
|-----|-------|-------|
| C | Current_Title | From Bullhorn or LinkedIn import. Updated by LinkedIn refresh runs. |
| D | Current_Company | Same sourcing as Current_Title. |
| K | Comp_Target | Gemini-extracted from Bullhorn notes. Display-only — never used as a hard filter in screening. |
| L | Location | Raw location text from source data. |
| M | Region | Normalized sub-region from `Location_Normalization` lookup. Stamped on import. Examples: South OC, LA City, San Diego, Inland Empire. |
| N | Tech_Stack | ERP and software familiarity. From Drive `_Tags.json` file (free, instant) or Gemini extraction from resume text. |
| O | Key_Skills | Core accounting/finance skills summary. Same sourcing as Tech_Stack. |
| P | Quality_Tier | A / B+ / B / C+ / C. Deterministic — derived from CPA status, Big 4 background, and years of experience. Not a Gemini judgment call. |
| U | Historical_Titles | Prior job titles string. Extracted by Gemini from DeepDive.md or resume text. Appended (not overwritten) by LinkedIn refresh. |
| T | Notes_Summary | Bullhorn recruiter notes, concatenated as dated snippets. |

### System / Tracking

| Col | Field | Notes |
|-----|-------|-------|
| H | Status | Active / New Lead / Direct Apply / Placed / DNC |
| I | Last_LinkedIn_Refresh | Date of last LinkedIn data update. |
| J | Last_Bullhorn_Contact | Date of last Bullhorn CRM contact. Blank = no Bullhorn history. Drives enrichment eligibility — GAS enrichment scripts skip rows where this is blank. |
| Q | Drive_Folder_Link | URL to the candidate's Google Drive folder. Auto-linked by the folder linker (daily trigger). |
| R | Has_Resume | Boolean. Set during folder link or import. |
| S | Has_DeepDive | Boolean. Set during folder link. Indicates a structured AI writeup exists in the Drive folder. |
| V | Match_Status | Tracks dedup outcome: NO_MATCH / REVIEW / MERGED / "LinkedIn Matched MM.DD.YYYY". MERGED rows are excluded from all downstream processing — they're donor records that were absorbed into a keeper row. |
| W | Last_Import | Stamp format: `{PREFIX} DD.MM.YYYY HH:MM`. Prefixes: BHNotes, BHFull, LI, FolderLink, Tags, DeepDive. |
| X | Last_Enrichment | Stamp format: `Gemini DD.MM.YYYY HH:MM`. Blank = never attempted. Stamped regardless of whether Gemini returned data — this prevents infinite re-processing loops. |
| Y | LI_Personal | Flag for non-target personal contacts mixed into the LinkedIn export (non-Finance/Accounting profiles). Rows flagged here are excluded from enrichment and screening. |

---

## How It Works — The Pipeline

### Step 1: Import

Bullhorn and LinkedIn each export CSVs. The import scripts read those CSVs from designated Google Drive folders and UPSERT rows into `Candidate_Master`.

UPSERT logic: if a row with a matching UID already exists, update fields that have changed. If no match, append a new row. Deduplication on import uses UID (hash of email or LinkedIn URL) as the key — not name, which is unreliable across systems.

Two import paths:
- **Bullhorn Notes import** (`importBullhornNotes`) — pulls recruiter notes, comp target, contact dates, status.
- **LinkedIn Connections import** (`importLinkedInConnections`) — pulls current title, company, LinkedIn URL from the quarterly 1st-connections export.

A third path (`importBullhornCandidateData`) handles a fuller Bullhorn candidate data export for initial population.

`Import_Log` gets a timestamped entry after every run. `Last_Import` on each row is stamped with the source prefix and timestamp.

### Step 2: Enrichment

After import, candidates with a linked Drive folder get enriched. Enrichment reads two file types from the Drive folder:

- **`_Tags.json`** — A structured JSON file generated by an AI intake process during candidate processing. Contains pre-parsed fields: skills, tech stack, certifications. If this file exists, it's parsed directly (free, instant — no API call).
- **`DeepDive.md`** — A long-form AI-generated candidate writeup. If Tags.json doesn't exist or Historical_Titles is still blank, Gemini Pro reads the DeepDive and extracts structured data.

Enriched fields: `Key_Skills`, `Tech_Stack`, `Historical_Titles`, `Notes_Summary`.

`Last_Enrichment` is stamped on every row processed, including rows where Gemini returned nothing. This is intentional — blank `Last_Enrichment` means "never attempted," not "Gemini found nothing."

Enrichment only runs on rows with Bullhorn history (`Last_Bullhorn_Contact` not blank). LinkedIn-only rows are not enrichable through this path.

### Step 3: Screening

The screening engine lives in `06_Job_Screening.gs` and surfaces as a sidebar in the sheet (Extensions > Apps Script exposes it, or it appears in the custom menu).

Workflow:
1. Paste a job description into the sidebar.
2. Optionally set title keyword filters to pre-reduce the candidate pool.
3. The engine calls Gemini Pro to generate a scoring matrix for the role.
4. Gemini Flash then ranks candidates in batches against that matrix.
5. Results are written to a new `Screen_` tab named with the role slug and timestamp.

The screening engine is currently parked. At 10k+ candidates, Gemini's thinking token usage causes timeouts at batch 2 of 30. The screening config and results infrastructure are intact — the timeout issue is in the batch execution, not the data or matrix logic.

### Step 4: Dedup

Two dedup paths were run to clean the initial population:

- **Bullhorn-to-Bullhorn** (`96_Candidate_Deduplication.gs`) — Gemini matches BH records with overlapping names, scores pairs, and writes outcomes to `Dedup_Review`. Auto-merge candidates (high-confidence) were merged programmatically; ambiguous pairs land in `Candidate_Match_Review` for human review.
- **LinkedIn-to-Bullhorn** (`li_dedup.py`, Python pipeline) — Matched the ~4,200 LinkedIn-only rows against existing Bullhorn rows using last-name indexing + Gemini disambiguation. 14 auto-merges, 25 manual merges, 14 LinkedIn URLs backfilled to Bullhorn rows.

Merged donor rows have `Match_Status = MERGED`. All downstream scripts filter these out — they're still physically present in the sheet but treated as invisible.

---

## The Code

All GAS logic is bound to the sheet. Access it via **Extensions > Apps Script** in the Google Sheet. A custom menu appears in the sheet toolbar and surfaces the main callable functions.

### Apps Script File Breakdown

**Foundation (shared utilities)**

| File | What it does |
|------|--------------|
| `00a_Config.gs` | Single source of truth for all constants: sheet ID, Drive folder IDs, tab names, Gemini model versions, batch sizes, column indices. Every other script reads from here. |
| `00b_Sheet_Helpers.gs` | Sheet read/write operations. Column map pattern (`colMap`), error logging to ErrorLog tab, import stamp logging to Import_Log. |
| `00c_CSV_Helpers.gs` | CSV parsing with quote-aware newline handling. Handles the edge cases in Bullhorn/LinkedIn export formats. |
| `00d_Name_Matching.gs` | Name normalization, Levenshtein distance, UID generation logic. |
| `00e_Note_Parsers.gs` | Email and phone extraction from raw Bullhorn note body text. |
| `00f_Gemini_API.gs` | Gemini API wrappers: `enrichCandidateWithGemini` (Flash, general enrichment), `extractDeepDiveWithGemini` (Pro, full DeepDive extraction), `extractHistoricalTitlesWithGemini` (Pro, lighter pass when Tags.json already provides skills). |
| `00g_Gemini_Screening_API.gs` | Screening-specific Gemini calls: `generateScreeningMatrixWithGemini` (Pro, builds the scoring rubric from a JD) and `rankCandidatesWithGemini` (Flash, scores candidates against the matrix). |

**Import**

| File | What it does |
|------|--------------|
| `01_Initial_Import.gs` | Orchestrators: `importBullhornNotes`, `importLinkedInConnections`, `importBullhornCandidateData`, `runInitialImport`. These are the entry points — they call helpers and coordinate the full import run. |
| `01b_Import_Helpers.gs` | UPSERT logic, note filtering, phone normalization. Core mechanics of matching incoming CSV rows to existing sheet rows and deciding what to update vs. append. |
| `01c_Import_LinkedIn_Helpers.gs` | LinkedIn-specific import helpers: field mapping from the LinkedIn CSV format, URL normalization. |
| `02_Incremental_Import.gs` | Quarterly refresh orchestrators. Built but never tested in production — designed for ongoing LinkedIn data refreshes after the initial population. |

**Features**

| File | What it does |
|------|--------------|
| `03_Resume_Archive_Matcher.gs` | Early-stage resume classification, name matching, and Gemini extraction. Superseded by the Python pipeline for bulk work but present as a GAS-native path. |
| `04_Folder_Linker.gs` | Links Drive candidate folders to `Candidate_Master` rows by matching folder names to candidate names. Uses last-name-first matching (not all-vs-all fuzzy — that was tried and produced 13/13 false positives). Daily trigger at 8–9pm Pacific via `scheduledFolderLink()`. |
| `05_Enrichment.gs` | Enrichment orchestrator. Reads Tags.json first (free); falls back to Gemini Pro for DeepDive extraction. Writes Key_Skills, Tech_Stack, Notes_Summary, Historical_Titles. |
| `06_Job_Screening.gs` | Sidebar UI, screening orchestration, batch ranking. Currently parked due to Gemini thinking token timeout at scale. |
| `06b_Screening_Helpers.gs` | Candidate data retrieval for screening, results tab creation and write-back, config management. |
| `06c_Screening_Config_Helpers.gs` | Parsing and validation for screening configuration stored in `Job_Screen_Config` tab. |

**Enrichment + Dedup**

| File | What it does |
|------|--------------|
| `90_Gemini_Batch_Enrichment.gs` | Batch enrichment runner. Processes 50 candidates per run. Only operates on rows with Bullhorn history. Do not install as a trigger — all eligible rows in the production sheet are already enriched. |
| `96_Candidate_Deduplication.gs` | Dedup orchestrator. `runGeminiMatchingBatch` processes 40 pairs per batch (LI↔BH matching). `processReviewDecisions` executes approved merge decisions from `Candidate_Match_Review`. |
| `96b_Dedup_Helpers.gs` | Gemini matching logic, merge field resolution, review tab management. |
| `96c_Dedup_Merge_Helpers.gs` | Row merge execution — copies fields from donor row to keeper row, stamps Match_Status = MERGED on donor. |

**Menu**

| File | What it does |
|------|--------------|
| `Menu.gs` | Builds the custom menu in the sheet. Entry point for all user-invocable functions — import, enrichment, screening, dedup, folder link. |

---

## Running It Yourself

The shared sheet is a demo copy — all production candidate data has been replaced with placeholder rows that show the column structure and data types. If you want to run the system against your own data:

### Prerequisites

1. **Your own Google Sheet** — make a copy or create fresh. Update `SHEET_ID` in `00a_Config.gs`.
2. **Gemini API key** — set it in Script Properties (`Extensions > Apps Script > Project Settings > Script Properties`). Key name: `GEMINI_API_KEY`. The scripts read it via `PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY")` — it is never hardcoded.
3. **Google Drive folders** — create folders for incoming Bullhorn CSVs, LinkedIn CSVs, and candidate profile folders. Update the folder ID constants in `00a_Config.gs`:
   - `CANDIDATES_FOLDER_ID` — where candidate Drive folders live
   - `BULLHORN_CSV_FOLDER_ID` — incoming Bullhorn notes CSVs
   - `BULLHORN_CANDIDATE_DATA_FOLDER_ID` — quarterly BH candidate data export
   - `LINKEDIN_CSV_FOLDER_ID` — incoming LinkedIn CSVs

4. **Apps Script scopes** — `appsscript.json` is in the repo. You'll need to authorize Drive access on first run (browser consent flow).

### Gemini models

Model strings are centralized in `00a_Config.gs`:

```
GEMINI_FLASH_MODEL — used for enrichment, ranking (speed-optimized)
GEMINI_PRO_MODEL   — used for DeepDive extraction, screening matrix (quality-optimized)
```

Update these if you're using different model versions.

### Deploying the code

The scripts are bound to a Google Sheet. To push the code from the repo to a new Sheet:
1. Install [clasp](https://github.com/google/clasp)
2. Update `.clasp.json` with your Apps Script project ID
3. `clasp push --force` from the `scripts/` directory

The GitHub repo has the full code — see the `projects/05_candidate_master/scripts/` directory.

---

## GitHub

All code: [https://github.com/socalfinanceinsights/claude-os](https://github.com/socalfinanceinsights/claude-os)

Path in repo: `projects/05_candidate_master/`

- `scripts/` — All GAS `.gs` files
- `pipeline/` — Python pipeline scripts (bulk resume extraction, LinkedIn dedup, batch processing)
- `docs/` — Architecture docs, spec, schema reference, pipeline playbooks

The Python pipeline (`pipeline/`) is a separate layer that handled the initial bulk data load (~10,700 rows). It's not required for ongoing operation — the GAS layer handles incremental imports and enrichment. The pipeline is documented in `docs/reference/REF_Resume_Batch_Pipeline.md` if you want to understand the initial population process.
