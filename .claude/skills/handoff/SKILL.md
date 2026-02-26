---
name: handoff
description: "Creates Claude-consumable handoffs and /build-ready PLANs. Activates on '/handoff', 'create a handoff', 'document this for next session', 'write the handoff', or when ending a session with pending work. All output is written for Claude, not humans. Prevents the 'next session went astray' failure mode."
context: fork
---

# SKILL: HANDOFF

## TRIGGER

Activate when:
- User runs `/handoff`
- User says "create a handoff", "document this for next session", "write the handoff"
- Session is ending with pending work that a future session will pick up
- User needs a PLAN file that `/build` will execute later

**Do NOT activate when:**
- Session has no pending work → use `/closeout` instead
- Work is fully complete with no downstream session needed

---

## CORE PRINCIPLE

**Claude is always the consumer. Write accordingly.**

Every handoff is written to be read by Claude, not by a human:
- Structured sections with consistent headers — Claude navigates by section
- Exact file paths — Claude will `Read` them directly, no fuzzy references
- Facts labeled explicitly: Confirmed, Assumed, or Unknown — no ambiguity passed as certainty
- Unambiguous first action at the top — not buried after context
- Zero narrative padding, zero pleasantries

The only document written for human consumption is `README.md`.

---

## TWO OUTPUT TYPES

### Type 1: Session Handoff (HANDOFF_*.md)
For the next Claude session to orient and continue work. Not for `/build` execution.

### Type 2: Builder PLAN (PLAN_*.md)
For `/build` to execute. Requires XML `<task>` blocks — triggers skip-to-execution shortcut. Without blocks, `/build` re-decomposes the plain text, adding overhead and re-interpretation risk.

**Can be both:** A PLAN file with XML blocks AND context sections is builder-executable AND gives the next session the state it needs.

---

## STEP 0: READ CONTEXT

Before asking anything, read what's available:
1. `SESSION_MANIFEST_[DATE].md` — what was read/written/edited this session
2. `[project]/STATE.md` — current position, decisions, blockers
3. Any open PLAN or REQUIREMENTS docs referenced in the session

Pre-populate done vs. pending from this. Don't ask the user to re-explain what's already in the manifest.

---

## STEP 1: SCOPE

**Count the concerns first.**

How many independent concerns did this session produce? A concern is independent if a receiving session would work on it separately — different features, different projects, different problem threads.

- **1 concern → 1 handoff doc**
- **N concerns → N handoff docs** — one per concern, focused

Do not consolidate multiple concerns into one doc. A receiving session parsing a multi-concern handoff wastes context and risks missing the relevant thread.

**Then ask only what you can't infer from context (2 questions max):**

**Q1:** What does the next session need to do with this?
- Continue the work (session handoff)
- Execute with `/build` (builder PLAN)
- Both

**Q2 (only if unclear):** Which scope?
- Full project state
- Specific feature in progress
- Defined set of build tasks

---

## STEP 2: GATHER STATE

For each concern, collect the following. **Label every factual claim** before writing anything down.

**The three labels:**
- **Confirmed:** You verified this yourself this session — you read the file, ran the script, saw the output.
- **Assumed:** You believe it's true but did not verify it this session.
- **Unknown:** You don't know. Do not guess — flag it explicitly.

Never pass an assumption as Confirmed. The receiving session will act on it as fact and burn time backtracking when it turns out to be wrong.

**What to collect:**
- Done this session — what was completed (from manifest + context)
- Pending — what still needs to happen, in what order
- Decisions — anything the next session should not re-debate
- Blockers/gotchas — anything the next session will hit without warning
- Known issues — errors or edge cases discovered, not blocking but real
- File paths — exact paths for everything referenced (verify they exist)
- Success criteria — for each pending item: done when what, specifically?

**Direct references only.** If the full context is in a file, write the file path. Do not re-summarize the file's contents — summaries lose nuance and drift from reality.

---

## STEP 3: GENERATE

### Format A: Session Handoff

**File:** `HANDOFF_[Project]_[YYYY-MM-DD].md`
**Location:** `docs/active/` — always write to the full absolute path. Move to `docs/archive/` after consumed.

```markdown
# Handoff: [Project / Feature] — [YYYY-MM-DD]

## Next Session Starts Here
[ONE action. Not a list. Not "review the context." This is the first thing the receiving Claude does.
If you cannot write one unambiguous action, the handoff is not ready.]

## Status
[COMPLETE | IN_PROGRESS | BLOCKED — one word plus one sentence maximum]

## Context Fidelity
| Claim | Label | Source |
|-------|-------|--------|
| [factual claim] | Confirmed | [file path or direct observation] |
| [factual claim] | Assumed | [basis for assumption] |
| [open question] | Unknown | — |

[Omit this section only if there are zero factual claims to label.]

## Done This Session
- [exact item]
- [exact item]

## Pending (ordered)
1. [exact item — include file path if applicable]
2. [exact item]

## Decisions (do not re-debate)
- [decision]: [rationale in one sentence]
- [decision]: [rationale]

## Blockers / Gotchas
- [specific issue — enough detail for a Claude instance with zero prior context]

## Files
| Path | Status | Notes |
|------|--------|-------|
| [exact path] | DONE / PENDING / IN_PROGRESS | [anything Claude needs to know] |

## Success Criteria
- [ ] [specific, checkable — not "looks good"]
- [ ] [specific, checkable]

## State Reference
[project]/STATE.md — [specific section or note if relevant]
```

### Format B: Builder PLAN

**File:** `PLAN_[Feature]_[YYYY-MM-DD].md`
**Location:** project root (builder looks here)

XML `<task>` blocks trigger `/build`'s skip-to-execution shortcut. Without them, builder re-decomposes the plain text. Always use blocks when the consumer is `/build`.

```markdown
# PLAN: [Feature Name]
**Date:** [YYYY-MM-DD]
**Status:** READY FOR /build

## Context
[Why this is being built — one paragraph.]

## Prerequisites
[Anything that must be true before /build runs — exact conditions, not general guidance]

## Known Issues
[Errors or edge cases discovered this session that the executor may encounter.]
- [issue]: [what it is and what the executor should do if it hits it]
[Omit if no known issues.]

<task id="1" wave="1" skills="[skill1,skill2]">
  <title>[Imperative title — what this task does]</title>
  <files>[Exact file paths this task reads or writes]</files>
  <instructions>[Step-by-step — specific enough for a fresh-context agent with no prior session knowledge]</instructions>
  <verify>[Done when: specific and checkable. Not "verify it works."]</verify>
</task>

<task id="2" wave="1" skills="[skill]">
  <!-- wave="1" = runs in parallel with task 1 -->
</task>

<task id="3" wave="2" skills="[skill]">
  <!-- wave="2" = depends on wave 1 completing first -->
</task>

## Success Criteria
- [ ] [overall done condition 1]
- [ ] [overall done condition 2]
```

### Format C: Both

Session context + XML blocks in the same file. Name it PLAN_ (builder will consume it), include context sections for orientation.

---

## STEP 4: VALIDATE

Run before finalizing. A handoff that fails this check will derail the next session.

**All handoffs:**
- [ ] "Next Session Starts Here" is the FIRST content section — not buried after context
- [ ] "Next Session Starts Here" contains ONE unambiguous action, not a list
- [ ] Context Fidelity table is present and all factual claims are labeled Confirmed / Assumed / Unknown
- [ ] No summaries of files that can be directly referenced — file paths, not summaries
- [ ] This doc covers exactly ONE concern — if multiple concerns exist, produce multiple handoffs
- [ ] All file paths are exact — no fuzzy references like "the config file" or "that script"
- [ ] Decisions are documented as settled facts, not open questions
- [ ] Success criteria are specific and checkable
- [ ] STATE.md is referenced or updated with anything discovered this session

**Builder PLANs:**
- [ ] Every `<task>` has a `<verify>` with a specific checkable condition
- [ ] Wave assignments reflect actual dependencies
- [ ] `<files>` lists exact paths, not directory descriptions
- [ ] `<instructions>` assume a fresh-context agent with zero prior session knowledge
- [ ] Skills in each task match what the task actually needs

**Anti-patterns to reject:**
- "Next session should figure out X" → not a handoff, it's a punt
- Assumed fact labeled as Confirmed → re-label correctly, or verify it
- Summary of a file's contents → replace with the file path
- Multiple concerns consolidated into one doc → split into separate handoffs
- `<verify>Check that it works</verify>` → not checkable

---

## RULES

1. **Write for Claude, not for humans.** Structure over narrative. Exact paths. Facts labeled. No ambient context assumptions.
2. **Next Session Starts Here is first.** Not fourth. Not buried after context. First section, one action.
3. **Label every factual claim.** Confirmed = verified this session. Assumed = believed but unverified. Unknown = flag it.
4. **Reference files, don't summarize them.** If context is in a file, write the path.
5. **One doc per concern.** Multiple concerns → multiple handoffs.
6. **XML blocks for builder.** If `/build` is consuming this, write task blocks.
7. **Decisions are final.** Document settled decisions as facts.
8. **Validate before calling it done.** Run Step 4.
9. **Naming and location are not optional.** Use absolute paths — HANDOFF_ in `docs/active/`, PLAN_ in project root.
10. **Update STATE.md.** If decisions or blockers were discovered this session, update STATE.md before or during handoff generation.

---

## INTEGRATION

### With Closeout
`/closeout` verifies handoff docs are correctly filed. `/handoff` creates them.

### With Builder
PLAN files with XML task blocks are builder's native input format.

### With STATE.md
STATE.md tracks cross-session decisions and position. HANDOFF captures single-session context.

---

## REMEMBER

> Claude is reading this, not a human.
> Next Session Starts Here: one action, at the top, not buried.
> Assumed facts passed as Confirmed are how sessions go wrong.
> If the file exists, write the path. Don't re-summarize it.
> One concern per doc. If you're consolidating, you're doing it wrong.
