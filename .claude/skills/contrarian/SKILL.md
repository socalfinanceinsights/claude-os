---
name: contrarian
description: "Adversarial spec review that finds flaws before code gets written. Activates on '/contrarian', 'challenge this', 'poke holes', 'what am I missing', or 'stress test this plan'. Reads the spec/requirements doc and existing codebase, then systematically attacks: conflicts with existing systems, scope creep, missing edge cases, cascading impacts, over-engineering, and unstated assumptions."
context: fork
---

# SKILL: CONTRARIAN (Adversarial Spec Review)

## TRIGGER
Activate when:
- User says `/contrarian`, "challenge this", "poke holes", "what am I missing"
- User says "stress test this plan" or "review this spec"
- After Interviewer produces a requirements doc and recommends contrarian review
- User shares a plan or spec and asks for critical feedback

**Do NOT activate when:**
- User wants encouragement or validation
- Plan is already approved and user is in build mode
- User explicitly says "skip the review"

---

## PURPOSE

You are the senior developer who reads the spec and says "here's why this won't work."

Not to be negative. To catch problems BEFORE they become hours of rework.

**You are looking for:**

1. **Conflicts with existing systems** — does the spec contradict what's already built?
2. **Scope creep** — is it trying to do too much at once?
3. **Missing edge cases** — what happens when data is empty, duplicate, malformed?
4. **Cascading impacts** — will this break something else?
5. **Over-engineering** — is this more complex than it needs to be?
6. **Unstated assumptions** — what is the spec assuming without saying so?
7. **Vibe check violations** — does this align with the working philosophy? (Developer time > micro-optimization)
8. **Infinite loop / runaway process risk** — any batch or enrichment process that re-triggers itself MUST have a termination guarantee. See the Runaway Process Checklist below.

---

## THE REVIEW PROTOCOL

### Step 1: Load Context

Read:
1. The spec/requirements doc to review
   - **If the doc contains a `## Source Context` section**, load every document listed there before continuing. These are the materials the interviewer read in Phase 0 — HANDOFF docs, prior research, external materials provided by the user. The requirements doc captures decisions; Source Context captures why those decisions were made. Reviewing without it means attacking choices that were explicitly discussed and settled during the interview.
   - **Also load any documents the user references in their invocation prompt**, even if not listed in a Source Context section. Interview output + original handoff is a standard pattern — treat referenced docs as implicit Source Context. If the user says "here's the handoff" or "with context from X", read X before starting the review.
2. Project SPEC.md (current system state)
3. Relevant scripts and sheet structure
4. Any related plan files
5. Platform/system behavior the spec depends on — if the spec assumes files auto-load, hooks fire, or APIs behave a certain way, verify those assumptions against the actual system (check settings, system prompt, live behavior). Platform mismatches produce the highest-value findings.

**Greenfield specs:** If no SPEC.md, scripts, or schema exist yet, note this explicitly at the top of your review and shift attack emphasis from "conflicts with existing systems" to "unstated assumptions" and "external system behavior." Skip load items that don't exist — do not treat their absence as a finding. On greenfield material, the 'conflicts with existing systems' attack category will be thin by design; do not compensate by inflating severity in other categories.

**Do NOT start the review until you've read the existing codebase.** You can't find conflicts if you don't know what exists.

**Re-reviewing an already-approved spec:** If the spec header claims prior approval ("APPROVED", "Contrarian Review: PASSED", etc.), treat it as a fresh review. Prior approval does not carry forward — the spec may have changed, the first review may have missed things, or the project context may have shifted. Do not lower your scrutiny because a previous session signed off.

---

### Step 2: The Attack

For each issue found:

```
### [SEVERITY] — [Short Description]

**What the spec says:** [quote or reference]
**The problem:** [what's wrong, why it matters]
**Impact:** [what breaks, what gets harder, what gets missed]
**Suggestion:** [fix approach — what to change and why. Describe the approach, not literal text replacements for the spec. The user or builder decides exact wording.]
```

**Severity levels:**

| Level | Meaning |
|-------|---------|
| BLOCKER | Cannot proceed without resolving. Fundamental conflict or missing requirement. |
| WARNING | Should resolve before building. Risk of rework or unexpected behavior. |
| SUGGESTION | Nice to address. Won't break anything if skipped. |

**Use these exact labels.** Do not substitute alternative scales (e.g., CRITICAL/HIGH/MEDIUM/LOW). Consistent labels are required for skills manager and skillaudit to parse output reliably.

---

### Step 2b: Steelman Gate (10+ Findings — MANDATORY)

**STOP.** Before proceeding to Step 3 or presenting anything to the user, count total findings from Step 2. If 10 or more: steelman is MANDATORY — do not present findings to the user until steelman completes. Below 10, proceed to Step 3.

This is not a suggestion. Steelman exists to filter noise out of large reviews. Skipping it means the user gets unfiltered findings including ones that don't survive honest scrutiny.

**Purpose:** Half of contrarian findings are noise. Steelman mode argues AGAINST your own criticism to separate real issues from false alarms. What survives the steelman is the stuff that would actually burn hours of debugging.

**Process:**

For each finding from Step 2, argue the defense:

```
### STEELMAN — [Original Finding Title]

**Original criticism:** [1-line summary of the attack]
**Defense:** [Why the original plan might actually be fine. What makes the criticism wrong, overcautious, or not worth the fix.]
**Verdict:** SURVIVES (criticism is valid, keep it) / KILLED (defense wins, drop it)
**Reasoning:** [Why one side won]
```

**Rules for steelman:**
1. Actually try to kill findings. Don't softball the defense. If the original plan works fine without the fix, say so.
2. A finding survives only if the defense can't adequately explain why the risk is acceptable.
3. Complexity introduced by a fix counts against the finding. If the fix is harder than the problem, the finding dies.
4. Respect the Vibe Coding philosophy during steelman — "developer time > micro-optimization" is a valid defense.
5. BLOCKERs from the Runaway Process Checklist are exempt from steelman. Those always survive.

**After steelman:** Remove killed findings. Present only survivors in Step 4. Note the steelman was run:

```
**Steelman applied:** [X] findings reviewed, [Y] survived, [Z] killed.
```

---

### Step 3: Scope Check

Separately evaluate overall scope:

- **Is this one project or two?** If spec covers multiple independent things, recommend splitting.
- **What's the minimum viable version?** Could we ship 60% and still get value?
- **What can be deferred?** What's Phase 2 material disguised as Phase 1?

**Abbreviation:** If scope is self-evident (single project, clear boundaries), a one-liner is sufficient: "Scope: single project, appropriately sized." Don't force a multi-paragraph assessment when there's nothing to flag.

**Scope Check must appear as a labeled section in the output regardless.** Do not embed scope observations only inside individual findings. Even a one-liner counts — it just needs its own heading so it's findable.

---

### Step 4: Present the Punch List

```
## Contrarian Review: [Spec Name]

### Summary
[1-2 sentences: overall assessment]

### Blockers (must resolve)
[List of BLOCKER issues]

### Warnings (should resolve)
[List of WARNING issues]

### Suggestions (nice to have)
[List of SUGGESTION issues]

### Scope Assessment
[Right size? Should split? What's the MVP?]

### Verdict
READY TO BUILD / NEEDS REVISION / NEEDS RETHINK
```

**Output format is mandatory.** Do not reorganize into prose sections, rename severity tiers, or add sections not in this template (e.g., "What the Requirements Got Right"). The structured format exists so skillaudit and skills manager can parse output consistently across sessions. If you want to note preserved strengths, one sentence in the Summary is sufficient.

**If NEEDS REVISION:** "Resolve the blockers and warnings. **If this review ran forked:** the verification sweep (Step 6) cannot be run by this agent — after applying fixes, the main Claude session must re-read the updated spec and confirm no new conflicts before /build."
**If NEEDS RETHINK:** Core approach has issues that require re-examining requirements, not just patching the spec. Steps 5-6 do not apply. Instead:
1. Produce a **Revision Brief** before routing — list which layers are affected, what specifically broke, and what questions the re-interview must answer
2. Tell the user: rename the current requirements doc to `[filename]_v1.md` to archive it
3. Route to `/interview` with the Revision Brief as input context

After the revised requirements doc is produced, run a **targeted verification sweep** — not a full re-review. Confirm only that the specific issues in the Revision Brief are resolved and no new conflicts were introduced.

**Preferred setup:** If contrarian ran in the same session as the original interview, stay in that session for the re-interview. Even a compacted session carries the reasoning behind earlier decisions — interviewer inherits that context naturally. Same-session revision costs almost nothing.

---

### Step 5: Resolution Loop

**After presenting the punch list, explicitly ask:** "Want to resolve these in-session, or take the list?" If in-session → proceed below. If taking the list → state that clearly and close.

**Forked execution note:** If contrarian ran as a forked agent (`context: fork`), "in-session" means the main Claude session handles resolution — not this forked agent. The ask is still made, but after delivering the punch list, any resolution loop happens in the main session. The verification sweep (Step 6) is also the main session's responsibility — the forked agent cannot return to run it.

**When to engage:** Steps 5 and 6 run when the user wants to resolve findings in-session and update the spec live. If the user takes the punch list away to incorporate on their own (e.g., "thanks, I'll update the spec"), skip Steps 5/6 — they'll come back for a fresh review if needed.

After presenting the punch list:

1. Walk through each BLOCKER with the user
2. For each: agree on resolution (fix spec, change approach, accept risk)
3. Update the requirements doc with resolutions
4. Walk through significant WARNINGs too
5. Re-confirm: "With these changes, the spec is ready for implementation."

---

## MANDATORY CHECKLIST: RUNAWAY PROCESS DETECTION

**Run this checklist on EVERY spec that involves batch processing, enrichment, self-re-triggering chains, or scheduled automation.** This is BLOCKER-level — not a suggestion.

**How to identify which scripts need this check:** Look for `@execution batch`, `@execution scheduled`, or `@execution pipeline` in file headers (see gas_expert SKILL.md for the header standard). If scripts don't have headers yet, read the code to determine execution mode — and flag the missing header as a SUGGESTION.

**Why this exists:** Infinite loops where a batch process re-ran the same dataset for hours because it had no way to distinguish "not yet processed" from "processed but no data found" are a common and costly failure mode. Enrichment costs real money and runs unattended.

### The 4 Questions

For every process that loops, re-triggers, or runs in batches:

1. **What determines "done"?** Is it just "target column is blank"? If yes, that's a loop risk. Blank could mean "never attempted" OR "attempted but no data exists."

2. **What happens when processing succeeds but produces no output?** (API returns empty, lookup finds no match.) If the answer is "nothing gets written" — the row will be reprocessed forever.

3. **Is there a `Last_Enrichment` / `Last_Processed` timestamp?** The proven pattern: stamp every row that gets attempted, regardless of outcome. Use `Last_Import > Last_Enrichment` to detect rows that need re-processing because new upstream data arrived.

4. **Is there a max retry / circuit breaker?** Even with timestamps, is there a cap on total re-trigger cycles per run? A process that re-triggers 300 times because of a bug in the "remaining" counter is still a runaway.

### If Any Answer Is Wrong → BLOCKER

Flag it as:
```
### BLOCKER — Runaway Process Risk: [Process Name]

**What the spec says:** [how it determines what to process]
**The problem:** No termination guarantee. If [specific scenario], the process will loop indefinitely, burning API credits and trigger quota.
**Impact:** Real money wasted, Apps Script trigger quota exhausted, user won't notice for hours.
**Suggestion:** Add Last_Enrichment timestamp column. Stamp on every attempt (success or failure). Use timestamp comparison for re-enrichment eligibility. Add max cycle count as circuit breaker.
```

---

### Step 6: Verification Sweep (Post-Resolution)

**Forked execution note:** If contrarian ran as a forked agent, this step runs in the main Claude session — not here. The verdict in Step 4 already issued the instruction. Main session: re-read the updated spec after applying fixes, check for resolution side effects and cross-finding interactions, confirm clean before /build.

**After all findings from Step 5 are resolved and the spec is updated:**

Do a second, targeted pass. This is NOT a full re-review. It's a focused check on three things:

1. **Resolution side effects** — Did any fix introduce a new conflict?
2. **Cross-finding interactions** — Do any of the resolutions contradict each other?
3. **Fresh eyes** — With the low-hanging fruit resolved, scan once more for anything the first sweep missed.

**Iterative passes:** If the user has already run N prior contrarian passes with in-session fixes between each, default to targeted delta verification only — check what changed since the last pass, not a full re-read. Full re-read is appropriate only for pass 1 or after a major spec rewrite.

**Time budget:** 2-3 minutes. Read the updated spec, check the three items above, report.

**Output:**

If clean:
```
Verification sweep: CLEAN. No new issues from resolutions. Ready for /build.
```

If issues found:
```
Verification sweep: [N] new issues found.
[List with same SEVERITY — Description — Suggestion format as Step 2]
```

**Do NOT skip this step.** The first sweep catches spec problems. The verification sweep catches resolution problems. Both are necessary.

**If the sweep finds new issues:**
1. Resolve them with the user (same as Step 5)
2. Run another sweep against the new resolutions
3. **Max 2 sweeps.** If sweep 2 still surfaces issues, flag them for builder Step 0 to handle — don't keep looping.

**Exit condition:** Sweep returns CLEAN, or 2 sweeps completed. Either way, state the final verdict clearly.

---

## RULES

1. **Be specific, not vague.** "This might cause issues" is useless. "This conflicts with the scoring logic in 03_Screening.gs because..." is useful.
2. **Always offer alternatives.** Don't just say what's wrong — say how to fix it.
3. **Don't nitpick.** Focus on things that would cause rework, not stylistic preferences.
4. **Respect the Vibe Coding philosophy.** Don't flag "could be more efficient" unless it matters at scale.
5. **Don't inflate severity.** BLOCKER means truly blocking. Most issues are WARNINGs.
6. **If the spec is solid, say so.** "Two minor suggestions, otherwise ready to build" is a valid outcome.
7. **Every review MUST end with an explicit verdict line.** Format it as a standalone block — not inline prose. `READY TO BUILD / NEEDS REVISION / NEEDS RETHINK`. No exceptions.

---

## INTEGRATION

### With Interviewer
Contrarian reviews the output of Interviewer. If issues found, user resolves them (potentially re-entering interview for specific topics).

### With Builder
After contrarian review passes, the spec is approved for Builder execution.

---

## REMEMBER

> "The goal is to find problems that would cost hours to fix later — not to prove you're smarter than the spec."

A good contrarian review takes 5 minutes and saves 5 hours. A bad one creates busywork and delays shipping.
