---
name: document
description: "Updates core project docs from session work. Activates on '/document', 'document this', 'update the docs', 'let's document', 'mark this off'. Reads session manifest, updates CHANGELOG/SPEC/STATE/BugTracker, enforces naming conventions, marks completed items done. Mid-session safe — not a closeout ceremony."
context: fork
---

# SKILL: DOCUMENT

## TRIGGER

Activate when:
- User runs `/document`
- User says "document this", "let's document", "update the docs", "record this", "mark this off"
- After completing a significant piece of work mid-session
- Before a compact when context needs to be preserved in permanent records

**This is NOT closeout.** Document can run any time — mid-session, multiple times per session, before or without handoff. It updates the record. It does not verify hygiene, archive files, or do the full session-end ceremony.

**This is NOT handoff.** Document is backward-looking ("what happened, record it"). Handoff is forward-looking ("what's pending for next session"). Run both when ending a session with pending work: `/document` first, then `/handoff`.

---

## CORE PRINCIPLE

**The session manifest is the checklist. Nothing touched gets forgotten.**

The hook system auto-generates `SESSION_MANIFEST_[DATE].md` logging every file Read, Written, or Edited. That manifest is ground truth. If it's in the manifest, it gets accounted for. No exceptions, no assumptions.

**Update existing docs. Don't create new ones.** The core docs already exist — CHANGELOG, SPEC, STATE, BugTracker, FuturePlan. Document updates them. It does not create new ad-hoc docs unless the work explicitly requires it (and if it does, it enforces naming conventions on what gets created).

**Write for the next Claude session, not the human.** Entries are for the next Claude session to read cold. Structured, exact, no narrative padding.

---

## STEP 0: READ THE MANIFEST

Find and read `SESSION_MANIFEST_[DATE].md` in the working directory.

This gives you:
- Every file READ this session
- Every file WRITTEN this session
- Every file EDITED this session

This is your work order. Work through it systematically.

**Filtering large manifests:** When a session included investigation-phase subagents (cowboy gather agents, etc.), the manifest may have dozens or hundreds of READ-only entries. Filter to WRITE/EDIT actions first — those are your primary work queue. READ-only subagent entries are background evidence, not work items. Account for them in bulk at Step 5 ("N read-only subagent ops — no doc update needed") rather than processing each one individually.

**Very large manifests (100+ entries):** Use `limit=` and `offset=` parameters to read in pages (e.g., `limit=100, offset=0` then `limit=100, offset=100`). Don't read 180+ lines in a single call — truncation is silent and entries will be missed.

**Multi-project sessions:** If manifest entries span multiple project directories, update each project's core docs separately. Scope each project's CHANGELOG/SPEC/STATE.md strictly to what changed in that project. Don't cross-contaminate.

If no manifest exists (hook not configured): ask the user to describe what was done this session before proceeding.

### STEP 0c: MCP OPERATIONS SUPPLEMENT

The manifest only tracks file system operations (Read/Write/Edit). MCP calls to Google Sheets — `update_cells`, `batch_update`, `get_sheet_data` writes — leave no file system trace. In sheet-heavy sessions, the most impactful work may be entirely invisible to the manifest.

Before Step 1, scan the conversation for MCP write operations:
- Look for `update_cells`, `batch_update`, `mcp__mcp-google-sheets__*` tool calls
- Note what was written: which tab, how many cells, what type of data (values, formulas, schema changes)
- Treat these as WRITE actions for CHANGELOG/SPEC purposes even though they don't appear in the manifest

If context was compacted before document ran: MCP operations from before compaction are unrecoverable from the manifest. Note in the document report: `MCP operations pre-compaction: unrecoverable — record manually if known.` Ask the user if they remember what sheet work was done.

### STEP 0b: COMPACTION RECOVERY CHECK

If the session was compacted/compressed, do not assume the first manifest read is complete.

Run this recovery pass before Step 1:

1. Re-read the latest `SESSION_MANIFEST_[DATE].md` (fresh read, not cached summary).
2. If the user says this is continuation work after compaction, verify the manifest includes current-session file actions.
3. If manifest coverage is incomplete, ask for the missing work items and mark them in the report as `USER-SUPPLIED (post-compact gap)` instead of silently proceeding.

Rule: never claim "manifest doesn't cover this session" and then continue as if coverage is complete.

---

## STEP 1: CATEGORIZE WHAT WAS TOUCHED

Sort manifest entries into buckets:

| What was touched | What needs updating |
|-----------------|-------------------|
| `.gs` files written or edited | CHANGELOG (functional change) |
| `.py` files written or edited | CHANGELOG (functional change) |
| Bug fixed | BugTracker (mark closed + resolution) |
| Feature completed | SPEC (mark done) + FuturePlan (cross off) + CHANGELOG |
| Config/constants changed | STATE.md (decision recorded) + CHANGELOG |
| Sheet schema changed | SPEC or REF_Sheet_Mapping |
| New files created | Naming convention check (see Step 3) |
| Docs edited | Verify status is correct |
| Skills edited | MEMORY.md update |
| CLAUDE.md edited | No additional doc needed — it is the doc |

---

## STEP 2: UPDATE CORE DOCS (IN ORDER)

Work through each affected doc. Order matters — CHANGELOG first because other docs reference it.

### 2a. CHANGELOG.md

For every functional code change this session:

```markdown
## [version] — [YYYY-MM-DD]

### Added
- [What was added — one line per item]

### Changed
- [What was modified]

### Fixed
- [Bugs fixed — reference BugTracker entry if one exists]

### Notes
- [Migration steps, breaking changes, anything user needs to act on]
```

**Version bump rules:**
- New feature or significant addition → minor bump (v4.1.0 → v4.2.0)
- Bug fix or small change → patch bump (v4.1.0 → v4.1.1)
- Breaking change or major rework → major bump (v4.1.0 → v5.0.0)
- If no version exists, ask the user

**One entry per session, not per file.** Group all related changes under a single version entry.

**Large CHANGELOG files:** Projects with long build histories may exceed the 25K token Read limit. Use `limit=50` to read the top of the file and get the latest version number, then prepend your new entry. Don't attempt to read the full file.

### 2b. BugTracker.md

For every bug addressed this session:
- If fixed: mark `[CLOSED]`, add resolution one-liner, add CHANGELOG version reference
- If partially fixed: mark `[PARTIAL]`, note what remains
- If new bug discovered: add new `[OPEN]` entry with what was found

Format:
```
[CLOSED] Bug: [description] — Fixed: [one-line resolution] — See: CHANGELOG v[X.X.X]
```

### 2c. SPEC.md

For any behavior change (new triggers, new data flows, new columns, new batch sizes):
- Update the relevant section
- If a phase/feature is now complete: mark it `[DONE]` or move it to a "Completed" section
- Do NOT rewrite the whole doc — surgical updates only

### 2d. FuturePlan.md

For any items completed this session:
- Mark them done: `~~[item]~~ — Completed [YYYY-MM-DD], see CHANGELOG v[X.X.X]`
- Do NOT delete completed items — strikethrough + reference keeps the history

### 2e. STATE.md

For any decisions made this session:
- Add to `## Decisions` section: `[Decision]: [one-sentence rationale] — [date]`
- Update `## Current Position` if project state changed
- Add session log entry to `## Session Log`

### 2g. Deferred Items

If anything was flagged for user decision during this run and the user deferred or didn't resolve it:

1. Write it to STATE.md under `## Open Flags` (create the section if it doesn't exist):
```
## Open Flags
- [What was flagged] — flagged by /document [YYYY-MM-DD] — Decision needed: [what the options are / what needs to be decided]
```
2. Include it in the Step 5 report under the `Deferred items` bucket (see Step 5).

**Do not leave deferred items as a silent mention in the document report only.** Closeout inherits STATE.md — if the item is there with context, closeout finds it as a named open item. If it's only in the report, closeout re-discovers it cold from the manifest.

### 2f. MEMORY.md (skills/tools work only)

If skills were modified, new skills were created, or workflow patterns were discovered:
- Update the relevant section in the user memory file
- Keep entries concise — MEMORY.md has a 200-line soft limit

---

## STEP 3: NAMING CONVENTION ENFORCEMENT

For every new file created this session, verify it follows the convention below. This is the enforced standard — not a suggestion:

| Prefix | Category | Where it lives |
|--------|----------|---------------|
| `PLAN_` | Implementation plans | Project root → `docs/archive/` when done |
| `HANDOFF_` | Session handoffs | `docs/active/` (root or project) → `docs/archive/` after consumed |
| `SUMMARY_` | Completion summaries | Project root → `docs/archive/` after reviewed |
| `SESSION_` | Session logs | `docs/archive/` after reviewed |
| `REF_` | Permanent reference | `docs/reference/` — no date in name |
| `DEBUG_` | Bug investigation | `docs/active/` → `docs/archive/` when resolved |
| `ARCH_` | Architecture docs | `docs/reference/` — no date in name |
| `BRAINSTORM_` | Phase 1 brainstorms | `docs/active/` → `docs/archive/` after Phase 2 |
| `REQUIREMENTS_` | Interviewer output / spec docs | Project root → `docs/archive/` after build executes |
| `temp_*` | Temporary hold-context | **Delete after use — not for permanent record** |

**Flag any file that doesn't fit:**
```
NAMING FLAG: [filename]
  Current name: [name]
  Should be: [correct name per convention]
  Action: rename? or is this intentionally temp?
```

**Temp files specifically:**
If a file was created to hold context during compact, it should be named `temp_[description]` and is explicitly ephemeral. If it's in the manifest and doesn't have a `temp_` prefix but reads like hold-context material, flag it.

---

## STEP 4: BREADCRUMB PASS

For significant work completed this session, leave a one-liner breadcrumb in STATE.md pointing to where the full detail lives. The breadcrumb is NOT the detail — it's a pointer.

Format:
```
[What was done] — [YYYY-MM-DD] — Full record: [file path or CHANGELOG version]
```

Examples:
```
New skill built — 2026-02-18 — Full spec: .claude/skills/newskill/SKILL.md, notes: MEMORY.md
Sheet flattened — 2026-02-16 — CHANGELOG v4.1.0, design rationale: STATE.md Decisions
```

Breadcrumbs go in `## Session Log` in STATE.md.

---

## STEP 5: REPORT

After updating all docs, report what was done:

```
## Document Report — [YYYY-MM-DD]

**Manifest entries processed:** [N]

**Docs updated:**
- CHANGELOG.md — v[X.X.X] entry added ([N] items)
- BugTracker.md — [N] closed, [N] new open
- SPEC.md — [section] updated
- STATE.md — [N] decisions added, position updated
- MEMORY.md — [what was added]

**Naming flags:** [N]
[List any files with naming issues]

**Temp files in manifest:** [N]
[List temp_ files that still exist — remind user to delete when done]

**Deferred items:** [N]
[List items flagged for user decision that were not resolved — each written to STATE.md ## Open Flags]

**Read-only subagent ops:** [N] entries — no doc update needed
[Brief note if the count is unusually high]

**Nothing found for:** [list manifest entries that didn't require doc updates — read-only files, etc.]
```

---

## RULES

1. **Manifest first. Always.** Read the session manifest before doing anything. It is the source of truth for what happened.
2. **Post-compact recovery is mandatory.** If context was compacted, run Step 0b before processing.
3. **Update, don't create.** Existing core docs get updated. New docs only when the work explicitly requires it (new feature = new PLAN, etc.) and only with correct naming.
4. **One CHANGELOG entry per session.** Don't create multiple entries for the same session's work. Group it.
5. **Breadcrumbs, not novels.** Don't duplicate detail across docs. One doc holds the full record; others point to it.
6. **Temp means temp.** `temp_*` files are flagged every time they appear in the manifest. They have no permanent status.
7. **Mark done items done.** Strikethrough in FuturePlan, CLOSED in BugTracker, DONE in SPEC. Don't leave completed work looking like it's still pending.
8. **AI-first format.** Every entry written for the next Claude session to read cold. No narrative, no pleasantries, no "as mentioned above."
9. **Nothing left unaccounted.** Every manifest entry gets a status: updated a doc, flagged for naming, confirmed read-only (no doc needed), or explicitly noted as skipped with reason.

---

## WHEN TO RUN

| Situation | Command |
|-----------|---------|
| Completed a feature mid-session | `/document` |
| Fixed a bug | `/document` |
| About to compact | `/document` first |
| Session ending, no pending work | `/document` then `/closeout` |
| Session ending, pending work | `/document` then `/handoff` |
| "Let's document what we did" | `/document` |

---

## REMEMBER

> The record exists for the next Claude session, not for the human.
> If it was touched, it's accounted for.
> If it's done, it looks done.
