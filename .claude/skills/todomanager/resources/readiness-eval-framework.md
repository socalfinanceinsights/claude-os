# Readiness Evaluation Framework

**Purpose:** Guides Stage 4 velma in assessing whether an enriched ticket is ready for autonomous Claude execution without further user input.
**Usage:** Read this file, read the enriched ticket and all Stage 3 research. Apply the 7 evaluation dimensions. Output the verdict block exactly as specified.

---

## Evaluation Lens

**The question is not "is this a good ticket?" The question is: "If Claude executes this autonomously right now, what is the probability of a bad outcome that the user has to clean up?"**

This is a readiness-for-delegation assessment. Not a code quality review. Not a spec review. Focus exclusively on blast radius and risk of autonomous execution at this stage.

---

## Verdict Schema

| Verdict | Meaning |
|---------|---------|
| **READY** | Can be executed autonomously. Low blast radius, scope is bounded, no questions only the user can answer. |
| **NEARLY_READY** | Close — but has 1-2 specific blockers requiring user input before execution can proceed. |
| **NOT_READY** | Significant gaps, unclear scope, high blast radius, or requires substantial user direction. |

These map from contrarian's native verdicts: READY TO BUILD → READY, NEEDS REVISION → NEARLY_READY, NEEDS RETHINK → NOT_READY.

---

## The 7 Evaluation Dimensions

Apply all 7 to every ticket. Weight your verdict toward the highest-severity issues found.

### 1. Conflicts with Existing Systems
Does the ticket's intent contradict what is already built? Would execution overwrite, break, or duplicate something? Check: existing scripts, sheet schemas, other tickets in the queue that touch the same area.

### 2. Scope Clarity
Can Claude determine when it is done? Is the scope bounded with clear entry and exit conditions? A ticket that could expand in-flight ("while I'm in there, I'll also...") is not autonomous-safe.

### 3. Missing Information
Are there decisions or values only the user can supply? Examples: approval of an approach not yet discussed, a threshold not specified, a preference between two valid options. If Claude would have to guess or assume to proceed — that is a blocker.

### 4. Cascading Impacts
Will execution trigger downstream changes in systems not accounted for in the ticket? Check: does this write to a column that feeds a formula? Does it modify a shared config? Does it change behavior for a process that runs on a schedule?

### 5. Reversibility
If execution goes wrong, how hard is cleanup? Easy = low risk = more autonomy-friendly. Hard = high risk = more caution required.

- **Easy:** Adds new column, writes to isolated area, creates a new file — nothing to unwind.
- **Moderate:** Overwrites existing data that can be recovered from backup or history.
- **Hard:** Deletes records, restructures schema, modifies shared configs, triggers external sends (emails, API calls).

### 6. Edge Cases
Are failure modes identified and handled — or at minimum, are they low-impact if unhandled? Unhandled edge cases in high-blast-radius operations are NOT autonomy-safe.

### 7. Unstated Assumptions
What is the ticket assuming without saying? Pay attention to: assumed data shapes, assumed tab/column existence, assumed permissions, assumed behavior of upstream systems. Each unverified assumption is a potential silent failure.

---

## Evaluation Process

1. Read the ticket — stated goal, scope, acceptance criteria, any existing constraints.
2. Read Stage 3 research findings (classification context, system knowledge, prior enrichment).
3. Score each dimension: clean / concern / blocker.
4. Assign verdict: any blocker → NOT_READY or NEARLY_READY depending on whether the blocker is resolvable with targeted user input. Multiple concerns without blockers → NEARLY_READY. Clean across all → READY.
5. Output the verdict block below.

---

## Output Format

Follow this format exactly. Do not add sections, rename fields, or collapse into prose.

```markdown
## Readiness Evaluation — [YYYY-MM-DD]

### Verdict: [READY / NEARLY_READY / NOT_READY]

### Blockers
- [specific blocker — what is missing or risky]
- [or "None" if READY]

### Analysis
[Freeform evaluation covering the 7 dimensions. Be specific — cite ticket content, research findings, and classification context. Do not write generic observations. If a dimension is clean, one line is sufficient. Weight depth toward the dimensions with actual findings.]

### Risk Assessment
- **Blast radius:** [what gets affected if this goes wrong — be concrete]
- **Reversibility:** [easy / moderate / hard — with one-line explanation]
- **Confidence:** [high / medium / low — how confident are you in this verdict, and why]
```

---

## Rules

1. **Be specific.** "This might cause issues" is noise. "The ticket assumes `Stage` column exists in tab W, which does not appear in the current schema" is a finding.
2. **Cite the ticket.** Reference actual ticket language or Stage 3 findings, not generic concerns.
3. **Do not inflate risk.** NEARLY_READY is not a hedge. If the only gap is one concrete question the user can answer in one sentence, that is not NOT_READY.
4. **Do not deflate risk.** Hard-to-reverse operations with unresolved unknowns are not READY because the ticket is well-written.
5. **Reversibility drives the floor.** A hard-to-reverse ticket with any unresolved ambiguity is NEARLY_READY at minimum.
6. **READY means truly ready.** If you have lingering doubt, that doubt belongs in the Analysis — and the verdict should reflect it.
