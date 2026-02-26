---
name: flyswatter
description: "Bug triage, root cause analysis, and systematic repair. Activates on '/flyswatter', 'debug', 'fix', 'bug', 'not working', or 'troubleshoot'. Handles all 3 stages: Intake/Diagnosis, Solution Design, Implementation/Closeout."
context: fork
---

# SKILL: FLYSWATTER (Triage, RCA, & Repair)

## TRIGGER

Activate when:
1. User shares execution logs, error screenshots, or "not working" reports
2. User says "debug", "fix", "error", "bug", "investigation", "troubleshoot"
3. User runs `/flyswatter`
4. Multiple errors need prioritization and systematic resolution

**Do NOT activate when:**
- User wants code written from scratch → route to `/build`
- User wants code cleaned up or consolidated → route to `/refactorer`
- User wants a feature planned → route to `/interview`

---

## BOUNDARY: FLYSWATTER vs DEBUGGER AGENT PROFILE

These are separate things with the same ancestry:

| | Flyswatter (this skill) | Debugger (agent profile) |
|---|---|---|
| **What** | Interactive skill | Agent profile at `.claude/agents/debugger.md` |
| **Invoked by** | User via `/flyswatter` | Orchestrating skills (cowboy, etc.) |
| **Scope** | All 3 stages: diagnose + design fix + apply fix | Diagnosis only — returns recommendations |
| **Applies fixes?** | Yes | No — hands off to spock or another agent |
| **Runs in** | Forked context (isolated from main session) | Subagent context (spawned by orchestrator) |

Flyswatter is the full-service bug tool for the user. The debugger agent profile is a diagnostic component for orchestrators.

---

## QUICK REFERENCE

**Common bug patterns:** See [resources/bug-patterns.md](resources/bug-patterns.md)
- API timeout/malformed response
- Column mapping mismatch
- Batch size timeout
- Label application failure
- Smart resume not working

**Error correlation:** See [resources/error-sources.md](resources/error-sources.md)
- Apps Script execution logs
- ErrorLog sheet
- User reports
- BugTracker.md historical context
- Cross-source correlation strategy

**Verification strategies:** See [resources/verification.md](resources/verification.md)
- Monitor next execution logs
- Manual test
- User confirmation
- Monitor over time (24-48 hours)

**BugTracker.md format:** See [resources/bugtracker-format.md](resources/bugtracker-format.md)
- File header and status summary
- Individual bug entry template
- Complete lifecycle examples

---

## BUG TRACKING FILES (IMPORTANT DISTINCTION)

### BugTracker.md (Bug Documentation)
- **Location:** `[ProjectName]/BugTracker.md` (project root, next to SPEC.md)
- **Purpose:** Historical record of all bugs and fixes
- **Append only:** NEVER archive, keeps growing as permanent reference
- **Structure:** Date-stamped entries for each bug

### ErrorLog Sheet (Runtime Script Errors)
- **Location:** Google Sheets tab "ErrorLog"
- **Purpose:** Script-generated errors during execution
- **Structure:** DateLog | SourceID | ErrorCode | SourceTitle | ErrorDefinition | Resolved?
- **Managed by:** Apps Script code (not manual)

**These are DIFFERENT files serving different purposes.**

---

## THE 3-STAGE WORKFLOW

### Stage 1: INTAKE & DIAGNOSIS (Don't fix yet!)

**Goal:** Understand what broke, where, and why

**Actions:**
1. Read execution logs, screenshots, user descriptions
2. Correlate across error sources (logs, ErrorLog sheet, user reports)
3. Identify affected code/files
4. Trace data flow to find break point
5. Determine root cause

**Output:** Written diagnosis in BugTracker.md

**STOP POINT:** Do NOT write code yet. Do NOT propose fixes yet. Just diagnose.

**See [resources/error-sources.md](resources/error-sources.md) for correlation techniques.**

---

### Stage 2: SOLUTION DESIGN (Get approval before fixing)

**Goal:** Propose fix approach and get user approval

**For EASY bugs:** State the straightforward fix and pause for confirmation.

**For MEDIUM bugs:** Explain the calculation/logic and pause for confirmation.

**For HARD bugs:** Present options with trade-offs, recommend approach, pause for decision.

**STOP POINT:** Wait for user approval. Update BugTracker.md status to "APPROVED" when user confirms.

**See [resources/bug-patterns.md](resources/bug-patterns.md) for standard fixes.**

---

### Stage 3: IMPLEMENTATION & CLOSEOUT

**Goal:** Apply fix, verify, document

**Actions:**
1. Implement the approved fix
2. Verify the fix works (see [resources/verification.md](resources/verification.md))
3. Update BugTracker.md: Status → RESOLVED (or MONITORING)
4. Update CHANGELOG.md with fix details
5. Update SPEC.md if system behavior changed

**For complex multi-file fixes (>3 files):**
- Create `PLAN_[Feature]_[YYYY-MM-DD].md` before implementing

**See [resources/bugtracker-format.md](resources/bugtracker-format.md) for complete format.**

---

## BUG PRIORITIZATION

When multiple bugs exist, prioritize using this matrix:

**Priority 1 (CRITICAL):** System broken, no data processing
**Priority 2 (HIGH):** Data quality issues, user-facing problems
**Priority 3 (MEDIUM):** Performance, non-blocking operational issues
**Priority 4 (LOW):** Cosmetic, formatting, nice-to-have

---

## RULES

1. **Diagnose before fixing.** Stage 1 must complete before Stage 2 begins. No jumping to code.
2. **Get approval before implementing.** Stage 2 must get user approval before Stage 3 begins.
3. **Document in BugTracker.md.** Every bug gets a dated entry. Append only — never archive.
4. **Verify after fixing.** Choose the right verification strategy from `resources/verification.md`. Never assume the fix worked.
5. **Reference GAS patterns when fixing Apps Script.** Check gas_expert standards for batch operations, error handling, quotas.
6. **Check guardian patterns when fixing sheet operations.** Column mapping, data safety, scope verification.
7. **Don't scope-creep.** Fix the bug, not adjacent code. If you find other problems, log them separately.
8. **Context is forked.** You start clean. If you need context from a prior session, ask the user to provide it or reference a handoff doc.

---

## REMEMBER

> Diagnose first, fix second. Document forever.
> Flyswatter handles all 3 stages — diagnosis through fix.
> The debugger agent profile is a separate tool for orchestrators. Don't confuse them.
> Always pause between stages. Never jump from diagnosis to code.

**Resources:**
- [bug-patterns.md](resources/bug-patterns.md) — Common patterns and standard fixes
- [error-sources.md](resources/error-sources.md) — Correlation techniques
- [verification.md](resources/verification.md) — Verification strategies
- [bugtracker-format.md](resources/bugtracker-format.md) — Documentation format
