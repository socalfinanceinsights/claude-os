---
name: guardian
description: "Data safety enforcement for Google Sheets and Drive. Injected into agent profiles that perform destructive or bulk operations. Provides confirmation workflows, column mapping verification, and scoping safety."
user-invocable: false
---

# SKILL: GUARDIAN (Data Safety & Constraints)

## INJECTION CONTEXT

Injected into agent profiles (via `skills` YAML field) that perform any write, delete, clear, or bulk operation on Google Sheets or Drive. Provides confirmation workflow patterns, column mapping verification, scoping safety rules, and safe sheet operation patterns. Apply when the agent may touch data destructively or affect >10 items.

---

## CRITICAL SAFETY RULES (NEVER VIOLATE)

### 1. Gmail Thread Safety
**NEVER use:**
```javascript
thread.moveToTrash();
thread.deleteThread();
```

**ALWAYS use labels:**
```javascript
thread.addLabel(GmailApp.getUserLabelByName("_PROCESSED"));
thread.removeLabel(inboxLabel);
```

**Reason:** Deleted emails cannot be recovered. Labels are reversible.

---

### 2. Drive File/Folder Safety
**NEVER delete root-level Drive folders/files** without explicit user confirmation
**NEVER move files** between folders without confirmation
**NEVER batch delete** files without showing summary first

**ALWAYS confirm destructive operations:**
```
SAFETY CHECK - File Deletion

About to DELETE 3 files:
- PLAN_EmailIngest_2026-01-15.md
- BRAINSTORM_v1.md
- temp_notes.txt

This cannot be undone. Proceed? (yes/no)
```

---

### 3. Sheet Data Safety
**NEVER delete rows** without confirmation
**NEVER clear ranges** without confirmation
**NEVER bulk update** existing data without summary

**ALWAYS verify before destructive operations:**
```
SAFETY CHECK - Delete Rows

About to DELETE 8 rows from ErrorLog:
- Criteria: Resolved? = "Yes"
- Rows: 5, 7, 9, 12, 15, 18, 21, 23
- Sample: "2026-01-23 | TIMEOUT | Resolved"

This cannot be undone. Proceed? (yes/no)
```

**Normal appends need NO confirmation** (non-destructive):
```javascript
// This is safe, no Guardian intervention needed
sheet.appendRow([new Date(), threadId, "ERROR_CODE", title, message]);
```

---

### 4. Scoping Safety
**NEVER modify files not explicitly mentioned** in user's request
**NEVER "clean up" adjacent files** without permission

**ONLY act on files/sheets user specified**

**Example:**
- User: "Fix the error in Email Ingest"
- Modify: `01_Email_Ingest.gs`
- Don't modify: `02_Drive_Ingest.gs` (even if you see similar pattern)

---

## PRE-OPERATION VERIFICATION

### Before Sheet Operations:

**1. Verify sheet exists:**
```javascript
const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(sheetName);
if (!sheet) {
  throw new Error(`Sheet "${sheetName}" not found in spreadsheet ${SHEET_ID}`);
}
```

**2. Verify column headers match expected structure:**
```javascript
const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
const expectedHeaders = ['DateLog', 'SourceID', 'ErrorCode', 'SourceTitle', 'ErrorDefinition'];

const missingHeaders = expectedHeaders.filter(h => !headers.includes(h));
if (missingHeaders.length > 0) {
  throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
}
```

**3. Map columns by name (NOT by position):**
```javascript
function getColumnMapping(sheet, expectedHeaders) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const mapping = {};
  for (const header of expectedHeaders) {
    const index = headers.indexOf(header);
    if (index === -1) {
      throw new Error(`Required header "${header}" not found`);
    }
    mapping[header] = index;
  }

  return mapping;
}

// Usage:
const col = getColumnMapping(sheet, ['DateLog', 'SourceID', 'ErrorCode']);
const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
for (let i = 0; i < data.length; i++) {
  const dateLog = data[i][col.DateLog];
  const sourceID = data[i][col.SourceID];
  // Column mapping ensures we read correct data even if sheet structure changes
}
```

**Why column mapping matters:**
- Sheet columns may be reordered by user
- New columns may be inserted
- Mapping by name (not index) makes code resilient to structure changes

---

## CONFIRMATION WORKFLOW

### Operations That REQUIRE Confirmation:

**ALWAYS confirm before:**
- Deleting any Drive files/folders
- Moving Drive files between folders
- Deleting sheet rows or clearing ranges
- Bulk updates affecting >10 rows/items
- Modifying files not explicitly mentioned in user's request

**Confirmation format:**
```
SAFETY CHECK - [Operation Type]

About to [ACTION] [TARGET]:
- Criteria: [Filter/condition]
- Items affected: [Count and sample]
- Data preview: [First 2-3 examples]

This cannot be undone.

Proceed? (yes/no)
```

---

### Operations That DON'T Need Confirmation:

**Proceed automatically for:**
- Appending new rows to sheets (non-destructive)
- Adding Gmail labels (non-destructive, reversible)
- Reading/searching data
- Creating new files (not modifying existing)
- Code changes (user already reviews diffs through Claude Code)

---

## SAFE SHEET OPERATION PATTERNS

### Pattern 1: Safe Append with Verification
```javascript
function safeAppendToSheet(sheetId, sheetName, rowData) {
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }

  if (!rowData || rowData.length === 0) {
    Logger.log('No data to append, skipping');
    return;
  }

  sheet.appendRow(rowData);
  Logger.log(`Appended row to ${sheetName}`);
}
```

### Pattern 2: Verified Column Mapping
```javascript
function readErrorLogSafely() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("ErrorLog");

  // Get column mapping (NOT hard-coded indices)
  const col = getColumnMapping(sheet, ['DateLog', 'SourceID', 'ErrorCode', 'SourceTitle', 'ErrorDefinition']);

  // Read data
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];  // No data

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // Process using mapped columns
  const errors = [];
  for (let i = 0; i < data.length; i++) {
    errors.push({
      date: data[i][col.DateLog],
      sourceId: data[i][col.SourceID],
      errorCode: data[i][col.ErrorCode],
      title: data[i][col.SourceTitle],
      message: data[i][col.ErrorDefinition]
    });
  }

  return errors;
}
```

### Pattern 3: Graceful Error Handling
```javascript
function processWithSafety() {
  try {
    // Attempt operation
    const result = riskyOperation();
    Logger.log('Operation completed successfully');
    return result;

  } catch (error) {
    // Log error with context
    Logger.log(`ERROR in processWithSafety: ${error.toString()}`);

    // Log to ErrorLog sheet
    logError("PROCESS_ID", "ERROR_CODE", "Operation title", error.toString());

    // Don't fail silently - propagate or handle gracefully
    throw new Error(`Failed to process: ${error.message}`);
  }
}
```

---

## INTEGRATION WITH OTHER SKILLS

### GAS_EXPERT Integration
When GAS_EXPERT writes sheet operation code, Guardian:
- Adds column mapping verification
- Adds existence checks
- Adds error logging
- Reviews for destructive operations

### BUILDER Integration
During Blueprint phase, Guardian reviews for:
- Operations requiring confirmation workflow
- Data safety checkpoints in implementation plan
- Rollback procedures for risky operations

---

## PROJECT-SPECIFIC NOTES

Guardian adapts to each project's constraints. Project-specific rules belong in project docs, not this skill.

**Example:**
- A sheet may have pre-filled formulas in certain columns
- ErrorLog may have a specific column structure
- Config sheets may have different validation rules

These details belong in:
- `[ProjectName]/docs/SPEC.md` (project-specific)
- NOT in Guardian skill (universal safety patterns)

---

## REMEMBER

> "Better to ask permission once than apologize for data loss forever."

Guardian's purpose:
1. **Prevent accidental data loss** through verification
2. **Ensure operations are scoped** to user's intent
3. **Provide visibility** into destructive changes before execution
4. **Make risky operations explicit** and confirmed

Guardian is NOT:
- A replacement for user code review (that's Claude Code permissions)
- Project-specific logic (that belongs in SPEC.md)

**When in doubt:** Verify first, execute second.
