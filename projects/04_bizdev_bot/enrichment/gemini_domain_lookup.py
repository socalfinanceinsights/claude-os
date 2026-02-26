"""
gemini_domain_lookup.py — One-time script: resolve company domains via Gemini Batch API.

Reads HM_Person_Master col A:Q, sends company names (col E) to Gemini to resolve
the root domain, normalizes results, and writes them back to col F (Company_Domain).

Execution mode: one-time

Usage:
    python gemini_domain_lookup.py submit [--limit N]   # Build + submit batch job
    python gemini_domain_lookup.py collect              # Poll job + apply results to sheet
    python gemini_domain_lookup.py test [--limit N]     # Sequential test run (5 rows default)
"""

import csv
import io
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

# Fix Windows cp1252 console encoding — must be at top before any print()
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build


# ─── CONFIG ───────────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

PROJECT_ROOT   = Path("C:/AG_Work/04_BizDev_Bot")
TOKEN_PATH     = PROJECT_ROOT / "token.json"
SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets"]

HM_PERSON_MASTER_SHEET = "HM_Person_Master"
PM_KEY_COL_IDX         = 0   # col A: Composite_Key
PM_COMPANY_COL_IDX     = 4   # col E: Company
PM_DOMAIN_COL_IDX      = 5   # col F: Company_Domain (write target)
PM_DOMAIN_COL_LETTER   = "F"
TOTAL_PM_COLS          = 17  # col A through Q (row padding target)

FLASH_MODEL = "gemini-2.5-pro"

JUNK_VALUES = {"[none]", ".", "_", "8d6", "linkedin", "linkedin marketing automation"}

CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"
CHECKPOINT_CSV = Path(__file__).parent / "gemini_domain_lookup_checkpoint.csv"


# ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a company domain lookup assistant. Given a company name, return ONLY the primary root domain (e.g. "deloitte.com", "ey.com", "amazon.com").

Rules:
- Return only the root domain, nothing else — no http://, no www., no paths, no explanation
- If the company is a well-known firm with a clear domain, return it (e.g. "EY" → "ey.com", "PwC" → "pwc.com", "KPMG" → "kpmg.com")
- If you are not confident or the name is ambiguous, return exactly: null
- Do not guess. Only return a domain you are certain about."""


# ─── AUTHENTICATION ───────────────────────────────────────────────────────────

def get_credentials() -> Credentials:
    """
    Load credentials from token.json.
    MCP token format uses 'token' instead of 'access_token' — normalise before
    constructing Credentials. Mirrors import_to_sheet.py exactly.
    """
    raw = json.loads(TOKEN_PATH.read_text(encoding="utf-8"))

    # Normalise: MCP writes 'token', google-auth expects 'access_token'
    if "token" in raw and "access_token" not in raw:
        raw["access_token"] = raw.pop("token")

    creds = Credentials(
        token=raw.get("access_token"),
        refresh_token=raw.get("refresh_token"),
        token_uri=raw.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=raw.get("client_id"),
        client_secret=raw.get("client_secret"),
        scopes=raw.get("scopes", SCOPES),
    )

    if creds.expired and creds.refresh_token:
        print("Token expired — refreshing...")
        creds.refresh(Request())
        updated = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": list(creds.scopes) if creds.scopes else SCOPES,
            "universe_domain": "googleapis.com",
            "account": "",
            "expiry": creds.expiry.isoformat() if creds.expiry else None,
        }
        TOKEN_PATH.write_text(json.dumps(updated, indent=2), encoding="utf-8")
        print("Token refreshed and saved.")

    return creds


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def strip_json_fences(text: str) -> str:
    """Remove markdown code fences from Gemini response text."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def normalize_domain(raw: str):
    """
    Strip URL scaffolding and validate the domain string.
    Returns normalized domain string, or None if invalid.
    """
    d = raw.strip().lower()
    d = re.sub(r'^https?://', '', d)
    d = re.sub(r'^www\.', '', d)
    d = d.split('/')[0].strip()
    if '.' not in d or ' ' in d or len(d) < 4 or len(d) > 60:
        return None
    return d


# ─── READ TARGETS ─────────────────────────────────────────────────────────────

def read_targets(service, limit=None) -> tuple[list[dict], dict]:
    """
    Read HM_Person_Master col A:Q.
    Returns (targets, counts) where:
        targets = list of {row_num, composite_key, company_name}
        counts  = {total_rows_with_key, already_have_domain, blank_col_e, junk_col_e}
    """
    print(f"\nReading {HM_PERSON_MASTER_SHEET} col A:Q...")

    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{HM_PERSON_MASTER_SHEET}!A:Q",
        )
        .execute()
    )

    rows = resp.get("values", [])
    print(f"  Rows returned (including header): {len(rows)}")

    counts = {
        "total_rows_with_key": 0,
        "already_have_domain": 0,
        "blank_col_e": 0,
        "junk_col_e": 0,
    }
    targets = []

    # Row 0 is header — skip it; row_num starts at 2
    for row_idx, row in enumerate(rows[1:], start=2):
        # Pad to TOTAL_PM_COLS before any index access
        while len(row) < TOTAL_PM_COLS:
            row.append("")

        composite_key = row[PM_KEY_COL_IDX].strip()
        company_name  = row[PM_COMPANY_COL_IDX].strip()
        domain        = row[PM_DOMAIN_COL_IDX].strip()

        if not composite_key:
            continue  # col A blank — not a data row

        counts["total_rows_with_key"] += 1

        if domain:
            counts["already_have_domain"] += 1
            continue

        if not company_name:
            counts["blank_col_e"] += 1
            continue

        if company_name.lower() in JUNK_VALUES:
            counts["junk_col_e"] += 1
            continue

        targets.append({
            "row_num":       row_idx,
            "composite_key": composite_key,
            "company_name":  company_name,
        })

    if limit:
        targets = targets[:limit]

    gemini_targets = len(targets)
    print(f"  Rows with key (col A non-blank)  : {counts['total_rows_with_key']:,}")
    print(f"  Already have domain (col F)       : {counts['already_have_domain']:,}")
    print(f"  Blank col E (skip)                : {counts['blank_col_e']:,}")
    print(f"  Junk col E (skip)                 : {counts['junk_col_e']:,}")
    print(f"  Gemini targets                    : {gemini_targets:,}")

    return targets, counts


# ─── SUBMIT ───────────────────────────────────────────────────────────────────

def submit_batch(client, service, limit=None):
    """Build inline batch requests and submit to Gemini Batch API."""
    print("=" * 60)
    print("gemini_domain_lookup.py — SUBMIT")
    print("=" * 60)

    targets, _counts = read_targets(service, limit)

    if not targets:
        print("\nNo targets found — nothing to submit.")
        return

    print(f"\nBuilding {len(targets)} inline requests...")
    inline_requests = []
    keys_ordered = []
    company_names_ordered = []

    for t in targets:
        keys_ordered.append(t["composite_key"])
        company_names_ordered.append(t["company_name"])
        inline_requests.append(
            types.InlinedRequest(
                contents=f"Company name: {t['company_name']}",
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.0,
                ),
            )
        )

    ts = datetime.now().strftime("%Y%m%d_%H%M")
    print(f"Submitting batch job ({len(inline_requests)} requests)...")

    job = client.batches.create(
        model=f"models/{FLASH_MODEL}",
        src=inline_requests,
        config={"display_name": f"domain_lookup_{ts}"},
    )

    print(f"Job name:   {job.name}")
    print(f"State:      {job.state.name}")
    print(f"Items:      {len(inline_requests)}")

    # Save job info — index position maps response → row
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    job_info = {
        "job_name": job.name,
        "submitted_at": datetime.now().isoformat(),
        "item_count": len(inline_requests),
        "keys_ordered": keys_ordered,
        "company_names_ordered": company_names_ordered,
    }
    job_info_path = CHECKPOINT_DIR / "batchjob_domain_lookup.json"
    with open(job_info_path, "w", encoding="utf-8") as f:
        json.dump(job_info, f, indent=2)

    print(f"\nJob info saved: {job_info_path}")
    print("Run 'python gemini_domain_lookup.py collect' to check status and apply results.")


# ─── COLLECT ──────────────────────────────────────────────────────────────────

def collect_batch(client, service):
    """Poll batch job status. If succeeded, parse responses and write domains to sheet."""
    print("=" * 60)
    print("gemini_domain_lookup.py — COLLECT")
    print("=" * 60)

    job_info_path = CHECKPOINT_DIR / "batchjob_domain_lookup.json"
    if not job_info_path.exists():
        print(f"ERROR: Job info not found at {job_info_path}")
        print("Run 'python gemini_domain_lookup.py submit' first.")
        sys.exit(1)

    with open(job_info_path, encoding="utf-8") as f:
        job_info = json.load(f)

    job_name              = job_info["job_name"]
    keys_ordered          = job_info["keys_ordered"]
    company_names_ordered = job_info["company_names_ordered"]

    print(f"Job:       {job_name}")
    print(f"Submitted: {job_info.get('submitted_at', 'unknown')}")
    print(f"Items:     {job_info.get('item_count', '?')}")

    batch_job = client.batches.get(name=job_name)
    state = batch_job.state.name
    print(f"State:     {state}")

    if state in ("JOB_STATE_PENDING", "JOB_STATE_RUNNING"):
        print("\nJob still in progress. Re-run collect when complete.")
        return

    if state != "JOB_STATE_SUCCEEDED":
        print(f"\nJob did not succeed: {state}")
        if hasattr(batch_job, "error"):
            print(f"Error: {batch_job.error}")
        sys.exit(1)

    # Parse inline responses — index matches keys_ordered
    inlined = batch_job.dest.inlined_responses
    print(f"\nParsing {len(inlined)} inline responses...")

    results = {}          # {composite_key: domain}
    checkpoint_rows = []  # all targets, for CSV
    n_domain_found   = 0
    n_null_result    = 0
    n_invalid_format = 0

    for i, resp in enumerate(inlined):
        key          = keys_ordered[i] if i < len(keys_ordered) else f"row_{i}"
        company_name = company_names_ordered[i] if i < len(company_names_ordered) else ""

        try:
            raw_text = strip_json_fences(resp.response.text).strip()
        except Exception:
            raw_text = ""

        # Gemini returns "null" when not confident — treat as no result
        if not raw_text or raw_text.lower() == "null":
            n_null_result += 1
            checkpoint_rows.append({
                "composite_key": key,
                "company_name":  company_name,
                "domain_found":  "",
                "status":        "skipped_no_result",
            })
            continue

        domain = normalize_domain(raw_text)
        if domain is None:
            n_invalid_format += 1
            checkpoint_rows.append({
                "composite_key": key,
                "company_name":  company_name,
                "domain_found":  "",
                "status":        "skipped_invalid",
            })
            continue

        n_domain_found += 1
        results[key] = domain
        checkpoint_rows.append({
            "composite_key": key,
            "company_name":  company_name,
            "domain_found":  domain,
            "status":        "domain_found",
        })

    # Write checkpoint CSV
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["composite_key", "company_name", "domain_found", "status"])
        writer.writeheader()
        writer.writerows(checkpoint_rows)
    print(f"Checkpoint CSV written: {CHECKPOINT_CSV}")

    if not results:
        print("No valid domains to write — exiting.")
        return

    # Re-read HM_Person_Master col A:F — blank-only guard
    # Cells may have been filled since submit; only write to still-blank cells
    print(f"\nRe-reading {HM_PERSON_MASTER_SHEET} col A:F (blank-only guard)...")
    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{HM_PERSON_MASTER_SHEET}!A:F",
        )
        .execute()
    )
    current_rows = resp.get("values", [])

    # Build map: composite_key -> row_num, only for rows where col F is still blank
    still_blank_map = {}
    for row_idx, row in enumerate(current_rows[1:], start=2):
        while len(row) < 6:
            row.append("")
        key    = row[PM_KEY_COL_IDX].strip()
        domain = row[PM_DOMAIN_COL_IDX].strip()
        if key and not domain:
            still_blank_map[key] = row_idx

    n_still_blank_guard = 0
    writes = []
    for key, domain in results.items():
        if key not in still_blank_map:
            n_still_blank_guard += 1
            continue
        row_num = still_blank_map[key]
        cell_ref = f"{HM_PERSON_MASTER_SHEET}!{PM_DOMAIN_COL_LETTER}{row_num}"
        writes.append({
            "range":  cell_ref,
            "values": [[domain]],
        })

    # Single batchUpdate call — copy write_domains pattern from backfill_hm_domains.py
    if not writes:
        print("Nothing to write after blank-only guard — skipping batchUpdate.")
    else:
        print(f"\nWriting {len(writes)} domains in a single batchUpdate call...")
        resp = (
            service.spreadsheets()
            .values()
            .batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body={
                    "valueInputOption": "RAW",
                    "data": writes,
                },
            )
            .execute()
        )
        total_updated = resp.get("totalUpdatedCells", len(writes))
        print(f"  batchUpdate complete — cells updated: {total_updated}")

    # Summary
    total_with_key     = job_info.get("item_count", len(checkpoint_rows))
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Gemini targets (submitted)         : {total_with_key:,}")
    print(f"  Gemini returned domain             : {n_domain_found:,}")
    print(f"  Gemini returned null               : {n_null_result:,}")
    print(f"  Invalid domain format              : {n_invalid_format:,}")
    print(f"  Still blank at write time (guard)  : {n_still_blank_guard:,}")
    print(f"  Domains written to col F           : {len(writes):,}")
    print(f"  Checkpoint CSV                     : {CHECKPOINT_CSV.relative_to(Path(__file__).parent.parent)}")
    print("=" * 60)


# ─── TEST (SEQUENTIAL) ────────────────────────────────────────────────────────

def test_sequential(client, service, limit=5):
    """Sequential mode — confirms setup works. Reads targets, calls Gemini one at a time. No writes."""
    print("=" * 60)
    print(f"gemini_domain_lookup.py — TEST (limit={limit})")
    print("=" * 60)

    targets, _counts = read_targets(service, limit)

    if not targets:
        print("No targets found.")
        return

    print(f"\nRunning {len(targets)} sequential Gemini calls...\n")

    for i, t in enumerate(targets, start=1):
        try:
            response = client.models.generate_content(
                model=FLASH_MODEL,
                contents=f"Company name: {t['company_name']}",
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.0,
                ),
            )
            raw = strip_json_fences(response.text).strip()
        except Exception as e:
            raw = f"ERROR: {e}"

        domain = normalize_domain(raw) if raw and raw.lower() != "null" else None
        print(f"  [{i}] {t['company_name']} → {raw!r} → normalized: {domain}")

    print(f"\nTest complete — {len(targets)} rows. No writes made.")
    print("Run 'submit' to process all targets.")


# ─── ENTRY POINT ──────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("submit", "collect", "test"):
        print("Usage:")
        print("  python gemini_domain_lookup.py submit [--limit N]")
        print("  python gemini_domain_lookup.py collect")
        print("  python gemini_domain_lookup.py test [--limit N]")
        sys.exit(1)

    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY not set. Add to enrichment/.env or 04_BizDev_Bot/.env")
        sys.exit(1)

    client = genai.Client(api_key=GEMINI_API_KEY)
    creds  = get_credentials()
    service = build("sheets", "v4", credentials=creds)

    limit = None
    if "--limit" in args:
        idx = args.index("--limit")
        if idx + 1 < len(args):
            limit = int(args[idx + 1])

    cmd = args[0]
    if cmd == "submit":
        submit_batch(client, service, limit)
    elif cmd == "collect":
        collect_batch(client, service)
    elif cmd == "test":
        test_sequential(client, service, limit or 5)


if __name__ == "__main__":
    main()
