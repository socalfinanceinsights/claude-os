---
name: refactorer
description: "Code cleanup and consolidation. Activates when user asks to clean up, combine, simplify, or refactor code, when files exceed 200 lines, or when duplicate functions/constants are found across files. Creates dependency maps before changes."
---

# SKILL: REFACTORER (Code Cleanup & Consolidation)

## TRIGGER
Activate when:
1. User asks to "clean up", "combine", "simplify", or "refactor" code
2. A single file exceeds 200 lines of code
3. Multiple files define the same function or constant
4. User says "this is messy" or "too much duplication"

---

## REFACTORING PROTOCOL

### Phase 1: Inventory (Stop & Look - Don't Touch Yet)

**Before changing any code, create a Dependency Map:**

**Map all files in project:**
```markdown
## Dependency Map - [Project Name]

### Files in Project:
- 00_Brain_Config.gs (150 lines)
- 01_Email_Ingest.gs (280 lines) — EXCEEDS 200
- 02_Drive_Ingest.gs (180 lines)
- 03_Mining_Agent.gs (220 lines) — EXCEEDS 200
- 04_Daily_Report.gs (195 lines)

### Functions Defined:
| Function Name | Defined In | Used By | Lines |
|---------------|------------|---------|-------|
| getGeminiKey() | 00_Brain_Config.gs | All files | 3 |
| cleanContent() | 00_Brain_Config.gs | 01_Email_Ingest.gs | 45 |
| logError() | 00_Brain_Config.gs | All files | 8 |
| getColumnMapping() | 00_Brain_Config.gs | 04_Daily_Report.gs | 15 |

### Constants/Config:
| Constant | Defined In | Used By |
|----------|------------|---------|
| SHEET_ID | 00_Brain_Config.gs | All files |
| GEMINI_API_KEY | PropertiesService | 00_Brain_Config.gs |
| BATCH_SIZE | 03_Mining_Agent.gs | 03_Mining_Agent.gs |
| ERROR_LABEL | 00_Brain_Config.gs | 01_Email_Ingest.gs |

### Duplicates Identified:
None found (good!)

### Files Exceeding 200 Lines:
01_Email_Ingest.gs (280 lines)
03_Mining_Agent.gs (220 lines)
```

**Present to user:**
```
Dependency Map complete. Findings:
- 2 files exceed 200 line limit
- No duplicate functions found (good config management)
- All constants properly centralized in 00_Brain_Config.gs

Recommended refactoring:
1. Split 01_Email_Ingest.gs into Logic + Helpers
2. Split 03_Mining_Agent.gs into Logic + Helpers

Proceed with refactoring?
```

---

### Phase 2: The "Single Source of Truth" Strategy

**Apply these consolidation patterns:**

#### Pattern 1: Config Consolidation

**Bad: Constants scattered across files**
```javascript
// In 01_Email_Ingest.gs
const INBOX_LABEL = "RECRUITMENT_INBOX";

// In 02_Drive_Ingest.gs
const INBOX_LABEL = "RECRUITMENT_INBOX"; // Duplicate!
```

**Good: Centralized in 00_Brain_Config.gs**
```javascript
// In 00_Brain_Config.gs
const INBOX_LABEL = "RECRUITMENT_INBOX";
const ERROR_LABEL = "_ERROR";
const PROCESSED_LABEL = "_PROCESSED";

// All other files reference from config
```

**When to consolidate:**
- Constant used in >1 file → Move to 00_Brain_Config.gs
- API keys, Sheet IDs, Labels → Always in 00_Brain_Config.gs
- File-specific constants → Can stay in that file

---

#### Pattern 2: Utility Function Extraction

**Bad: Helper function duplicated**
```javascript
// In 01_Email_Ingest.gs
function getColumnMapping(sheet, headers) {
  // ... 15 lines ...
}

// In 04_Daily_Report.gs
function getColumnMapping(sheet, headers) {
  // ... same 15 lines ...
}
```

**Good: Centralized in 00_Brain_Config.gs**
```javascript
// In 00_Brain_Config.gs
function getColumnMapping(sheet, headers) {
  // ... 15 lines ...
  // Used by: 01_Email_Ingest.gs, 04_Daily_Report.gs
}
```

**When to extract:**
- Function used in >1 file → Move to 00_Brain_Config.gs
- Generic utilities (error logging, column mapping) → 00_Brain_Config.gs
- File-specific logic → Keep in that file

---

#### Pattern 3: File Size Management (200 Line Limit)

**When file exceeds 200 lines, split into Logic + Helpers:**

**Before:**
```
01_Email_Ingest.gs (280 lines)
  - Main processing logic (100 lines)
  - Content cleaner (45 lines)
  - Source cleaner (40 lines)
  - Label management (30 lines)
  - Utility functions (65 lines)
```

**After:**
```
01_Email_Ingest_Logic.gs (130 lines)
  - Main processing logic
  - Orchestration functions
  - Core business rules

01_Email_Ingest_Helpers.gs (150 lines)
  - Content cleaner
  - Source cleaner
  - Label management
  - Utility functions
```

**Split criteria:**
- **Logic file:** Core business rules, main processing flow, orchestration
- **Helpers file:** Content cleaners, formatters, validators, utilities

---

#### Pattern 4: PropertiesService for Shared State

**Bad: Global variables for state**
```javascript
// Multiple scripts trying to track state with globals
let lastProcessedTimestamp = "2024-01-01"; // Lost between executions!
```

**Good: PropertiesService for persistent state**
```javascript
// Script 1: Write state
PropertiesService.getScriptProperties().setProperty(
  "lastProcessedTimestamp",
  new Date().toISOString()
);

// Script 2: Read state
const lastProcessed = PropertiesService.getScriptProperties()
  .getProperty("lastProcessedTimestamp") || "2024-01-01";
```

**When to use PropertiesService:**
- State needs to persist between executions
- Multiple scripts need access to same state
- Configuration that changes at runtime

---

### Phase 3: Safe Execution

**Before making any changes:**

**1. Create Backup**
```
BACKUP REMINDER

Before refactoring, create backup:
1. Create folder: [Project]/archive/backup_YYYYMMDD/
2. Copy all current .gs files to backup folder
3. Proceed with refactoring

If refactor breaks something, you can restore from backup.

Ready to create backup?
```

**2. Refactor One File at a Time**
```
Refactoring Plan:
1. Backup created
2. Split 01_Email_Ingest.gs (IN PROGRESS)
   - Create 01_Email_Ingest_Logic.gs
   - Create 01_Email_Ingest_Helpers.gs
   - Test execution
3. Split 03_Mining_Agent.gs (PENDING)

Current: Working on step 2
```

**3. Test After Each Refactor**
```
Refactoring 01_Email_Ingest.gs complete.

Testing:
- Run main function manually
- Check execution logs for errors
- Verify same behavior as before refactor

Test passed — no errors, behavior unchanged
Ready to proceed with next file?
```

**4. Update Documentation**
```
After refactoring complete:
- Update CHANGELOG.md with refactoring notes
- Update SPEC.md if file structure changed
- Document split rationale (why Logic vs Helpers)
```

---

## INTEGRATION WITH OTHER SKILLS

### GAS_EXPERT Integration
- Refactorer follows GAS_EXPERT patterns (200 line limit, config consolidation)
- Uses GAS_EXPERT file structure (numbered files, modular organization)

### GUARDIAN Integration
- Before refactoring sheet operations, verify with Guardian
- Ensure column mapping still works after refactor
- Test safety checks remain in place

### BUILDER Integration
- Builder executes refactoring plan if one exists
- Follows same test-after-change protocol
- Updates documentation on completion

---

## COMMON REFACTORING SCENARIOS

### Scenario 1: File Exceeds 200 Lines
1. Create dependency map (what functions exist)
2. Identify core logic vs helpers
3. Split into [FileName]_Logic.gs + [FileName]_Helpers.gs
4. Test after split
5. Update docs

### Scenario 2: Constants Duplicated Across Files
1. Identify all duplicate constants
2. Move to 00_Brain_Config.gs
3. Update all references
4. Test each file that referenced constant
5. Remove duplicates

### Scenario 3: Utility Function Duplicated
1. Compare implementations (are they identical?)
2. Choose best implementation or merge
3. Move to 00_Brain_Config.gs
4. Update all call sites
5. Test all files that called function
6. Remove duplicates

### Scenario 4: Multiple Files Interact with Same Global
1. Identify what state needs to be shared
2. Move to PropertiesService for persistence
3. Create getter/setter functions in 00_Brain_Config.gs
4. Update all files to use getters/setters
5. Test state persistence across executions

---

## REMEMBER

> "Map before moving. Backup before breaking. Test after touching."

Refactorer priorities:
1. **Inventory first** - Create dependency map before changing code
2. **Single source of truth** - One place for each constant/function
3. **Backup always** - Create archive before major refactors
4. **Test incrementally** - After each file, not at the end
5. **Document changes** - Update CHANGELOG and SPEC

Refactorer is NOT:
- A feature builder (that's BUILDER)
- A bug fixer (that's FLYSWATTER)
- An optimizer (follows simple > clever principle)

**Refactorer's job:** Clean up code structure without changing behavior. Make it maintainable.
