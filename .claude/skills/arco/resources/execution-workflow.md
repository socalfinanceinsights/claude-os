# Execution Workflow

Step-by-step process for ARCO's Execute mode — receiving an implementation plan and driving it to completion with his team.

---

## Prerequisites

Before ARCO executes anything:

1. **Implementation plan exists.** ARCO does not create plans. Builder creates plans. ARCO receives them.
2. **Plan touches GAS/Sheets.** If the plan has no GAS or Sheets work, reject: "Nothing here for me. Route to /build."
3. **Plan is specific enough.** ARCO needs: which files, which sheets, what changes, what success criteria. If the plan is vague, produce a handoff back to builder with what's missing.

---

## Phase 1: INTAKE

Read the implementation plan. Identify every task that touches ARCO's domain.

### 1a: Categorize tasks

For each task in the plan:

| Category | Signal | Routes To |
|----------|--------|-----------|
| Schema change | New columns, new sheets, restructure, migration | sheet_architect |
| Formula | New formula, fix formula, array formula, cross-sheet ref | Formula1 |
| Apps Script | New function, modify .gs, integration, trigger | GASexpert → reagan |
| Non-domain | Python, docs, non-Sheets work | Skip — not ARCO's job |

### 1b: Dependency ordering

Determine execution order based on dependencies:

```
1. Schema changes FIRST (other work depends on structure)
2. Formulas SECOND (may depend on new columns)
3. Apps Script THIRD (may reference new columns + formulas)
4. Verification LAST (reagan verifies the whole batch)
```

Tasks within the same category with no mutual dependencies can run in parallel.

### 1c: Pre-flight checks

Before spawning any agent:

1. **Sheet schema snapshot.** Pull current headers via MCP for every sheet the plan touches. Compare against plan assumptions. Flag mismatches immediately.
2. **Column mapping verification.** If plan references columns by letter (A, B, C), verify those letters match actual headers. Column letters shift — header names don't.
3. **Existing code scan.** Read relevant .gs files. Check for function name conflicts (Apps Script global namespace).
4. **Guardian assessment.** Any task writing to sheets → ensure guardian is injected into the spawned agent.

Present spawn plan to user:

```
ARCO — Execution Plan

Source: [PLAN filename]
Tasks in my domain: [N] of [total]

Execution order:
  1. sheet_architect: [task description]
  2. Formula1: [task description]
  3. GASexpert: [task description(s)]
  4. reagan: verify all changes

Pre-flight:
  Sheet schemas verified: [Y/N — details]
  Column mappings confirmed: [Y/N]
  Namespace conflicts: [none / list]

Proceed?
```

---

## Phase 2: EXECUTE

### 2a: Spawn agents (Runtime Read pattern)

For each task in dependency order:

1. Read the agent profile from `.claude/agents/[name].md`
2. Extract YAML frontmatter (model, tools, skills)
3. Extract body content
4. Construct spawn prompt:

```
[agent profile body]

---
## Your Task

**Objective:** [what to accomplish]

**Output format:**
## Completion Report
- Files created/modified: [list]
- Changes made: [detail]
- Column mappings affected: [if applicable]
- Deviations from plan: [any, with justification]

**Tools:** [from profile YAML + task requirements]

**Boundary:** [what NOT to do — scope limits]
```

5. Spawn via Task tool:

```
Task(
  subagent_type: "general-purpose",
  model: [from agent YAML],
  run_in_background: [true for parallel, false for sequential],
  prompt: [agent body + filled task]
)
```

### 2b: Collect results

After each agent completes:

- Parse completion report
- Check for deviations from plan
- Check for column mapping changes (critical — log these)
- Check for blockers

**If blocker found:** Stop. Do not spawn next agent. Report to user.

### 2c: Verify via reagan

After all code-writing agents complete:

1. Read `.claude/agents/reagan.md`
2. Construct verification task:

```
[reagan profile body]

---
## Your Task

**Objective:** Push code changes and verify everything works.

**Output format:**
## Verification Report
- Push status: [OK / FAILED]
- Test results: [per function]
- Sheet state: [column headers match expectations Y/N]
- Data integrity: [if applicable]

**Tools:** Bash (clasp push/run), Read, Grep, Glob, MCP

**Boundary:** Only verify. Do not rewrite code unless fixing a trivial push error
(missing semicolon, syntax). If a test fails, report — do not fix.
```

3. Spawn reagan (foreground — ARCO waits).

### 2d: Handle failures

| Failure Type | Response |
|-------------|----------|
| Push fails (syntax) | reagan auto-fixes if trivial. Otherwise ARCO reports to user. |
| Push fails (namespace) | ARCO diagnoses conflict, proposes rename, asks user. |
| Test fails | ARCO reviews failure. If root cause is clear → re-spawn GASexpert with fix instructions. If unclear → spawn debugger with the error and failing code → re-spawn GASexpert with debugger's fix recommendation. If debugger cannot isolate root cause → recommend `/flyswatter`. |
| Sheet schema mismatch | ARCO flags immediately. Does NOT proceed. Column drift is the #1 source of GAS bugs. |

**Escalation ceiling — no infinite loops:**

If the same failure type recurs more than twice for the same root cause — stop the loop. Do not re-spawn. Escalate to the user with the specific error output and diagnosis. Iterating further will not resolve a systemic issue. Present:

```
ARCO — Escalation Required

Failure: [error text]
Root cause diagnosis: [what ARCO believes is happening]
Attempts made: [N]
Why further iteration won't help: [explanation]

Recommended next step: [/flyswatter / manual intervention / config fix / auth fix]
```

---

## Phase 3: CLOSE

### 3a: Documentation update

After verification passes:

1. **Column mapping log.** If any columns were added, removed, or reordered — document in the project's SPEC.md or STATE.md.
2. **Function inventory.** If new .gs functions were created — add to SPEC.md function list.
3. **CHANGELOG entry.** If the execution was part of a versioned build.

### 3b: Completion report

```
ARCO — Execution Complete

Plan: [filename]
Tasks executed: [N]
  sheet_architect: [N] tasks
  Formula1: [N] tasks
  GASexpert: [N] tasks

Verification: [PASS/FAIL]
  Push: [OK]
  Tests: [N/N passed]
  Schema: [verified — no drift]

Column changes:
  [list any column additions/removals/renames]

Docs updated:
  [list]

Issues found: [none / list]
```

---

## Single-Task Shortcut

If ARCO receives a single, simple task (one file, one function, obvious change):

- Skip the full execution plan ceremony
- Still do pre-flight schema check
- Spawn the appropriate agent directly
- Still verify via reagan if Apps Script
- Still document column changes

The workflow scales down. The safety checks don't.
