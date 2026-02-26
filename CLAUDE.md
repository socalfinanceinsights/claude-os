# CLAUDE.md

## Project Context Loading
- When working on a numbered project (01_–10_), Read that project's CLAUDE.md before starting work.
- Per-project CLAUDE.md files contain spreadsheet IDs, project-specific warnings, behavioral rules, and current status.
- These files do NOT auto-load at session start — they must be read explicitly when entering a project scope.

## Directory READMEs
Every directory in this repo has a README.md describing what it contains, how it connects to the rest of the system, and key operational notes.

- When landing in an unfamiliar directory, read its README.md first for orientation.
- READMEs exist at all levels: project roots, subdirs, .claude/skills/, .claude/agents/, .claude/hooks/, docs/, etc.
- READMEs are maintained — the /closeout skill will flag directories where READMEs may need updating after a session.
- Do NOT rely on directory names alone to infer purpose — read the README.

## Claude/Codex Parity Anchor
- Canonical skill architecture lives in `.claude/skills`.
- Canonical agent-profile architecture lives in `.claude/agents`.
- `AGENTS.md` is the Codex mirror/router and must be updated the same session when skill, agent, or global-law behavior changes.

## MCP — Configured Servers
All MCP servers are configured in your Claude Code CLI config file under `.projects["C:/YourWorkspace"].mcpServers`. Full MCP reference: see your project's `docs/reference/REF_MCP_Setup.md`.

**Google Sheets**
- Package: `mcp-google-sheets`
- Token path: `[YOUR_TOKEN_PATH]`

**Google Calendar**
- Package: `@cocal/google-calendar-mcp`
- OAuth credentials: `[YOUR_TOKEN_PATH]`

## Clasp — Google Apps Script
- GCP Project: `[YOUR_GCP_PROJECT]`
- Key commands: `clasp push --force`, `clasp run functionName`
- **Auth: do NOT use `clasp login` or `clasp login --creds creds.json`** — clasp v3's login flow may exclude required scopes. Use a custom auth script that explicitly requests all required scopes.

## About This Setup
Customize this section with your own context.

## Tech Stack
Customize this section with your own tech stack. Typical fields:
- ATS: [your ATS]
- AI: Claude Code (this)
- Docs: [your docs tools]
- Comms: [your comms tools]

## Global Laws
- **Stay In Your Lane:** Only act on files/folders explicitly named in the current task. Ask before touching files outside specified scope.
- **Vibe Check:** Developer time > computational efficiency. Spending 2 hours debugging to save $1/year is wrong. Prefer simple, stable, maintainable solutions.
- **Plan Before Touch:** For refactoring or multi-file changes, deliver the plan and get approval before making any file changes.

Pointer for verbose laws: `docs/reference/REF_Global_Laws.md` — contains Edit It = Own It, Log It While Fresh, Write for Claude (with full depth and reason).

## Naming Conventions
Pointer: `docs/reference/REF_Naming_Conventions.md` — authoritative source of truth for all document prefixes, lifecycles, and locations.

## Model Selection
- Main session: Opus 4.6 (`claude-opus-4-6`)
- Builder executor subagents: Sonnet 4.6 (`claude-sonnet-4-6`)
- Doc/scaffold subagents: Haiku 4.5 (`claude-haiku-4-5-20251001`)

## Subagent-First Doctrine
- You are not one Claude — you are a swarm. The main session is the queen bee. Agents are the colony.
- **The main session does exactly two things:** chat with the user and direct subagent teams. Nothing else.
- Default: spawn a subagent. Inline is the exception, not the rule.
- "It's small" and "I'm already here" are NOT valid justifications for inline work.
- If a task requires 3+ tool calls, it must be spawned — no exceptions.
- Inline is acceptable ONLY for: orientation reads (1-2 files to decide what to delegate), routing decisions, user conversation from existing knowledge.
- Every Task spawn must include: Objective, Output format, Tools/resources, Boundary.
- When multiple independent tasks exist, spawn agents in parallel in a single message.
- Agents are free. Context is not. The math always favors spawning.
- We hate compaction. Every session that compacts before closeout is a failure.

Full reference: `docs/reference/REF_Subagent_Manifesto.md`
