# AGENTS.md - Codex Workspace Instruction Router

Purpose:
- Codex-specific instruction file for your workspace.
- Mirror Claude command + skill behavior so workflows feel the same across both environments.

Scope:
- Applies to this workspace root and all project folders.

## 1) Shared Source of Truth

Read these first at session start:
1. `CLAUDE.md` (global preferences, laws, project standards)
2. `AGENTS.md` (Codex routing + execution parity rules)

When a skill/agent is invoked, load:
3. `.claude/skills/[skill]/SKILL.md`
4. `.claude/agents/[agent].md` (for orchestrated subagent behavior)

When rules conflict:
1. User instruction in current chat
2. `AGENTS.md`
3. `CLAUDE.md`
4. Skill or agent profile body

## 2) Slash Command Compatibility (Claude Parity)

Codex does not have native slash commands. Emulate them by routing the first token in the user message.

Parsing rule:
- If message starts with `/name`, treat `/name` as command.
- Strip the command token and pass the remainder as arguments/context.

Direct skill slash aliases (no command file required):
- `/claudepa` -> `claudepa`
- `/claudepa-closeout` -> `claudepa-closeout`
- `/closeout` -> `closeout`
- `/contrarian` -> `contrarian`
- `/cowboy` -> `cowboy`
- `/document` -> `document`
- `/flyswatter` -> `flyswatter`
- `/handoff` -> `handoff`
- `/hookmaster` or `/hook_master` -> `hookmaster`
- `/refactorer` -> `refactorer`
- `/skill-creator` or `/skill_creator` -> `skill-creator`
- `/skillaudit` -> `skillaudit`
- `/skillsmanager` -> `skillsmanager`
- `/visualizer` -> `visualizer`

Legacy alias compatibility:
- `/debugger` -> `flyswatter` (or `debugger` agent profile for diagnosis-only tasks)
- `/orchestrate` -> `cowboy` (general orchestration) unless user specifies build execution (`builder`)
- `/scaffold` or `/scaffolder` -> `builder` Wave 0 with `framer` agent

If user names a skill directly (`use cowboy`, `$cowboy`, etc.), load that skill even without slash command.

## 3) Skills Location + Loading Rules

Skill root: `.claude/skills`

Current local skills (directory contains `SKILL.md`):
- `builder`
- `claudepa`
- `claudepa-closeout`
- `closeout`
- `contrarian`
- `cowboy`
- `document`
- `flyswatter`
- `gas_expert`
- `guardian`
- `handoff`
- `hookmaster`
- `interviewer`
- `python_workspace`
- `refactorer`
- `sheet_architect`
- `skill-creator`
- `skillaudit`
- `skillsmanager`
- `visualizer`

Skill role split:
- Interactive/orchestrating: `builder`, `claudepa`, `claudepa-closeout`, `closeout`, `contrarian`, `cowboy`, `document`, `flyswatter`, `handoff`, `hookmaster`, `interviewer`, `refactorer`, `skill-creator`, `skillaudit`, `skillsmanager`, `visualizer`
- Standards/injected libraries: `gas_expert`, `guardian`, `python_workspace`, `sheet_architect`

Loading protocol:
1. Open the selected skill's `SKILL.md`.
2. Follow its workflow.
3. Resolve relative references from that skill directory first.
4. Load only the minimum extra files needed.

## 3B) Agent Profiles (Claude Parity)

Agent profile root: `.claude/agents`

Current profiles:
- `chef`
- `debugger`
- `dragnet`
- `formula1`
- `framer`
- `gasexpert`
- `oracle`
- `reagan`
- `scout`
- `shakespeare`
- `sheet_architect`
- `sheets-dba`
- `spock`
- `velma`

Orchestration doctrine: `docs/reference/REF_Subagent_Manifesto.md`
- Canonical rules for when to spawn subagents, foreground vs background, MCP constraints, and wave patterns.
- Any skill that spawns agents must be consistent with the manifesto before deployment.

Agent loading protocol:
1. For orchestrating skills, read `.claude/agents/[name].md` at runtime (Runtime Read pattern).
2. Honor profile frontmatter intent (`model`, `tools`, `skills`) when routing or simulating behavior.
3. Do not hardcode agent prompts inside skills when profile exists.
4. If user names an agent directly (`use spock`, `run scout pass`), load that profile as the execution style.

Agent profile quick-reference:

| Profile | Type | Description |
|---------|------|-------------|
| `chef` | Sonnet | Synthesis agent. Cross-references findings from multiple gather agents. |
| `debugger` | Sonnet | Diagnosis-only. Alias: `/debugger` |
| `dragnet` | Sonnet | Deep investigation agent (code, config, and live sheet data via MCP) |
| `formula1` | Sonnet | Formula writing and debugging |
| `framer` | Haiku | Scaffold and document structure |
| `gasexpert` | Sonnet | Google Apps Script writer/reviewer |
| `oracle` | Opus | Heavy synthesis agent for architectural-level analysis |
| `reagan` | Sonnet | GAS deployment and sheet operations |
| `scout` | Haiku | Read-only reconnaissance agent. Inventories files, extracts headers, scans content. |
| `shakespeare` | Sonnet | Doc writer. Writes SKILL.md files, README files, HANDOFF docs, TODO tickets, STATE.md, and any structured markdown content. |
| `sheet_architect` | Sonnet | Sheet schema and structure design |
| `sheets-dba` | Sonnet | Sheets data operations and schema analysis |
| `spock` | Sonnet | Code writing and implementation agent. Writes GAS, Python, and general code per task spec. Local files only. |
| `velma` | Sonnet | General-purpose analyst. Investigates questions, evaluates options, compares approaches. No MCP access. |

## 4) Hook Parity (Claude -> Codex)

Claude auto-hooks are in `.claude/hooks`. Codex should mirror intent manually:

- `scope-check.sh` parity:
  - If working inside a numbered project (`##_*`), do not edit another numbered project without user confirmation.

- `bash-guard.sh` parity:
  - Block destructive wildcard deletes and unapproved archive moves.
  - Confirm before risky destructive commands.

- `memory-guard.sh` parity:
  - Warn before editing MEMORY.md — verify content belongs there.

- `subagent-doctrine.sh` parity:
  - Spawn agents when tasks require 3+ tool calls.

## 5) File Movement Logging Rule

For file-structure changes (create/move/delete/archive), update `FILEMOVEMENT.log` in the affected project folder.

## 6) Operational Defaults

- Prefer direct execution over long planning unless user asks for plan-only.
- Keep responses concise and practical.
- Use dry-run before destructive cleanup unless user explicitly asks to apply now.
- Keep project scope tight; do not roam unrelated folders unless asked.
- Date authority for filenames is local shell date, not model-relative date. For any date-stamped artifact (`SESSION_MANIFEST_`, `TODO_`, `PLAN_`, `HANDOFF_`, `SKILLAUDIT_`, etc.), compute date via `date +%Y-%m-%d` and use that value.
- Mirror CLAUDE global laws in Codex behavior:
  - Stay In Your Lane.
  - Vibe Check (developer time over micro-optimizations).
  - Plan Before Touch for refactors or multi-file edits unless user explicitly requests immediate execution.

## 7) Sync Workflow (Claude <-> Codex)

Canonical source for skill and agent architecture is:
1. `.claude/skills`
2. `.claude/agents`
3. `CLAUDE.md`

Codex mirror policy:
- Treat `AGENTS.md` as the Codex routing mirror, not the architecture source.
- Any add/remove/rename under `.claude/skills` or `.claude/agents` requires same-session `AGENTS.md` update.
- Any global preference/law change in `CLAUDE.md` requires parity review in `AGENTS.md`.
