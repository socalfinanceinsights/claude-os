---
name: closeout
description: "Session closeout and doc hygiene. Activates when user signals session end: 'wrapping up', 'closing this thread', 'done for now', 'that's it', 'end session', '/closeout'. Reviews session manifest, verifies doc statuses, ensures nothing is left orphaned."
context: fork
---

# SKILL: CLOSEOUT (Session End & Doc Hygiene)

## TRIGGER
Activate when user signals session end:
- "wrapping up" / "closing this thread" / "done for now" / "that's it"
- "end session" / "let's wrap" / "I'm done"
- `/closeout` (manual invocation)

---

## CLOSEOUT WORKFLOW

### Step 1: Find the Session Manifest

Do not rely on current working directory in forked context.

First, determine **local system date** from shell and treat that as the only authority for date-stamped filenames:
- PowerShell: `Get-Date -Format yyyy-MM-dd`
- Bash: `date +%Y-%m-%d`

Call this value `LOCAL_TODAY`.

Locate `SESSION_MANIFEST_[LOCAL_TODAY].md` using this order:
1. Workspace root `SESSION_MANIFEST_[LOCAL_TODAY].md` (primary source of truth).
2. If missing, search the workspace root for `SESSION_MANIFEST_[LOCAL_TODAY].md` and prefer the active project-root match when in a numbered project.
3. If multiple fallback matches remain, choose the most recently modified file and state the selected path in the closeout summary.

**Date mismatch guard:** If model/system "today" differs from `LOCAL_TODAY`, always use `LOCAL_TODAY` for manifest selection and any date-stamped output file names.
Do not create a future-dated manifest unless local system date has actually rolled over.

**If a manifest is found:** proceed to Step 2.

**If no manifest is found:** Build one manually by reviewing the conversation. List every file you Read, Wrote, or Edited during this session. Then proceed to Step 2.

---

### Step 2: Review Each File Touched

For every file in the manifest with a WRITE or EDIT action:

**Check its current state and assign a status:**

| Status | When to Use |
|--------|-------------|
| `COMPLETED` | Work on this file is done. No follow-up needed. |
| `IN_PROGRESS` | File was started but not finished. Needs more work next session. |
| `NEEDS_REVIEW` | File was created/updated but user hasn't confirmed it's correct. |
| `ARCHIVED` | File should be moved to `docs/archive/`. |
| `MOVED → [path]` | File was moved to a new location during the session. |
| `PAUSED` | Work was intentionally paused (blocked, waiting on info, etc.). |
| `NO_ACTION` | File was read but not modified. Informational only. |

---

### Step 3: Check Doc Lifecycle Rules

For any `.md` files created this session, verify they follow naming/lifecycle rules:

| Prefix | Expected Location | Action If Wrong |
|--------|-------------------|-----------------|
| `PLAN_` | Project root | Flag for user |
| `HANDOFF_` | `docs/active/` (root or project) | Flag for user |
| `REQUIREMENTS_` | Project root | Flag for user |
| `SUMMARY_` | Project root | Flag for user |
| `SESSION_` | Project root | This is the manifest itself — OK |
| `DEBUG_` | `docs/active/` | Flag for user |
| `BRAINSTORM_` | `docs/active/` | Flag for user |
| `REF_` | `docs/reference/` | Flag if misplaced |
| `ARCH_` | `docs/reference/` | Flag if misplaced |

**Completed PLAN_, HANDOFF_, REQUIREMENTS_, SUMMARY_, DEBUG_ files** should be proposed for move to `docs/archive/`. Do NOT move them — propose it and let the user confirm.

---

### Step 3b: Memory Hygiene

Memory files auto-load into every session. Closeout owns the write-back loop — checking whether entries are still true, pruning stale ones, and capturing new durable learnings.

**Run every session.** This step does not require code edits to trigger.

**What belongs in memory vs. what doesn't:**

| Belongs in memory | Does NOT belong in memory |
|-------------------|--------------------------|
| Durable API gotchas (rate limits, SDK quirks) | Batch job IDs and run statuses |
| Voice/style patterns learned from corrections | In-progress work tracking |
| Architecture decisions that affect future builds | Project TODO lists |
| Anti-patterns confirmed across multiple sessions | One-session workarounds |
| Tool constraints (clasp flags, MCP behaviors) | Historical records of what happened |

**Workflow:**

1. Read all files in your memory directory.

2. **Stale entry scan** — flag any entry containing:
   - Status markers: `IN PROGRESS`, `IN_PROGRESS`, `BATCH SUBMITTED`, `PENDING`
   - TODO lists or checklist items
   - Batch job IDs, file counts, specific row numbers
   - Date-specific operational data (e.g., "expires in 16 days from X date")
   - "Pending" sections describing work not yet done

3. **Session invalidation check** — did anything done this session contradict a memory entry?
   - Example: shipped agent profiles → any memory entry saying profiles don't exist yet is now wrong
   - Example: deleted a script → memory references to that script path are now wrong

4. **New learnings check** — did this session surface anything worth capturing?
   - Only write if durable and cross-session useful
   - Do NOT write project state — that belongs in project STATE.md or CHANGELOG.md
   - Do NOT write things already covered by CLAUDE.md or skill files

5. **Present findings — do not auto-execute:**

```
## Memory Health Check

**Stale entries found:**
- [filename] — [reason]. Recommend [deletion / update].

**Invalidated by this session's work:**
- [list entries this session made false, or "None"]

**New learnings worth capturing:**
- [durable patterns surfaced this session, or "None"]

Approve memory updates? [yes/no per item]
```

6. **On approval:** Execute updates. For deletions, confirm with user before removing files. Add `**Last-Reviewed:** YYYY-MM-DD (closeout)` to the header of any memory file touched — this creates a visible staleness signal for future reviews.

**If memory looks clean:** Output "Memory looks current. No action needed." and move on to Step 4. Do NOT block closeout on memory updates — they are optional hygiene, not mandatory gates.

---

### Step 4: Documentation Drift Check

If Claude EDITED any code files (`.gs`, `.js`, `.py`, etc.) or sheet structures during this session, check whether those changes affect any documented content.

**Tier 1 — Source of Truth (check every session):**

| Doc | What Might Be Stale | Trigger |
|-----|---------------------|---------|
| `SPEC.md` | Phase status, "Due Next" items, feature descriptions | Completed a feature, advanced a phase, changed system behavior |
| `CHANGELOG.md` | Missing entry for this session's work | Any code edit that changes functionality |
| `BugTracker.md` | Bug still marked "Open" that was fixed | Fixed a bug during this session |
| `FuturePlan.md` | Item still listed that was completed, or new items discovered | Completed a roadmap item, or identified new work during session |

**Tier 2 — Structural Reference (check if changes are structural):**

| Doc | What Might Be Stale | Trigger |
|-----|---------------------|---------|
| `REF_Sheet_Mapping.md` / `REF_Sheets_Reference.md` | Tab names, column layouts, column letters | Added/renamed/deleted a tab or column |
| `ARCH_Tab_Relationships.md` | Data flow diagrams, import pipelines | Changed how data moves between tabs |
| `REF_*_Formulas.md` | Formula documentation | Added/changed/removed sheet formulas |
| `ARCH_Data_Flow*.md` | Pipeline architecture | Changed script logic that affects data flow |
| Any other `REF_*` or `ARCH_*` in `docs/reference/` | Content specific to that doc | Changed something the doc describes |

**Workflow:**
1. For each Tier 1 doc: Does it exist in this project? Did this session's work affect it?
2. For each Tier 2 doc: Did this session involve structural changes (tabs, columns, formulas, data flow)?
3. For anything flagged → **list it for the user.** Do NOT auto-update.

**Format:**
```
Docs that may need updating:

Tier 1:
- SPEC.md — You completed [feature] which matches item marked "Due Next"
- CHANGELOG.md — No entry for today's changes
- FuturePlan.md — Completed item "[X]" still listed as upcoming

Tier 2:
- REF_Sheet_Mapping.md — You added column "Score_Override" to ICP_Score tab

Want me to update any of these?
```

**Key rule:** Only flag if Claude actually EDITED code/data that relates to a documented item. Reading docs for context does NOT create update responsibility.

---

### Step 4b: STATE.md Maintenance

If a `STATE.md` exists in the current project:

1. **Update session log:** Add an entry for this session's work.
2. **Check blockers:** Are any listed blockers now resolved? Remove them.
3. **Check size:** If STATE.md exceeds 150 lines:
   - Move decisions older than 30 days to `docs/archive/ARCHIVE_Decisions_{ProjectName}.md`
   - Keep only recent decisions in the active Decisions table
   - Add note: "Older decisions archived: see docs/archive/ARCHIVE_Decisions_{ProjectName}.md"
   - This happens automatically — no user confirmation needed for archival
4. **Update Current Position:** Set Active Plan to "None" and Status to "Idle" if no work is in progress.

If no `STATE.md` exists, skip this step. STATE.md is created by the builder skill, not by closeout.

---

### Step 5: Check for Orphaned Temp Files

Scan for:
- `temp_*` scripts in `scripts/` → propose deletion
- `99_*` scripts that were one-time fixes → propose move to `scripts/archive/`
- Root-level loose `.md` files that should be in `docs/` → propose move

**Do NOT delete or move anything.** List what you found and recommend actions.

**Canonical TODO file hygiene:** Before updating the canonical TODO file, check whether the active canonical TODO filename date matches the **local system date**. If not, archive the old file by moving it to `TODOarchive/` and create a new `TODO_[local-date].md` file. Then update the new file.

---

### Step 5b: Execute Approved Cleanup

When the user approves any subset of Step 5 recommendations:

1. **If any approved move targets an archive path, collect a pre-approval keyword from the user first.**
   - Required command token: `ARCHIVE_OK=<keyword>`
   - Add the token to the same Bash command that performs the archive move.
   - Example: `ARCHIVE_OK=closeout_2026-02-21 mv PLAN_X.md docs/archive/`

2. **Perform the approved moves immediately.**
3. **Log every file move to the project's `FILEMOVEMENT.log` before moving on.** Do not defer this to a separate document/closeout run.

Log format:
```
[YYYY-MM-DD] | MOVE | [filename] → [destination] | reason=closeout cleanup
[YYYY-MM-DD] | DELETE | [filename] | reason=closeout cleanup — confirmed by user
```

If `FILEMOVEMENT.log` doesn't exist in the project root, create it with a header line then append:
```
# File Movement Log — [Project Name]
```

4. **Update the session manifest** with `MOVED → [path]` or `ARCHIVED` status for each affected file.

This step is mandatory whenever the user approves any cleanup action. The logging is not optional.

---

### Step 5c: README Currency Check

Before closing, consider which directories were meaningfully changed this session:

- New scripts added to a project's `scripts/` dir → that dir's README may need a Contents update
- New skills, agents, or hooks added → `.claude/skills/`, `.claude/agents/`, or `.claude/hooks/` README may need updating
- Project scope or architecture changed → project root README operational notes may be stale

**If any READMEs are out of date:** either update them inline (if 1-2 small edits) or note them in the session manifest as "README update needed: [path]" for the next session.

This step is a check, not a full audit. If nothing meaningful changed in a directory, skip it and move on.

---

### Step 6: Update the Manifest

Update the Status column in `SESSION_MANIFEST_[DATE].md` with the statuses from Step 2.

---

### Step 7: Present Summary to User

Format:

```
## Session Closeout Summary

### Files Modified This Session
- `scripts/01_Main.gs` — COMPLETED
- `docs/active/PLAN_New_Feature.md` — IN_PROGRESS (needs Phase 2)
- `docs/reference/REF_Sheets_Reference.md` — NEEDS_REVIEW

### Housekeeping Recommendations
- Move `PLAN_Old_Feature_2026-02-01.md` → `docs/archive/` (completed)
- Delete `scripts/temp_test_api.gs` (one-time test)

### Notes for Next Session
- [Any context the next Claude session would need]

### Thread Label
**Title:** [3-4 word title] [YYYY-MM-DD] | **Status:** [Completed/Handed Off/Paused/Abandoned]
**Summary:** [One sentence on what was done]
```

The Thread Label section gives the user a quick label they can use to rename the session in their sidebar. Always include it as the last item in the closeout summary.

---

## RULES

1. **NEVER delete files.** Only propose deletions. User must confirm.
2. **When cleanup is approved, log it immediately.** Every file move or deletion performed during closeout gets logged to FILEMOVEMENT.log in the same action. Do not leave this for a subsequent /document or /closeout run.
3. **NEVER skip the manifest review.** Even if the session was short.
4. **Be honest about statuses.** If something was left half-done, say `IN_PROGRESS`, not `COMPLETED`.
5. **Keep it brief.** The closeout summary should be scannable in 10 seconds.
6. **Update the manifest file** so there's a written record, not just a chat message.
7. **Use lightweight sub-agents for doc updates when available.** After the user approves which docs to update, delegate markdown-heavy edits to helper agents if the runtime supports it. If helper agents are unavailable, write updates directly in the main session — don't block on model optimization.
8. **Archive moves must include pre-approval token in Bash commands.** Use `ARCHIVE_OK=<keyword>` for archive paths so `bash-guard.sh` can validate approval.
9. **Canonical TODO file must match local system date.** Before writing to the canonical TODO file, verify the filename date matches local shell date. If not, archive the old file and create a new `TODO_[local-date].md` before updating it.

---

## INTEGRATION

### With Session Manifest Hook
The `session-manifest.sh` PostToolUse hook auto-populates the manifest. Closeout reads the generated manifest file regardless of hook implementation.

### With Builder Skill
Builder updates STATE.md after each wave and at build completion. If Builder was active during the session, Closeout should verify STATE.md was updated and check that Builder's documentation closeout was completed (CHANGELOG, SPEC, PLAN archival).

### With STATE.md
STATE.md is the cross-session memory file. Closeout owns archival: when STATE.md exceeds 150 lines, old decisions get moved to `docs/archive/`. See Step 4b above.

---

## REMEMBER

> The goal is not paperwork. It's preventing the slow accumulation of orphaned docs, half-finished plans, and mystery files that nobody remembers creating.

Closeout takes 2 minutes. Cleaning up a messy project folder after 3 months of neglect takes hours.
