---
name: skillaudit
description: "Produces a structured skill audit report after real use. Activates on '/skillaudit [skillname]', 'audit this skill', 'how did that skill do', 'let's get feedback on this skill'. Asks 6 standard questions, outputs a clean SKILLAUDIT_[name]_[date].md for the skills manager. Does NOT apply changes — that's the skills manager's job."
---

# SKILL: SKILLAUDIT

## TRIGGER

Activate when:
- User runs `/skillaudit [skillname]`
- User says "audit this skill", "how did that skill perform", "get me a report on [skill]"
- After real use of a skill, while feedback is fresh
- User wants to document skill feedback to hand off for updates

**This skill produces a report. It does NOT edit skill files.**
Editing is the skills manager's job. Skillaudit's job is structured diagnosis.

**Run in a clean/dedicated session.** Heavy session context pollutes audit signal.

---

## STEP 0: IDENTIFY THE SKILL

A skill name is required. If not provided:
```
Which skill do you want to audit?
```

Read the target SKILL.md immediately:
```
.claude/skills/[skillname]/SKILL.md
```

Read it fully before asking any questions. You need to know what the skill is supposed to do in order to map feedback to specific gaps.

---

## STEP 1: SCAN SESSION CONTEXT FIRST

Before asking the user anything, check whether the current session already contains usable audit material:

- Feedback or session transcripts passed in conversation
- Any self-assessment the skill produced during execution
- Moments where the user redirected the skill, corrected it, or called out a gap

**If rich context is available:** Self-populate the 6 questions as a Claude-authored assessment of the skill's performance in this session. Present it as:

```
Here's my assessment of [skill name] based on this session:

1. What it was used for: [from context]
2. What worked: [from context]
3. What was awkward / missing: [from context]
4. Routing accuracy: [from context]
5. Edge cases not handled: [from context]
6. Protocol gaps: [from context]

Confirm this, correct anything I got wrong, or add what I missed.
```

The user confirms, adjusts, or adds. Claude incorporates and moves to Step 3.

**If context is thin or absent:** Proceed to Step 2 and ask the user the 6 questions directly.

---

## STEP 2: ASK THE 6 QUESTIONS (if context is thin)

Present all 6 as a block. Same every time. Don't improvise a different framework.

```
Auditing: [skill name]

1. What did you use it for?
   (Task context — helps frame whether the skill was the right fit)

2. What worked well?
   (Behaviors to preserve — the skills manager needs to know what NOT to change)

3. What was awkward, missing, or wrong?
   (The core feedback — be specific if you can)

4. Did it route correctly?
   (Was this even the right skill? If not — what should have handled it?)

5. Any edge cases it hit that weren't handled?
   (Situations the skill's rules didn't cover)

6. Anything you found yourself correcting or re-explaining mid-session?
   (These are protocol gaps — things the skill should have caught automatically)
```

Work with whatever the user gives. Brief answers are fine. Follow up only if a specific answer needs more detail to be actionable.

**If the skill being audited is an orchestrating skill (spawns agent profiles), also ask:**
- Does every spawn include a four-part task description (Objective/Output/Tools/Boundary)?
- Are spawn prompts self-contained (no assumption the agent sees session history)?
- Are stop conditions defined to prevent infinite loops?
- Is tool scoping correct in the referenced agent profiles?

---

## STEP 3: MAP FEEDBACK TO SKILL SECTIONS

Before writing the report, map each piece of feedback to its location in the SKILL.md:

| Feedback type | Likely location in skill |
|--------------|------------------------|
| Wrong trigger / mis-invocation | TRIGGER or `Do NOT activate when` |
| Missing step | Protocol section |
| Anti-pattern discovered | RULES section |
| Routing gap | Routing table or INTEGRATION |
| Output format wrong | Output format spec in relevant step |
| Edge case not handled | New rule or conditional |
| "Kept re-explaining X" | X should be explicit in protocol |

This mapping goes into the report so the skills manager knows exactly where to look.

---

## STEP 4: PRODUCE THE AUDIT REPORT

Write to: `.claude/skills/audits/open/SKILLAUDIT_[skillname]_[YYYY-MM-DD].md`

**Output location is the canonical intake folder — `.claude/skills/audits/open/`.** Do not write to `.claude/skills/` root, inside any skill subdirectory, or any other location.

**Never overwrite an existing audit file.** Each audit is a permanent snapshot. Before writing, check whether `SKILLAUDIT_[skillname]_[YYYY-MM-DD].md` already exists. If it does, append a session suffix: `_s2`, `_s3`, etc. Two audits of the same skill on the same day are both valid.

```markdown
# Skill Audit: [skill name]
**Date:** [YYYY-MM-DD]
**Session context:** [one line — what was being worked on when the skill was used]

---

## What It Was Used For
[Task context from Q1]

## What Worked
[From Q2 — bullet list. These behaviors should be preserved.]
-
-

## What Was Awkward / Missing
[From Q3 — bullet list with enough detail to act on.]
-
-

## Routing Accuracy
[From Q4 — was this the right skill? If misrouted, what should have been called and why?]

## Edge Cases Not Handled
[From Q5]
- [case]: [what happened / what the skill should have done]

## Protocol Gaps (What I Kept Re-Explaining)
[From Q6 — these are the highest-priority updates]
- [pattern]: [what should be automatic]

---

## Proposed Updates for Skills Manager

| # | Section in SKILL.md | Current behavior | Proposed change | Source |
|---|--------------------|--------------------|-----------------|--------|
| 1 | [section name] | [what it currently does] | [what it should do] | Q[N] |

## Severity
- **BLOCKERS** (skill fails to do its core job): [N]
- **WARNINGS** (works but with friction): [N]
- **SUGGESTIONS** (nice to have): [N]

## Skills Manager Notes
[Anything that needs judgment before applying — conflicts with existing rules, ambiguous scope, potential side effects on other skills]
```

---

## RULES

1. **Same 6 questions. Every audit.** Consistency is the point.
2. **Read the skill first.** Never produce a report without understanding what the skill is supposed to do.
3. **Proposed updates are recommendations, not commands.** The skills manager decides what to apply.
4. **Preserve what worked.** Q2 exists for a reason — the skills manager needs the full picture, not just complaints.
5. **Map to specific sections.** Vague feedback ("it was confusing") is not actionable.
6. **Skills manager notes are for judgment calls.** If a proposed change might conflict with another skill, flag it.
7. **Never overwrite an existing audit file.** Audits are permanent snapshots. If the target filename already exists, use a session suffix (`_s2`, `_s3`).

---

## REMEMBER

> Skillaudit diagnoses. Skills manager fixes.
> The report is the deliverable.
> Same questions every time so nothing gets missed and nothing is inconsistent.
