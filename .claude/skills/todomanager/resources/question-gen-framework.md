# Question Generation Framework

**Purpose:** Guides Stage 2 velma in generating 5-10 targeted questions about a TODO ticket before solution design begins.
**Usage:** Read this file, read the ticket, select the most relevant question categories per layer, output questions only — no analysis yet.

---

## Layer 1 — VISION (What are we solving?)

Probe these categories:

- **Stated goal:** What is the ticket actually trying to accomplish? Is it clear enough to act on?
- **Trigger:** What broke, became painful, or newly became possible that surfaced this now?
- **Success definition:** What does done look like — measurably, specifically?
- **Scope boundary:** What is explicitly OUT of scope? What are we NOT doing?
- **Blast surface:** Who or what is affected when this is built?

Generate a question from this layer if: the ticket's goal is vague, the trigger is unstated, or "success" could mean multiple different things.

---

## Layer 2 — ARCHITECTURE (How does it fit the system?)

Probe these categories:

- **Extend vs. build new:** Does this add to something existing, or require a net-new component?
- **Source of truth:** Where does the relevant data currently live? Is that still the right home post-change?
- **Architectural paths:** Are there multiple viable approaches? What are the tradeoffs?
- **Blast radius:** Which files, tabs, scripts, or pipelines are touched or at risk?
- **Conflict check:** Does this duplicate existing functionality? Does it conflict with anything already built?
- **Simplicity challenge:** Is there a simpler way that accomplishes the same outcome?

Generate a question from this layer if: the ticket implies touching existing systems, the data home is ambiguous, or the approach is assumed rather than stated.

---

## Layer 3 — DATA FLOW (How does data move?)

Probe these categories:

- **Origin:** Where does the input data come from? Sheet, API, manual entry, trigger event?
- **Transformations:** What processing needs to happen between input and output?
- **Destination:** Where does the result land? Tab, column, email, log?
- **Trigger:** What initiates this process — manual action, schedule, event, or upstream completion?
- **Failure handling:** What happens when data is missing, malformed, or the process errors mid-run?
- **Error paths:** Are partial failures acceptable, or is this all-or-nothing?

Generate a question from this layer if: the ticket involves any data movement, transformation, or automation — i.e., almost always.

---

## Layer 4 — DETAILS AND EDGE CASES (What are the specifics?)

Probe these categories:

- **Field specifics:** Exact column names, sheet tab names, data types, required vs. optional
- **Thresholds:** Batch sizes, score cutoffs, timeout limits, row limits
- **Formatting:** Display format, date format, string casing, output structure
- **Priority logic:** If multiple records qualify, what wins? What's the ordering rule?
- **Edge cases:** Empty data, duplicate records, partial matches, timing conflicts, null values

Generate a question from this layer if: the ticket is close to implementation-ready and these specifics are unresolved — or if an assumption here could cause a silent bug.

---

## Selection Rules

- Target 5-10 questions total across all layers. Fewer is fine if the ticket is well-specified.
- Weight toward the layer with the most ambiguity in the ticket.
- Do not ask questions the ticket already answers clearly.
- Do not generate questions for their own sake — every question must block or de-risk something.
- Output questions only. No preamble, no analysis, no layer headers in the output unless they aid clarity.
