---
name: claudepa-closeout
description: "ClaudePA session closeout — processes pending updates to Active Searches, updates work category timestamps, manages FLAGS, verifies calendar writes. Standalone from /closeout."
---

# SKILL: CLAUDEPA-CLOSEOUT (Recruiting State Write-Back)

## TRIGGER

Activate on:
- `/claudepa-closeout`
- "close out ClaudePA"
- "wrap up the recruiting side"

Do NOT activate when:
- User runs `/closeout` — that is generic session hygiene, a separate skill
- User wants a briefing — route to `/claudepa` instead

---

## WHY THIS EXISTS SEPARATELY FROM /closeout

`/closeout` handles session hygiene: manifests, docs, memory. Its Step 4b would overwrite
`STATE.md` with a generic session log format, destroying the ClaudePA custom schema.

ClaudePA closeout handles recruiting state: pending updates to Active Searches, work category
timestamps, FLAGS, and calendar write verification. Two commands, each does its job cleanly.

---

## STEP 1: READ STATE

Read the ClaudePA STATE.md file (path configured in your project).

Parse these sections:
- `## Pending Updates` — entries marked `[pending]`
- `## FLAGS` — current flag state
- `## Work Category Timestamps` — current timestamps per category
- `## Calendar Writes` — pending overlay entries awaiting calendar confirmation
- `## Weekly Priorities` — note if updated this session

**Early exit condition:** If no `[pending]` entries exist and no flags require evaluation, output:
"Nothing to close out. STATE.md is clean."
Then stop.

---

## STEP 2: PROCESS PENDING UPDATES

For each `[pending]` entry in `## Pending Updates`, determine destination and write.

### Destination Routing

| Entry Content | Destination |
|---------------|-------------|
| Mentions a company or search name | Write to Active_Searches tab |
| Mentions a work category | Update Work Category Timestamps in STATE.md |
| Mentions both (e.g., "2 hours sourcing on Acme search") | Write both |

### Active_Searches Write Protocol

**Connection:**
- Spreadsheet ID: configured in `resources/data-sources.md`
- Sheet: `Active_Searches`
- Headers: Company, Title, Engagement_Type, Stage, Sourcing_Log, Blockers, Notes, Pipeline_Submitted, Pipeline_Interviewing, Pipeline_Offer, Pipeline_Notes

**Steps:**
1. Call `get_sheet_data` to read current Active_Searches state
2. Match target row by Company column value (header-based, never hardcode column letters)
3. Update relevant fields: Stage, Blockers, Notes, Pipeline counts
4. For Sourcing_Log: APPEND the new entry — do not overwrite. Keep last 10 entries.
5. Call `update_cells` to write the updated row

**Sourcing Log format contract:**

| Scenario | Format |
|----------|--------|
| Full entry | `[YYYY-MM-DD] — [N] InMails, [N.N] hrs. [Brief result note]` |
| No InMail count | `[YYYY-MM-DD] — ? InMails, [N.N] hrs. [note]` |
| No hours logged | `[YYYY-MM-DD] — [N] InMails. [note]` |

When Sourcing_Log exceeds 10 entries: truncate oldest, write cumulative summary as the first line:
`[CUMULATIVE as of YYYY-MM-DD] — NNN InMails, NN.N hrs total`

Note: Search health monitoring (Step 3) skips entries without `hrs` when computing cumulative totals.

**Scoping constraint:** NEVER touch any tab other than Active_Searches.

### Work Category Timestamp Write Protocol

Update the matching entry in `## Work Category Timestamps` in STATE.md.

Format: `[Category]: last touched [YYYY-MM-DD], [N hrs] logged`

### Apply / Fail Marking

- After each successful write: mark the entry `[applied]` in STATE.md
- If a write fails: mark the entry `[failed: <error note>]` in STATE.md
- After the full pass completes: clear all `[applied]` entries from Pending Updates
- Leave `[failed]` entries in place for manual review — do not retry automatically

**Why mark-then-clear instead of delete-on-success:** Prevents double-apply if a partial failure
interrupts the run. Applied entries only clear after the full pass completes cleanly.

### Last Check-In Date Stamp

After the full pending updates pass completes (all entries marked and cleared), write the following field to STATE.md (update or add if missing):

```
Last_CheckIn_Date: YYYY-MM-DD
```

Use today's date. This field is read by claudepa STEP 0.5 to gate the day-of-week check-in — once set, the check-in will not re-fire until the next calendar day. Write it in the STATE.md header section alongside other metadata fields.

---

## STEP 3: UPDATE FLAGS

Evaluate flag conditions after all pending updates are applied. Flag state depends on current
data — process Step 2 first.

### Set Flags When

| Condition | Flag Format |
|-----------|-------------|
| Category not touched in 3+ days | `[ACTIVE] [Category neglect] [Category] — last touched [date] ([N] days ago)` |
| Other project work >50% of tracked week hours | `[ACTIVE] [Balance drift]` |
| Active search with Pipeline_Submitted = 0 or blank | `[ACTIVE] [Pipeline health] [Company] — no candidates submitted` |
| Search open >2 months + >30 cumulative hrs + Stage is Sourcing or Submitted | `[ACTIVE] [Search health] [Company] — open [N] months, [N] hrs` |
| `Week: —` in STATE.md Weekly Priorities AND Session Log has prior entries | `[ACTIVE] [ATTENTION] Weekly priorities — unset for multiple sessions` |

### Clear Flags When

| Flag Type | Clear Condition |
|-----------|----------------|
| Category neglect | Activity logged for that category this session |
| Balance drift | Core work hours exceed other project hours this week |
| Pipeline health | A candidate was submitted to that search |
| Search health | Stage advances to Interviewing or Offer, or search is closed |
| ATTENTION: Weekly priorities | `Week: —` replaced with a confirmed priority list this session |

### Dismissed Flag Expiry

Dismissed flags have an expiry date. At closeout:
1. Check expiry date on each dismissed flag
2. If expired (>7 days since dismissal): re-evaluate the underlying condition
3. If condition still true: reactivate the flag (set to `[ACTIVE]`)
4. If condition resolved: remove the flag entirely

### Write

Update the `## FLAGS` section in STATE.md with the result of this evaluation.

---

## STEP 4: CHECK CALENDAR WRITES

For each entry in `## Calendar Writes`:

1. Call `search-events` on the primary Google Calendar using the event summary string as the search term
2. If event found in primary: remove the entry from STATE.md (confirmed written)
3. If event not found: increment the `checks` counter on that entry
4. If `checks` >= 5: auto-expire — remove the entry and surface this warning:

> "Calendar event '[summary]' was not confirmed in Google Calendar after 5 checks — the write may have failed. Verify in Google Calendar directly."

**Sync note:** ClaudePA writes to Google primary. Events sync to other calendar clients (Outlook, etc.) via CalDAV — this can take longer than one session and is expected behavior, not a failure. If an event is confirmed in Google primary, it will reach other clients. If it is NOT in Google primary after 5 checks, the write likely failed.

---

## STEP 5: PRESENT SUMMARY

```
## ClaudePA Closeout Summary

### Updates Processed
- [N] applied, [N] failed, [N] remaining

### Active Searches Updated
- [Company]: [what changed]

### Work Categories Updated
- [Category]: last touched [date]

### FLAGS
- [N] active, [N] cleared, [N] set this closeout

### Calendar Writes
- [N] confirmed in Google Calendar (removed), [N] pending, [N] expired (warnings above)

### Needs Attention
- [any failed updates or expired calendar writes]
```

If there is nothing in "Needs Attention", omit that section entirely.

---

## RULES

1. Read STATE.md first. Always. It is the only input.
2. Process ALL pending updates (Step 2) before evaluating flags (Step 3). Flag conditions depend
   on updated state.
3. Active_Searches writes are scoped to that tab ONLY. Never read or write any other tab.
4. Use header-based column lookup for Active_Searches. Never hardcode column letters — the schema
   may evolve.
5. Mark entries `[applied]` individually during the pass. Clear all `[applied]` entries only
   after the full pass completes successfully. This prevents double-apply on partial failure.
6. Leave `[failed]` entries in STATE.md. Do not retry automatically. Manual review only.
7. Calendar write verification checks the primary Google Calendar, not any import/ICS feed. If an event is confirmed in Google primary, it WILL sync to other clients (CalDAV lag is normal and can exceed one session). An event not found in primary after 5 checks is a likely write failure — not a sync delay.
8. Do NOT modify the generic `/closeout` skill. These are independent skills with different
   write surfaces.
9. Do NOT overwrite STATE.md sections not owned by this skill. Sections off-limits:
   `## Weekly Schedule`, `## Weekly Priorities`, `## Decisions`, `## Session Log`,
   `## Skill Feedback`. Sections owned by this skill: `## Pending Updates`, `## FLAGS`,
   `## Work Category Timestamps`, `## Calendar Writes`.

---

## INTEGRATION

| Skill | Relationship |
|-------|-------------|
| `/claudepa` | Main skill. Writes `[pending]` entries to STATE.md during the session. Closeout processes them. |
| `/closeout` | Generic session hygiene. Runs separately after this skill. Does not touch ClaudePA STATE.md. |
| `Active_Searches` tab | Write target in your spreadsheet. MCP write (pre-approved). |
| Google Calendar MCP | Read-only at closeout — checks Google primary to confirm calendar writes landed. Sync lag to other clients is expected and not verified here. |

**Typical end-of-session sequence:**
1. `/claudepa-closeout` — processes recruiting state, writes to Active_Searches, updates STATE.md
2. `/closeout` — processes session manifest, docs, memory hygiene

---

## REMEMBER

> ClaudePA closeout is the write path. ClaudePA reads and captures. Closeout processes and writes.

> Pending Updates in STATE.md are the queue. Process them all, mark them applied, clear after
> the full pass completes.

> Never touch anything outside the Active_Searches tab and STATE.md. That is the entire write
> surface. Keep it clean.
