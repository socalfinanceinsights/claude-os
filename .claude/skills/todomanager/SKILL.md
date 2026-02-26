---
name: todomanager
description: "Orchestrating skill that sweeps TODO/inbox/, enriches tickets through a 5-stage pipeline (classify → question-gen → research → contrarian eval → route), and delivers them to User_Review/ or claude_autonomy_plans/. Never executes work — humans fire plans when ready."
user-invocable: true
---

# SKILL: TODOMANAGER (Inbox Orchestrator)

## TRIGGER

- Manual invocation only: `/todomanager`
- No auto-run, no session-start hook
- Manual invocation is the only concurrency guard — do not run multiple instances simultaneously

**Do NOT activate when:**
- User wants to execute a specific ticket → route to the classified skill
- A single ticket needs ad-hoc scoping → route to `/interview`
- User wants a quick one-off task handled → route to `/cowboy`

---

## QUICK REFERENCE

| Resource | Path |
|----------|------|
| Question generation framework | [resources/question-gen-framework.md](resources/question-gen-framework.md) |
| Readiness evaluation framework | [resources/readiness-eval-framework.md](resources/readiness-eval-framework.md) |

---

## PIPELINE OVERVIEW

Serial per ticket. One ticket completes all 5 stages before the next begins.

**Run manifest:** At invocation, Glob `TODO/inbox/TODO_*.md` to build the run manifest. Files in inbox that do not match `TODO_*.md` are skipped silently — log count in briefing (e.g., "2 non-TODO files skipped"). Only manifest tickets are processed. Files added mid-run are invisible until next invocation.

**Empty inbox:** If the manifest contains zero files after filtering, write briefing: "0 of 0 processed — inbox is empty" and exit. No pipeline stages run.

**Output tree:**
```
TODO/
├── inbox/                          ← source
├── todomanager_workdir/
│   ├── [ticket_name]/
│   │   ├── classification.md
│   │   ├── question_gen.md
│   │   ├── research_attempt_1.md
│   │   ├── research_attempt_2.md   ← only if retry
│   │   ├── research_attempt_3.md   ← only if retry
│   │   └── contrarian_eval.md
│   └── run_logs/
│       └── briefing_YYYY-MM-DD.md
├── User_Review/
│   └── agent_research/[ticket_name]/
└── claude_autonomy_plans/
    └── agent_research/[ticket_name]/
```

---

## STAGE 1: CLASSIFICATION

**Executor:** Orchestrator (main session) — no agent spawn.

**Protocol:**
1. Glob `.claude/skills/*/SKILL.md` and `.claude/agents/*.md`
2. Read YAML frontmatter from each file — extract `name` and `description`
3. Filter to user-invocable skills only: require `user-invocable: true` explicitly present. Standards libraries (`gas_expert`, `guardian`, `sheet_architect`, `python_workspace`) are excluded. Agent profiles are included as implementation context but are NOT route targets.
4. Build name+description menu in-context
5. Pick best-match skill; read that full SKILL.md for context
6. Write classification and routing rationale to `TODO/todomanager_workdir/[ticket_name]/classification.md`

**Known limitation:** Multi-domain tickets get single-best-match classification. Secondary domains are noted in `classification.md`. User sequences execution from User_Review when multiple skills are needed.

**Completion marker:** `<!-- STAGE: classification COMPLETE -->`

---

## STAGE 2: QUESTION GENERATION

**Executor:** Velma analyst (general-purpose spawn with velma body injected).

**Protocol:**
1. Read `.claude/agents/velma.md` — extract YAML and body
2. Read `.claude/skills/todomanager/resources/question-gen-framework.md` — paste content into spawn prompt
3. Spawn:

```
Task(
  subagent_type: "general-purpose",
  model: [from velma YAML],
  prompt: """
    [velma body — pasted verbatim from velma.md]

    **Objective:** Generate 5-10 targeted questions for this ticket using the Vision → Architecture → Data Flow → Details framework (framework pasted below).
    **Output:** Write questions to `TODO/todomanager_workdir/[ticket_name]/question_gen.md`. End file with `<!-- STAGE: question_gen COMPLETE -->`.
    **Tools:** Read ticket content only. No web search. No codebase reads beyond what's in the ticket.
    **Boundary:** Question generation only. No research. No answers. Strict separation from Stage 3.

    [question-gen-framework content — pasted verbatim]

    [ticket content — pasted verbatim]
  """
)
```

**Velma's job:** Generate 5-10 targeted questions using the Vision → Architecture → Data Flow → Details framework. Questions must be specific to the ticket content — not generic. This velma does NOT research. Strict separation.

**Output:** `TODO/todomanager_workdir/[ticket_name]/question_gen.md`

**Completion marker:** `<!-- STAGE: question_gen COMPLETE -->`

---

## STAGE 3: RESEARCH

**Executor:** Velma analyst (general-purpose spawn with velma body injected).

**Protocol:**
1. Read `.claude/agents/velma.md` — extract YAML and body
2. Inject: ticket content + question_gen.md content + specialist SKILL.md from Stage 1
3. Spawn:

```
Task(
  subagent_type: "general-purpose",
  model: [from velma YAML],
  prompt: """
    [velma body — pasted verbatim from velma.md]

    **Objective:** Research this ticket — answer the questions generated in Stage 2 using codebase reads, web search, and web fetch as appropriate.
    **Output:** Write findings to `TODO/todomanager_workdir/[ticket_name]/research_attempt_N.md`. End file with `<!-- STAGE: research COMPLETE -->`.
    **Tools:** Read, Grep, Glob (codebase), WebSearch, WebFetch. If ticket references specific files or projects, read those. If ticket is abstract, stay general.
    **Boundary:** Research and findings only. No evaluation. No recommendations. No ticket writing.

    [ticket content — pasted verbatim]
    [question_gen.md content — pasted verbatim]
    [specialist SKILL.md content from Stage 1 — pasted verbatim]
  """
)
```

**Velma's scope:** Read, Grep, Glob codebase + WebSearch + WebFetch. If ticket references specific files or projects, read those. If ticket is abstract, stay general. Return findings to `TODO/todomanager_workdir/[ticket_name]/research_attempt_1.md`.

**Retry logic:** If research comes back thin, orchestrator diagnoses why (insufficient search terms, wrong scope, wrong angle), adjusts prompt, re-spawns. Up to 3 total attempts. Each attempt writes its own file: `research_attempt_2.md`, `research_attempt_3.md`.

**3-strike failure path:** If all 3 attempts are inconclusive, skip Stage 4. Move ticket directly to `User_Review/` with:
```
NEEDS: information
BLOCKER: Research inconclusive after 3 attempts — [specific gaps listed]
```

**Output:** `TODO/todomanager_workdir/[ticket_name]/research_attempt_N.md`

**Completion marker:** `<!-- STAGE: research COMPLETE -->`

---

## STAGE 4: CONTRARIAN EVALUATION

**Executor:** Velma analyst (general-purpose spawn with velma body injected).

**Protocol:**
1. Read `.claude/agents/velma.md` — extract YAML and body
2. Read `.claude/skills/todomanager/resources/readiness-eval-framework.md` — paste content into spawn prompt
3. Inject all prior workdir files for this ticket: `classification.md`, `question_gen.md`, best `research_attempt_N.md`
4. Spawn:

```
Task(
  subagent_type: "general-purpose",
  model: [from velma YAML],
  prompt: """
    [velma body — pasted verbatim from velma.md]

    **Objective:** Evaluate this ticket's readiness for autonomous implementation. Lens: blast radius and risk of executing without further user input.
    **Output:** Write structured verdict (READY / NEARLY_READY / NOT_READY) with blockers to `TODO/todomanager_workdir/[ticket_name]/contrarian_eval.md`. End file with `<!-- STAGE: contrarian_eval COMPLETE -->`.
    **Tools:** Read workdir files only. No web search. No additional codebase reads.
    **Boundary:** Evaluation only. No implementation. No ticket writing. No new research.

    [readiness-eval-framework content — pasted verbatim]
    [classification.md content — pasted verbatim]
    [question_gen.md content — pasted verbatim]
    [best research_attempt_N.md content — pasted verbatim]
  """
)
```

**Evaluation lens:** "Blast radius and risk of autonomous implementation without further user input."

**Velma returns structured verdict:**
- `READY` — ticket can be executed autonomously with confidence
- `NEARLY_READY` — minor gaps that can be noted as assumptions; blockers listed
- `NOT_READY` — requires user input before execution; blockers listed

**Output:** `TODO/todomanager_workdir/[ticket_name]/contrarian_eval.md`

**Completion marker:** `<!-- STAGE: contrarian_eval COMPLETE -->`

---

## STAGE 5: ROUTING DECISION + TICKET UPDATE

**Executor:** Orchestrator (main session).

**Protocol:**
1. Read all workdir stage files for this ticket
2. Distill enrichment into the ticket append format
3. Prepend enrichment block to the TOP of the ticket (above original content)
4. Move ticket and workdir to destination

**If READY:**
- Prepend autonomy-plan format (no NEEDS/BLOCKER header)
- Move ticket to `TODO/claude_autonomy_plans/`
- Move workdir to `TODO/claude_autonomy_plans/agent_research/[ticket_name]/`

**If NEARLY_READY or NOT_READY:**
- Prepend User_Review format with NEEDS/BLOCKER header
- Move ticket to `TODO/User_Review/`
- Move workdir to `TODO/User_Review/agent_research/[ticket_name]/`

**If research failed (3 strikes):**
- Move to `User_Review/` with research-failure blocker
- No Stage 4 append (was skipped)

**Move pattern (Windows-safe):**
All file moves use Python shutil to avoid MSYS2/Git Bash EINVAL on Windows:

```python
# Pre-create destination directories
python -c "import os; os.makedirs('TODO/User_Review/agent_research', exist_ok=True)"
# or for autonomy plans:
python -c "import os; os.makedirs('TODO/claude_autonomy_plans/agent_research', exist_ok=True)"

# Move ticket file
python -c "import shutil; shutil.move('TODO/inbox/[ticket_filename]', 'TODO/[destination]/[ticket_filename]')"

# Move workdir
python -c "import shutil; shutil.move('TODO/todomanager_workdir/[ticket_name]', 'TODO/[destination]/agent_research/[ticket_name]')"
```

Pre-create destination directories before any move attempt.

---

## TICKET APPEND FORMAT

### User_Review tickets

```
Route-Override:
NEEDS: [decision | information | approval]
BLOCKER: [structured one-liner]

TODO Manager analysis: [freeform context for user]

---
### Classification — YYYY-MM-DD
Route: [skill name]
Rationale: [why this specialist was chosen]
<!-- STAGE: classification COMPLETE -->

### Interview Questions — YYYY-MM-DD
1. [question] — Answered: [finding] / OPEN: needs user
2. ...
<!-- STAGE: question_gen COMPLETE -->

### Research Findings — YYYY-MM-DD
- [file:line — what it shows]
- [web source — what it says]
### Still needs you
- [items velma couldn't resolve]
<!-- STAGE: research COMPLETE -->

### Readiness Evaluation — YYYY-MM-DD
Verdict: [READY / NEARLY_READY / NOT_READY]
Blockers:
- [specific blocker]
### Analysis
[freeform contrarian analysis]
<!-- STAGE: contrarian_eval COMPLETE -->

---
[ORIGINAL TICKET CONTENT BELOW]
```

### Autonomy plan tickets

Same format minus the `Route-Override:` / `NEEDS:` / `BLOCKER:` / `TODO Manager analysis:` header block.

### Route-Override field

Always include. Blank by default. If classification is wrong, user sets this field before firing the ticket. This is the correction path for misclassified tickets. The executing skill reads it and overrides route if set.

---

## RESUME DETECTION

When invoked after an interruption:

**Step 0 — Reconciliation pass:**
- Scan `User_Review/` and `claude_autonomy_plans/` for tickets without a corresponding `agent_research/` subfolder
- Scan `todomanager_workdir/` for directories whose ticket is no longer in inbox
- Log all orphans in the run briefing. Do not auto-fix orphans.

**Steps 1-6:**
1. Scan `TODO/inbox/` for all ticket files
2. For each ticket, check for corresponding `todomanager_workdir/[ticket_name]/` directory
3. If workdir exists, check each stage file for its completion marker
4. Resume point = last completed stage + 1
5. If stage file exists but completion marker is absent → re-run that stage from the beginning (overwrite partial)
6. If no workdir exists → start from Stage 1

Completed stages are never re-run. Partial stages always restart from the beginning.

---

## BRIEFING OUTPUT

**File:** `TODO/todomanager_workdir/run_logs/briefing_YYYY-MM-DD.md`

**Contents:**
- Total tickets in manifest
- Tickets processed count
- List promoted to `claude_autonomy_plans/` with one-liner per ticket
- List moved to `User_Review/` with NEEDS/BLOCKER per ticket
- Errors and failures
- Orphans from reconciliation pass

**Chat output:** ONE line only. Example:

```
15 of 15 processed — see TODO/todomanager_workdir/run_logs/briefing_2026-02-24.md for details.
```

No inline summaries. No per-ticket chat output during the run. Briefing file is the record.

---

## AGENT ARCHITECTURE

**Sole agent type:** velma (Sonnet analyst).

**Separation of duties:** Enforced by spawn structure. Each stage velma receives different injected context — question-gen velma gets no research tools in scope, research velma gets no evaluation framework, contrarian velma gets no ticket-writing authority.

**Velma write access:** Velma's agent profile declares Read/Grep/Glob only. File-writing stages use `subagent_type: 'general-purpose'` with velma's profile body injected into the spawn prompt. This gives Write tool access while delivering velma's analytical methodology. Spawn prompts cannot add tools to a named agent type that doesn't declare them — general-purpose workaround is correct and stable.

**Methodology delivery:** Orchestrator reads resource files at spawn time and pastes content into spawn prompts. Agents cannot invoke slash commands. All framework content must travel in the spawn prompt.

**Agent output destination:** Agents write to workdir files. Task return message = completion signal only. Never parse agent output from the return message.

---

## ERROR HANDLING

| Failure Mode | Response |
|---|---|
| Research thin (1 attempt) | Diagnose gap, adjust prompt, re-spawn |
| Research fails 3 attempts | Skip Stage 4 → User_Review with NEEDS: information + specific gap list |
| Unclassifiable ticket | User_Review with NEEDS: decision / BLOCKER: Could not classify |
| Velma spawn fails | Log failure in briefing, skip ticket, continue run |
| Compaction recovery | Completion markers + workdir files = full state. Resume Detection reconstructs on next invocation. |
| Orphan detected | Log in briefing. Do not auto-fix. User resolves manually. |
| Move failure (shutil.move raises exception) | Log ticket as MOVE_FAILED in briefing with error message. Skip workdir move. Continue to next ticket. |

---

## AUTO-SKILLAUDIT

Deferred until after 3 real production runs. When enabled: spawn velma with skillaudit methodology, write `SKILLAUDIT_todomanager_[date].md` to `.claude/skills/audits/open/`.

---

## RULES

1. **Never execute work.** Todomanager does triage, enrichment, and staging only. Touching the actual work described in a ticket is out of scope regardless of how obvious the fix looks.
2. **Serial processing — one ticket at a time.** All 5 stages complete before the next ticket begins. No ticket is left at a partial stage while another starts.
3. **Run manifest is law.** Build the manifest at invocation. Process only manifest tickets. Files added mid-run do not exist until next invocation.
4. **Agents write to workdir files, not task return messages.** Task return = completion signal. Never extract content from return messages. If a stage's workdir file doesn't exist, the stage is not complete.
5. **Use general-purpose subagent type with velma body injection for all agent spawns.** Named agent types cannot receive tool grants via spawn prompt. General-purpose + velma body injection is the correct and only pattern.
6. **Stage completion markers are mandatory.** Write `<!-- STAGE: [stage] COMPLETE -->` immediately upon stage completion. This is the only reliable state signal for Resume Detection. No marker = stage did not complete.
7. **Research retry: diagnose before re-spawning.** Identify the specific failure mode (insufficient search terms, wrong scope, wrong angle) and adjust the spawn prompt to address it. Blind retry wastes an attempt. Max 3 total research attempts per ticket.
8. **Route-Override field always included, always blank by default.** User sets it if classification is wrong. Never pre-fill it. Never omit it.
9. **One-line chat output only.** All detail lives in the briefing file. Per-ticket progress is not surfaced to chat during a run. Briefing file is the record.
10. **No hardcoded skill knowledge.** Build the classification menu fresh every run via Glob + YAML reads. Never rely on a memorized list of skill names or descriptions. The skill roster changes.

---

## INTEGRATION

| Skill | Relationship |
|---|---|
| `/closeout` | Todomanager processes inbox; closeout verifies docs are filed correctly and STATE.md is current |
| `/cowboy` | Cowboy handles ad-hoc single-issue routing and investigation. Todomanager handles systematic inbox sweeps. Use cowboy for one-off; todomanager for batch |
| `/contrarian` | Stage 4 uses a derived contrarian methodology (from `readiness-eval-framework.md`). The full `/contrarian` skill is not invoked — distinct scope and spawn structure |
| `/handoff` | Handoff creates tickets and drops them in `TODO/inbox/`. Todomanager is downstream — it processes what handoff creates |
| velma (agent) | Sole execution agent across all three active stages (2, 3, 4). Runtime Read from `.claude/agents/velma.md` before every spawn |

---

## REMEMBER

> Todomanager is a sorter, not a doer. It reads the pile, understands each ticket deeply, and puts it in the right place with the right context. Work does not happen here.

> Every ticket gets the same 5-stage treatment. No shortcuts for "obviously simple" tickets. The pipeline is the point.

> The briefing file is the record. One line to the user, everything else in the file.
