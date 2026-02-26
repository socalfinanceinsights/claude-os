"""
gemini_industry_classify.py
Classify remaining blank Industry (col M) values in Company_Master using Gemini Flash.

Reads: columns A (domain), B (company name), C (description), M (industry), N (sub-industry)
Writes: column M with classified industry string

Execution mode: one-time
"""

import csv
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Fix Windows cp1252 console encoding — UTF-8 stdout/stderr
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from dotenv import load_dotenv
from google import genai
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT   = Path("C:/AG_Work/04_BizDev_Bot")
TOKEN_PATH     = PROJECT_ROOT / "token.json"
OUTPUT_DIR     = PROJECT_ROOT / "enrichment" / "output"
REPORT_PATH    = OUTPUT_DIR / "gemini_industry_report.txt"
CSV_PATH       = OUTPUT_DIR / "gemini_industry_classifications.csv"

SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"
SHEET_NAME     = "Company_Master"
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets"]

GEMINI_MODEL   = "gemini-2.5-flash"
BATCH_SIZE     = 20      # rows per Gemini API call
WRITE_BATCH    = 500     # max cell updates per batchUpdate call
INTER_BATCH_DELAY = 1.0  # seconds between Gemini API calls

# Canonical industry labels (indexed 1-19, position = number)
INDUSTRY_LABELS = [
    None,  # 0 — unused (1-based)
    "Technology & Software",
    "Biotech & Life Sciences",
    "Aerospace & Defense",
    "Manufacturing & Industrial",
    "Consumer Packaged Goods (Food & Cosmetic)",
    "Consumer Goods (Apparel, Electronics)",
    "Real Estate Dev. & Construction",
    "E-commerce Businesses",
    "Healthcare Services & Hospitals",
    "Real Estate Management (REITs)",
    "Real Estate Tech & PropTech",
    "Logistics & Supply Chain",
    "Professional Services (legal, consulting, etc.)",
    "Wholesale Trade",
    "Financial Services & Insurance",
    "Transportation & Logistics (beyond 3PL)",
    "Retail Trade (brick-and-mortar)",
    "Leisure & Hospitality",
    "Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)",
]

CLASSIFICATION_PROMPT_HEADER = """\
You are classifying companies into exactly one of these 19 industry categories:

1. Technology & Software
2. Biotech & Life Sciences
3. Aerospace & Defense
4. Manufacturing & Industrial
5. Consumer Packaged Goods (Food & Cosmetic)
6. Consumer Goods (Apparel, Electronics)
7. Real Estate Dev. & Construction
8. E-commerce Businesses
9. Healthcare Services & Hospitals
10. Real Estate Management (REITs)
11. Real Estate Tech & PropTech
12. Logistics & Supply Chain
13. Professional Services (legal, consulting, etc.)
14. Wholesale Trade
15. Financial Services & Insurance
16. Transportation & Logistics (beyond 3PL)
17. Retail Trade (brick-and-mortar)
18. Leisure & Hospitality
19. Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)

For each company below, respond with ONLY the number (1-19). One number per line, in order. No extra text, no labels, just the number.

Companies:
"""

# Column indices (0-based)
COL_DOMAIN      = 0   # A
COL_COMPANY     = 1   # B
COL_DESC        = 2   # C
COL_INDUSTRY    = 12  # M
COL_SUBINDUSTRY = 13  # N


# ── Sheets Auth ───────────────────────────────────────────────────────────────
def get_credentials() -> Credentials:
    raw = json.loads(TOKEN_PATH.read_text(encoding="utf-8"))
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


# ── Step 1: Read sheet data ───────────────────────────────────────────────────
def read_sheet(service):
    """
    Returns list of dicts, one per data row (skipping header row 0):
      {
        sheet_row   : int (1-based Sheets row number),
        row_index   : int (0-based grid index),
        domain      : str,
        company     : str,
        description : str,
        industry    : str,
        subindustry : str,
      }
    """
    print(f"\nStep 1: Reading {SHEET_NAME} columns A, B, C, M, N...")
    resp = (
        service.spreadsheets()
        .values()
        .batchGet(
            spreadsheetId=SPREADSHEET_ID,
            ranges=[
                f"{SHEET_NAME}!A:A",
                f"{SHEET_NAME}!B:B",
                f"{SHEET_NAME}!C:C",
                f"{SHEET_NAME}!M:M",
                f"{SHEET_NAME}!N:N",
            ],
        )
        .execute()
    )

    vr = resp.get("valueRanges", [])

    def col_values(idx):
        if idx < len(vr):
            return [row[0] if row else "" for row in vr[idx].get("values", [])]
        return []

    col_a = col_values(0)   # domain
    col_b = col_values(1)   # company
    col_c = col_values(2)   # description
    col_m = col_values(3)   # industry
    col_n = col_values(4)   # subindustry

    # Pad all columns to the same length
    max_len = max(len(col_a), len(col_b), len(col_c), len(col_m), len(col_n))
    def pad(lst): return lst + [""] * (max_len - len(lst))
    col_a, col_b, col_c, col_m, col_n = map(pad, [col_a, col_b, col_c, col_m, col_n])

    rows = []
    for i in range(1, max_len):   # skip row 0 (header)
        rows.append({
            "sheet_row":   i + 1,   # 1-based: header is row 1, first data is row 2
            "row_index":   i,
            "domain":      col_a[i].strip(),
            "company":     col_b[i].strip(),
            "description": col_c[i].strip(),
            "industry":    col_m[i].strip(),
            "subindustry": col_n[i].strip(),
        })

    total = len(rows)
    blank_m = sum(1 for r in rows if not r["industry"])
    print(f"  Total data rows : {total}")
    print(f"  Blank Industry  : {blank_m}")
    return rows


# ── Step 2: Build work list ───────────────────────────────────────────────────
def build_work_list(rows):
    """
    Returns (work_items, skipped_count):
      work_items: list of dicts with 'input_text' added
      skipped_count: rows with no usable input
    """
    work_items = []
    skipped = []

    for row in rows:
        if row["industry"]:
            continue   # already classified

        company = row["company"]
        sub     = row["subindustry"]
        desc    = row["description"]

        if sub:
            input_text = f"{company} | {sub}"
        elif desc:
            input_text = f"{company} | {desc[:200]}"
        elif company:
            # Company name only — include it so Gemini can try
            input_text = company
        else:
            skipped.append(row)
            print(f"  SKIP row {row['sheet_row']}: no company name, sub-industry, or description")
            continue

        work_items.append({**row, "input_text": input_text})

    return work_items, skipped


# ── Step 3: Gemini classification ─────────────────────────────────────────────
def call_gemini_batch(client, batch_items):
    """
    Send a batch of up to BATCH_SIZE items to Gemini Flash.
    Returns list of (canonical_industry_or_None, raw_response_token) per item.
    None = parse error.
    """
    numbered_lines = []
    for i, item in enumerate(batch_items, start=1):
        numbered_lines.append(f"{i}. {item['input_text']}")

    prompt = CLASSIFICATION_PROMPT_HEADER + "\n".join(numbered_lines)

    for attempt in range(4):   # 0, 1, 2, 3
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
            )
            raw_text = response.text.strip()
            return parse_gemini_response(raw_text, len(batch_items))
        except Exception as exc:
            err = str(exc)
            if "429" in err and attempt < 3:
                wait = 15 * (2 ** attempt)   # 15s, 30s, 60s
                print(f"\n  RATE LIMIT — waiting {wait}s (attempt {attempt + 1}/3)...", flush=True)
                time.sleep(wait)
                continue
            print(f"\n  ERROR calling Gemini: {err[:120]}", file=sys.stderr)
            return [None] * len(batch_items)

    return [None] * len(batch_items)


def parse_gemini_response(raw_text, expected_count):
    """
    Parse Gemini response: one number per line.
    Returns list of canonical industry strings (or None for parse errors).
    Length matches expected_count.
    """
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    results = []

    for line in lines:
        # Strip any leading "N." or "N)" prefixes Gemini might add
        import re
        match = re.search(r"\b(\d+)\b", line)
        if match:
            num = int(match.group(1))
            if 1 <= num <= 19:
                results.append(INDUSTRY_LABELS[num])
            else:
                results.append(None)
        else:
            results.append(None)

    # Pad or truncate to expected length
    while len(results) < expected_count:
        results.append(None)
    return results[:expected_count]


def classify_all(client, work_items):
    """
    Run all work_items through Gemini in batches of BATCH_SIZE.
    Returns list of (item, classified_industry_or_None).
    """
    classified = []
    total = len(work_items)
    batch_num = 0

    for start in range(0, total, BATCH_SIZE):
        batch = work_items[start : start + BATCH_SIZE]
        batch_num += 1
        end = min(start + BATCH_SIZE, total)
        print(f"  Batch {batch_num}: rows {start + 1}–{end} of {total}...", end=" ", flush=True)

        results = call_gemini_batch(client, batch)

        batch_ok = sum(1 for r in results if r is not None)
        batch_err = len(results) - batch_ok
        print(f"OK={batch_ok} ParseErr={batch_err}")

        for item, industry in zip(batch, results):
            classified.append((item, industry))

        if start + BATCH_SIZE < total:
            time.sleep(INTER_BATCH_DELAY)

    return classified


# ── Step 4: Write results to sheet ────────────────────────────────────────────
def write_to_sheet(service, classified):
    """
    Write classified industry values to column M.
    Only writes rows where classification succeeded (not None).
    """
    writes = []
    for item, industry in classified:
        if industry is None:
            continue
        sheet_row = item["sheet_row"]
        writes.append({
            "range": f"{SHEET_NAME}!M{sheet_row}",
            "values": [[industry]],
        })

    if not writes:
        print("\nStep 4: Nothing to write.")
        return 0

    print(f"\nStep 4: Writing {len(writes)} classifications to col M...")
    total_written = 0

    for batch_start in range(0, len(writes), WRITE_BATCH):
        batch = writes[batch_start : batch_start + WRITE_BATCH]
        resp = (
            service.spreadsheets()
            .values()
            .batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body={"valueInputOption": "RAW", "data": batch},
            )
            .execute()
        )
        written = resp.get("totalUpdatedCells", len(batch))
        total_written += written
        print(f"  Wrote batch: {written} cells")

    print(f"  Total written: {total_written}")
    return total_written


# ── Step 5: Reports ───────────────────────────────────────────────────────────
def generate_reports(rows, work_items, classified, skipped):
    total_blank      = len(work_items) + len(skipped)
    still_blank_no_input = len(skipped)
    successful       = sum(1 for _, ind in classified if ind is not None)
    parse_errors     = sum(1 for _, ind in classified if ind is None)

    # Industry breakdown
    breakdown = {}
    for _, industry in classified:
        if industry:
            breakdown[industry] = breakdown.get(industry, 0) + 1

    lines = [
        "=" * 65,
        "GEMINI INDUSTRY CLASSIFICATION REPORT",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        f"Model: {GEMINI_MODEL}",
        "=" * 65,
        f"Total rows needing classification : {total_blank}",
        f"Successfully classified           : {successful}",
        f"Parse errors (skipped)            : {parse_errors}",
        f"Still blank (no input data)       : {still_blank_no_input}",
        "",
        "Breakdown by industry:",
    ]
    for ind, count in sorted(breakdown.items(), key=lambda x: -x[1]):
        lines.append(f"  {count:>4}  {ind}")

    report_text = "\n".join(lines)
    print("\n" + report_text)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report_text, encoding="utf-8")
    print(f"\nReport saved: {REPORT_PATH}")

    # CSV audit file
    csv_rows = []
    for item, industry in classified:
        csv_rows.append({
            "row_number":          item["sheet_row"],
            "domain":              item["domain"],
            "company_name":        item["company"],
            "input_text":          item["input_text"],
            "classified_industry": industry if industry else "PARSE_ERROR",
        })

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["row_number", "domain", "company_name", "input_text", "classified_industry"],
        )
        writer.writeheader()
        writer.writerows(csv_rows)
    print(f"CSV audit saved: {CSV_PATH}")

    return successful, parse_errors


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 65)
    print("gemini_industry_classify.py — Company_Master Industry Fill")
    print("=" * 65)

    # Load Gemini API key
    load_dotenv(PROJECT_ROOT / ".env")
    load_dotenv(PROJECT_ROOT / "enrichment" / ".env")
    load_dotenv(Path("C:/AG_Work/05_Candidate_Master/pipeline/.env"))
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found in .env files.", file=sys.stderr)
        sys.exit(1)
    print(f"  GEMINI_API_KEY loaded (ends ...{api_key[-6:]})")

    # Auth
    print("\nAuthenticating with Sheets API...")
    creds   = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    print("  Sheets API authenticated OK")

    # Gemini client
    client = genai.Client(api_key=api_key)
    print(f"  Gemini client ready ({GEMINI_MODEL})")

    # Step 1
    rows = read_sheet(service)

    # Step 2
    print("\nStep 2: Building work list...")
    work_items, skipped = build_work_list(rows)
    print(f"  Work items (have input)  : {len(work_items)}")
    print(f"  Skipped (no input at all): {len(skipped)}")

    if not work_items:
        print("\nNothing to classify. All Industry values are already filled.")
        return 0

    # Preview sample
    print("\n  Sample work items (5):")
    for item in work_items[:5]:
        print(f"    Row {item['sheet_row']:>4}  {item['company'][:35]:<35}  |  {item['input_text'][:60]}")

    # Step 3
    print(f"\nStep 3: Classifying {len(work_items)} rows via Gemini Flash "
          f"({(len(work_items) + BATCH_SIZE - 1) // BATCH_SIZE} batches)...")
    classified = classify_all(client, work_items)

    # Step 4
    total_written = write_to_sheet(service, classified)

    # Step 5
    print("\nStep 5: Generating reports...")
    successful, parse_errors = generate_reports(rows, work_items, classified, skipped)

    print("\n" + "=" * 65)
    print("DONE")
    print(f"  Classified and written : {total_written}")
    print(f"  Parse errors           : {parse_errors}")
    print(f"  Skipped (no input)     : {len(skipped)}")
    print("=" * 65)

    return 0


if __name__ == "__main__":
    sys.exit(main())
