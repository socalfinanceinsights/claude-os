# Claude Code System

A production Claude Code setup built around a skills + agents + hooks architecture.

## What's Here

### Skills (`/.claude/skills/`)
Reusable workflow skills that Claude invokes by name. Each skill is a SKILL.md file with explicit trigger conditions, step-by-step execution logic, and done-when criteria.

Includes: contrarian spec review, requirements interviewer, handoff doc generator, hook lifecycle manager, skill creator/auditor/manager, builder orchestrator, cowboy investigator, bug flyswatter, session closeout, refactorer, ClaudePA (personal AI operating system), arco (Google Sheets & Apps Script domain authority), and todomanager (inbox orchestrator / 5-stage ticket pipeline).

### Agent Profiles (`/.claude/agents/`)
Named agent personas with specific tool access, model selection, and behavioral constraints. Referenced by name in skills for explicit delegation.

Includes: scout, spock, chef, reagan, framer, dragnet, oracle, debugger, velma, shakespeare, sheets-dba, gasexpert, formula1, sheet_architect.

### Hooks (`/.claude/hooks/`)
Shell scripts that run at Claude Code lifecycle events (PreToolUse, PostToolUse, UserPromptSubmit) to enforce behavioral rules at runtime.

Includes: bash safety guard, scope enforcement, subagent-first doctrine reminder, builder plan gate, memory guard, prompt confidence gate.

## Architecture Principles

- **Subagent-first:** Main session orchestrates, agents execute. Spawn for any task needing 3+ tool calls.
- **Skills as enforcement:** CLAUDE.md is orientation. Skills are the real behavioral layer.
- **Hooks as guardrails:** Runtime enforcement at the shell level, before Claude processes tool calls.
- **Hub/spoke docs:** Each skill under 500 lines, depth in `resources/` subdirectories.

## Docs

Reference documents live in `/docs/`.

- **REF_Subagent_Manifesto.md** — Architecture and philosophy for subagent-first orchestration. Covers model selection (Haiku/Sonnet/Opus), spawn mechanics, four-part task description format, agent roster, inline rationalization anti-patterns, and escalation protocol.

## Setup

1. Copy `.claude/` into your project root
2. Customize `CLAUDE.md` with your project context
3. Register hooks in your Claude Code settings
4. Invoke skills by name: `/contrarian`, `/interview`, `/handoff`, etc.

## Customization Required

Before use, update:
- `CLAUDE.md` — your project context, tech stack, about section
- `claudepa/SKILL.md` — your calendar IDs, email, work categories
- Any skills that reference project-specific sheet names or paths
