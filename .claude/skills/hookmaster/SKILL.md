---
name: hookmaster
description: "Hook lifecycle management — writing, registering, testing, and maintaining Claude Code hooks. Activates on '/hookmaster', 'new hook', 'update a hook', 'hook audit', 'check the hooks'."
user-invocable: true
---

# SKILL: HOOKMASTER

## TRIGGER

Activate when:
- User runs `/hookmaster`
- User says "new hook", "write a hook", "add a hook for X"
- User says "update a hook", "modify the hook", "change the guard"
- User says "hook audit", "check the hooks", "are my hooks healthy"
- User says "what hooks do we have", "hook inventory"

**Mid-session hook edits require hookmaster:** If a hook file (`.claude/hooks/*.sh`) is being edited mid-session outside of a hookmaster invocation, stop and flag to the user that hookmaster verification is required — even if the edit appears minor. Minor hook changes can silently break event routing.

---

## STEP 0: ORIENT

Before any hook work, load current state:

1. **Read `.claude/settings.json`** — the registration source of truth. Every active hook is registered here.
2. **Read `.claude/hooks/HOOKS_LOG.md`** — the changelog. What exists, when it was added/modified, why.
3. **Scan `.claude/hooks/*.sh`** — the actual scripts on disk.

**Integrity check:** Every `.sh` file in the hooks directory should have a corresponding entry in `settings.json` AND `HOOKS_LOG.md`. Flag any orphans (script exists but not registered) or ghosts (registered but script missing).

**Pre-edit git status check (Write mode only):** Before making any edits, run `git status --short` to see the current repo state. Plan to stage only files within the current task scope.

Then determine mode:
- **Write mode:** User wants a new hook or modification to an existing one. Go to Step 1.
- **Audit mode:** User wants a health check or inventory. Go to Step 4.

---

## STEP 1: DESIGN THE HOOK

Before writing any code, answer these questions:

1. **Event type:** PreToolUse, PostToolUse, PostToolUseFailure, SessionStart, SubagentStart, UserPromptSubmit, Stop, or SubagentStop?
2. **Matcher:** Which tool(s) does this hook fire on? Use exact tool names separated by `|`.
3. **Behavior:** Advisory (additionalContext only), blocking (exit 2), or confirmation-required (permissionDecision: "ask")?
4. **What problem does this solve?** One sentence. This goes in the script header comment AND the HOOKS_LOG entry.
5. **Does an existing hook already cover this?** Check `settings.json` matchers. If the same tool already has a hook, either extend that hook or explain why a separate one is needed.

For `UserPromptSubmit` / `Stop` / `SubagentStop`, run a capability probe first (minimal no-op hook + live-fire) before full implementation.

**UserPromptSubmit hooks only — Q6:**
Are any trigger phrases or matchers ambiguous in other contexts? Map each phrase against the user's known multi-inbox environment. If a phrase could fire in a non-intent context:
- Either narrow it with word-boundary anchors (`\bphrase\b`) and test against known false-positive triggers
- Or drop it and require more specific phrasing

Present the design to the user before writing code.

---

## STEP 2: WRITE THE HOOK

Every hook script follows this structure. Deviations from this template must be justified.

See [resources/hook-patterns.md](resources/hook-patterns.md) for the full template with all variants (advisory, blocking, confirmation-required, logging).

**When writing spawn prompts for hook implementation, include this instruction verbatim:**
> "Read `.claude/skills/hookmaster/resources/hook-patterns.md` before writing any hook code. The canonical templates are there — the blocking pattern in particular uses `exec 3>&2 2>/dev/null` + `>&3` writes, which differs from naive implementations. Failure to read this file will result in broken blocking hooks."

**Non-negotiable conventions:**

1. **Header comment block** — script name, purpose, event type, matcher description, blocking behavior.
2. **Error suppression** — `exec 2>/dev/null` + `trap 'exit 0' ERR` on all PreToolUse/PostToolUse hooks. A broken hook must never block work.
3. **jq binary path** — always use the local jq binary path, never system jq.
4. **Input parsing** — `input=$(cat 2>/dev/null)` with empty guard. jq first, sed fallback for resilience.
5. **Path normalization** — `tr '\\' '/'` on every path extracted from input. Windows sends backslashes.
6. **Forward slashes everywhere** — all hardcoded paths use `/`, never `\`.
7. **Exit codes** — `exit 0` = allow, `exit 2` = block. No other exit codes.
8. **JSON output (advisory and confirmation hooks only)** — `hookSpecificOutput` object via jq `-n` construction. Never hand-build JSON strings. Blocking hooks (exit 2) use a completely different pattern: `exec 3>&2 2>/dev/null` at script top, then `echo "BLOCKED: ..." >&3` before `exit 2`.
9. **Logging** — if the hook logs to a file, use `flock -w 2` for concurrency safety.
10. **Timeout** — all hooks registered with `"timeout": 10` (seconds). Hooks must be fast.

---

## STEP 3: REGISTER THE HOOK

After writing the script:

1. **Read settings.json before editing** — read the current state and flag any pre-existing local drift before inserting the new hook.
2. **Add to `settings.json`** — find the correct event type array, add the matcher + command entry.
3. **Use absolute forward-slash paths** — e.g., `C:/YourWorkspace/.claude/hooks/my-hook.sh`.
4. **Matcher syntax** — default to exact tool names joined with `|`. Regex matchers are allowed only when needed for a tool family, and must be anchored + documented in HOOKS_LOG.
5. **Verify no matcher overlap** — if another hook already fires on the same tool, the new hook runs AFTER the existing one (hooks are sequential per matcher). Document the ordering intent.

---

## STEP 4: VERIFY THE HOOK (3-Layer Protocol)

Every new or modified hook must pass all three layers before it's considered live.

### Layer 1: Script Validation
```bash
bash -n .claude/hooks/my-hook.sh
```
Confirms syntax is valid. Does not execute.

### Layer 2: Registration Check
Read `settings.json` and confirm:
- Hook command path matches actual file location
- Matcher covers the intended tool(s)
- Event type is correct (PreToolUse vs PostToolUse etc.)
- Timeout is set to 10
- For new lifecycle event types, settings schema still parses cleanly before live-fire.

### Layer 3: Live-Fire Test
Trigger the actual tool the hook is supposed to intercept. Observe:
- **Advisory hooks:** Does `additionalContext` appear in the model's context?
- **Blocking hooks:** Does the tool call get denied with the expected stderr message?
- **Confirmation hooks:** Does the user get prompted with `permissionDecision: "ask"`?

**UserPromptSubmit hooks — standard test matrix:** For any hook on the `UserPromptSubmit` event, live-fire must cover:

Trigger cases (MUST fire):
- At least 3 distinct phrases that are canonical trigger inputs for this hook

Non-trigger cases (must NOT fire):
- Trailing punctuation variants: the trigger phrase with a period, exclamation mark, and question mark
- Slash-command inputs that contain the trigger word embedded in a longer command
- Short or partial trigger phrases that are incomplete

Document pass/fail for each case in the HOOKS_LOG entry.

---

## STEP 5: LOG THE CHANGE

After verification passes, update `.claude/hooks/HOOKS_LOG.md`:

**For new hooks:**
Add a new entry to the registry section with: name, event type, matcher, behavior, purpose, date added.

**For modifications:**
Add a changelog entry under the hook's section with: date, what changed, why.

**Write immediately.** Do not defer to session end. Context compaction is real.

**Minimal-diff discipline:** Append only the relevant new entry. Do not normalize, reformat, or rewrite unrelated sections of HOOKS_LOG.md in the same edit.

---

## STEP 6: AUDIT MODE

When user asks for a health check:

1. **Inventory:** List all `.sh` files in hooks directory vs. all entries in `settings.json`. Flag orphans and ghosts.
2. **Coverage map:** Show which tools have hooks and which don't. Group by event type.
3. **HOOKS_LOG freshness:** Is every script accounted for in the log? Any scripts modified since their last log entry?
4. **Known issues:** Check for patterns from hook history:
   - Are all paths forward-slashed?
   - Is `exec 2>/dev/null` present on all PreToolUse/PostToolUse hooks?
   - Is jq path correct (local binary, not system)?
   - Any hook missing the `trap 'exit 0' ERR` safety net?
   - Any experimental lifecycle hook without a rollback plan in HOOKS_LOG?

Present findings as a table, flag issues by severity (BLOCKER / WARNING / INFO).

---

## DECISION FRAMEWORK: When to Use Hooks vs. Skills vs. Rules

| Mechanism | When to Use | Examples |
|-----------|-------------|---------|
| **Hook** | Deterministic guard that must fire every time, regardless of which skill is active. No LLM reasoning needed. | Block destructive commands, log file touches, inject scope context |
| **Skill** | Deep guidance requiring LLM reasoning, context awareness, multi-step workflows. | GAS expert patterns, sheet architecture decisions, email drafting |
| **Rule** (`.claude/rules/`) | Lightweight always-on guardrails. Glob-matched to file types. | "Every .gs file needs @execution header", "Strip JSON fences in Python" |

**Hook vs. Skill overlap:** If a guard exists as both a hook AND a skill rule, that's intentional — hooks are the deterministic backstop, skills provide the deep guidance. Don't remove one because the other exists.

---

## RULES

1. **Template compliance.** Every hook follows the conventions in Step 2. No exceptions without justification.
2. **Fail-open.** A broken hook must never block work. `exec 2>/dev/null` + `trap 'exit 0' ERR` on all PreToolUse/PostToolUse hooks.
3. **3-layer verification required.** No hook is live until it passes script validation, registration check, and live-fire test.
4. **Log everything.** HOOKS_LOG.md is the institutional memory. Every addition, modification, and deletion gets an entry with date and rationale. Write it immediately after verification.
5. **Source priority.** When investigating hook issues, trust this priority order: (1) runtime files (settings.json, hook scripts), (2) HOOKS_LOG.md, (3) session manifests/handoffs.
6. **Windows-first.** All paths forward-slashed. All scripts bash-compatible via Git Bash. jq binary is local, not system. Path normalization on every extracted value.
7. **One hook, one job.** Don't overload a hook with unrelated checks.
8. **Commit scope discipline.** When the repo is dirty, hook changes must ship in focused, scoped commits. Do not bundle unrelated churn into hook commits.

NOTE: Hook file edited — hookmaster 3-layer verification required before this change is considered live.
