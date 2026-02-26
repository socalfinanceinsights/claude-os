# Agent Routing

ARCO's team roster and routing logic. Read this when deciding which agent to spawn for a task.

---

## Primary Team (ARCO-specific)

| Agent | Domain | When to Spawn | Standards Libraries Injected |
|-------|--------|---------------|------------------------------|
| **sheet_architect** | Structural schema changes | Adding/removing/reordering columns, designing new sheets, restructuring data layout, migration plans | `sheet_architect` |
| **Formula1** | Google Sheets formulas | Writing formulas, ARRAYFORMULA patterns, cross-sheet references, VLOOKUP/INDEX-MATCH, conditional formatting rules | `sheet_architect` (schema awareness) |
| **GASexpert** | Apps Script code | Writing .gs files, API integrations, trigger setup, clasp workflows, function creation/modification | `gas_expert`, `guardian` (if sheet writes) |

## Shared Resources

| Agent | Domain | When ARCO Uses Them |
|-------|--------|---------------------|
| **reagan** | Verification | After GASexpert completes code — clasp push, test runs, data verification. Always spawned for verification. |
| **spock** | General code | Rarely. Only if task involves non-GAS code alongside GAS work (e.g., Python helper script). GASexpert is preferred for anything Apps Script. |
| **sheets-dba** | Schema design analysis | When a task involves data structure decisions — column placement, lookup design, migration planning. Analysis only; sheet_architect implements. |
| **debugger** | Code diagnosis | When reagan verification fails with unclear root cause. Spawn debugger → get root cause + fix recommendation → re-spawn GASexpert to apply. |
| **guardian** | Safety | Injected (not spawned) into any agent performing destructive sheet writes — bulk deletes, column removes, data overwrites. |

---

## Routing Decision Tree

```
Task received
│
├─ Structural change? (columns, sheets, schema)
│  └─ Spawn sheet_architect
│
├─ Formula work? (functions, array formulas, cross-sheet refs)
│  └─ Spawn Formula1
│
├─ Apps Script code? (new function, modify .gs, integration)
│  └─ Spawn GASexpert
│     └─ After GASexpert completes → Spawn reagan (verify)
│
├─ Mixed task? (schema + code + formulas)
│  └─ Decompose into sequential steps:
│     1. sheet_architect (structural changes first)
│     2. Formula1 (formulas that depend on structure)
│     3. GASexpert (code that references new columns/formulas)
│     4. reagan (verify everything)
│
├─ Non-GAS/Sheets work?
│  └─ REJECT. "This isn't my domain. Route to /build or /cowboy."
│
└─ Unclear scope?
   └─ Ask user to clarify before spawning anyone.
```

---

## Spawn Rules

1. **One agent per task.** Don't spawn sheet_architect AND GASexpert for the same task. Decompose first.
2. **Structural changes precede code changes.** sheet_architect runs before GASexpert when both are needed — code depends on schema.
3. **Formulas precede code that reads them.** Formula1 runs before GASexpert if code references formula outputs.
4. **Reagan always verifies GAS code.** No exceptions. GASexpert writes local, reagan pushes and tests.
5. **Guardian injected, not spawned.** Guardian is a standards library — inject into the agent's `skills` field, don't spawn guardian separately.
6. **Runtime Read pattern on every spawn.** Read `.claude/agents/[name].md` at spawn time. Never hardcode prompts.
7. **Four-part task description on every spawn.** Objective, Output format, Tools, Boundary.

---

## Agent Profiles — Build Status

| Profile | Status | Notes |
|---------|--------|-------|
| sheet_architect (agent) | BUILT | `.claude/agents/sheet_architect.md` |
| Formula1 | BUILT | `.claude/agents/formula1.md` |
| GASexpert (agent) | BUILT | `.claude/agents/gasexpert.md` |
| reagan | BUILT | `.claude/agents/reagan.md` — shared with builder/cowboy. |
| spock | BUILT | `.claude/agents/spock.md` — shared with builder. |
| sheets-dba | BUILT | `.claude/agents/sheets-dba.md` — shared with cowboy. |
| debugger | BUILT | `.claude/agents/debugger.md` — shared with builder/cowboy. |

All profiles operational. ARCO Execute mode is fully enabled.
