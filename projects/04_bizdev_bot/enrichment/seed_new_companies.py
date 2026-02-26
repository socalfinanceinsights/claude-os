"""seed_new_companies.py — @execution: one-time

Finds Company_Master candidates from HM_Person_Master, writes domain+name stubs
to Company_Master, and exports a CSV seeded for the enrichment pipeline.

Logic:
  1. Auth to Sheets API (same pattern as backfill_hm_domains.py)
  2. Read HM_Person_Master col A:F — collect rows with non-blank key, non-blank
     domain (col F), and non-junk company name (col E)
  3. Read Company_Master col A — build set of known domains
  4. Compute delta: HM domains not yet in Company_Master, deduped by domain
     (first company name wins)
  5. Write stubs (col A = domain, col B = company name) to Company_Master in a
     single batchUpdate call, with blank-only guard before writing
  6. Export CSV to tempFiles/Data Enrichment/New_Companies_2026-02-24.csv with
     enrichment pipeline headers
  7. Print summary
"""

import csv
import io
import json
import sys
from pathlib import Path

# Fix Windows cp1252 console encoding — must be at top before any print()
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT   = Path("C:/AG_Work/04_BizDev_Bot")
TOKEN_PATH     = PROJECT_ROOT / "token.json"

SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets"]

HM_PERSON_MASTER_SHEET = "HM_Person_Master"
COMPANY_MASTER_SHEET   = "Company_Master"

# HM_Person_Master column indices (0-based, col A:F)
PM_KEY_COL_IDX     = 0   # col A: Composite_Key
PM_COMPANY_COL_IDX = 4   # col E: Company name
PM_DOMAIN_COL_IDX  = 5   # col F: Company_Domain

# Company names that are not real companies — skip these HM rows
JUNK_VALUES = {"[none]", ".", "_", "8d6", "linkedin", "linkedin marketing automation"}

# Output CSV path
CSV_OUTPUT_PATH = PROJECT_ROOT / "tempFiles" / "Data Enrichment" / "New_Companies_2026-02-24.csv"

# Exact headers expected by enrich.py — do not change order or spelling
CSV_HEADERS = [
    "Company Domain",
    "Company",
    "HQ City",
    "HQ State",
    "HQ Country",
    "Company_Year_Founded",
    "Industry",
    "CompanySizeNorm",
    "CompanyRevenueNorm",
    "Sub-Industry",
    "Last Funding Type",
    "Last Funding Date",
    "Last Funding Amount",
    "Number of Funding Rounds",
    "Total Funding Amount",
    "Growth Stage",
]


# ── Authentication ────────────────────────────────────────────────────────────
def get_credentials() -> Credentials:
    """
    Load credentials from token.json.
    MCP token format uses 'token' instead of 'access_token' — normalise before
    constructing Credentials. Mirrors backfill_hm_domains.py exactly.
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


# ── Step 2: Read HM_Person_Master col A:F ────────────────────────────────────
def read_hm_person_master(service) -> tuple[list[tuple[str, str]], int, int]:
    """
    Read HM_Person_Master col A:F.
    Filters for rows where:
      - col A non-blank AND not startswith 'STUB_JUNK_COMPANY'
      - col F non-blank (has a domain)
      - col E non-blank AND lowercase strip not in JUNK_VALUES

    Returns:
        candidates      : list of (normalized_domain, company_name) tuples
        total_hm_rows   : total data rows read (col A non-blank)
        junk_skipped    : rows dropped due to junk/blank company name or blank domain
    """
    print(f"\nStep 2: Reading {HM_PERSON_MASTER_SHEET} col A:F...")

    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{HM_PERSON_MASTER_SHEET}!A:F",
        )
        .execute()
    )

    rows = resp.get("values", [])
    print(f"  Rows returned (including header): {len(rows)}")

    candidates: list[tuple[str, str]] = []
    total_hm_rows = 0
    junk_skipped  = 0

    # Row 0 is header — skip it
    for row in rows[1:]:
        # Pad to at least 6 cols so index access is safe
        while len(row) < 6:
            row.append("")

        key          = row[PM_KEY_COL_IDX].strip()
        company_name = row[PM_COMPANY_COL_IDX].strip()
        domain_raw   = row[PM_DOMAIN_COL_IDX].strip()

        # Must have a key and must not be a STUB_JUNK_COMPANY placeholder
        if not key:
            continue
        if key.startswith("STUB_JUNK_COMPANY"):
            continue

        total_hm_rows += 1

        # col F must be non-blank
        if not domain_raw:
            junk_skipped += 1
            continue

        # col E must be non-blank and not a junk value
        if not company_name or company_name.lower().strip() in JUNK_VALUES:
            junk_skipped += 1
            continue

        domain = domain_raw.lower()
        candidates.append((domain, company_name))

    print(f"  Data rows (col A non-blank, non-stub): {total_hm_rows}")
    print(f"  Rows with domain (col F non-blank):    {len(candidates) + junk_skipped - (total_hm_rows - len(candidates) - junk_skipped)}")
    return candidates, total_hm_rows, junk_skipped


# ── Step 3: Read Company_Master col A ────────────────────────────────────────
def read_company_master_domains(service) -> set[str]:
    """
    Read Company_Master col A.
    Returns set of existing domains (lowercase, stripped). Header row skipped.
    """
    print(f"\nStep 3: Reading {COMPANY_MASTER_SHEET} col A (existing domains)...")

    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{COMPANY_MASTER_SHEET}!A:A",
        )
        .execute()
    )

    rows = resp.get("values", [])
    # Skip header row (index 0)
    existing = {
        row[0].strip().lower()
        for row in rows[1:]
        if row and row[0].strip()
    }
    print(f"  Existing domains in Company_Master: {len(existing)}")
    return existing


# ── Step 4: Compute delta ─────────────────────────────────────────────────────
def compute_delta(
    candidates: list[tuple[str, str]],
    existing_domains: set[str],
) -> tuple[list[tuple[str, str]], int]:
    """
    Keep candidates where domain NOT in existing Company_Master.
    Dedupe by domain — first company name wins (dict insertion order preserved).

    Returns:
        delta           : ordered list of (domain, company_name) tuples
        already_exists  : count of candidates whose domain was already in Company_Master
    """
    print("\nStep 4: Computing delta...")

    seen: dict[str, str] = {}      # domain -> company_name, insertion-ordered
    already_exists = 0

    for domain, company_name in candidates:
        if domain in existing_domains:
            already_exists += 1
            continue
        # First occurrence of this domain wins
        if domain not in seen:
            seen[domain] = company_name

    delta = list(seen.items())
    print(f"  Already in Company_Master (skipped): {already_exists}")
    print(f"  New unique domains (delta):          {len(delta)}")
    return delta, already_exists


# ── Step 5: Find first empty row in Company_Master ───────────────────────────
def find_first_empty_row(service) -> int:
    """
    Scan Company_Master col A from top to find the first blank cell.
    Returns 1-based row number where new data should start.

    Per Law 1 (Engineering Laws): NEVER use getLastRow() equivalent (len(values)).
    Scan for first blank cell — rows may have formulas below data rows.
    """
    print(f"\nStep 5a: Scanning {COMPANY_MASTER_SHEET} col A for first empty row...")

    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{COMPANY_MASTER_SHEET}!A:A",
        )
        .execute()
    )

    rows = resp.get("values", [])

    # Find the first index (0-based) where the cell is blank or missing
    first_empty_idx = len(rows)  # default: append after all returned rows
    for idx, row in enumerate(rows):
        if not row or not row[0].strip():
            first_empty_idx = idx
            break

    # Convert to 1-based sheet row number
    first_empty_row = first_empty_idx + 1
    print(f"  First empty row (1-based): {first_empty_row}")
    return first_empty_row


# ── Step 5: Write stubs to Company_Master ────────────────────────────────────
def write_stubs(service, delta: list[tuple[str, str]], start_row: int) -> int:
    """
    Write all stubs in a single batchUpdate call.
    col A = domain, col B = company name.

    Blank-only guard: re-reads the target range before writing and aborts
    if any cell is non-blank.

    Returns count of stubs written (0 if guard fires or delta is empty).
    """
    if not delta:
        print("\nStep 5b: No stubs to write — skipping batchUpdate.")
        return 0

    end_row    = start_row + len(delta) - 1
    write_range = f"{COMPANY_MASTER_SHEET}!A{start_row}:B{end_row}"

    print(f"\nStep 5b: Blank-only guard — reading {write_range} before write...")

    try:
        guard_resp = (
            service.spreadsheets()
            .values()
            .get(
                spreadsheetId=SPREADSHEET_ID,
                range=write_range,
            )
            .execute()
        )
        guard_rows = guard_resp.get("values", [])
        if guard_rows:
            # Any non-empty cell in the target range — abort
            non_blank = [
                r for r in guard_rows
                if any(cell.strip() for cell in r if cell)
            ]
            if non_blank:
                print(f"  GUARD FIRED: {len(non_blank)} non-blank row(s) found in target range.")
                print("  Aborting write — investigate before re-running.")
                return 0
    except HttpError as e:
        if e.resp.status == 400 and "exceeds grid limits" in str(e):
            print(f"  Range beyond grid limits — rows don't exist yet, treating as blank. Safe to proceed.")
        else:
            raise

    print(f"  Guard passed — target range is blank. Writing {len(delta)} stubs...")

    values_list = [[domain, company_name] for domain, company_name in delta]

    result = (
        service.spreadsheets()
        .values()
        .append(
            spreadsheetId=SPREADSHEET_ID,
            range="Company_Master!A:B",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": values_list},
        )
        .execute()
    )

    rows_written = result.get("updates", {}).get("updatedRows", len(values_list))
    print(f"  append complete — rows written: {rows_written}")
    return len(values_list)


# ── Step 6: Export CSV ────────────────────────────────────────────────────────
def export_csv(delta: list[tuple[str, str]]) -> None:
    """
    Write delta rows to CSV with enrichment pipeline headers.
    Company Domain and Company are populated; all other fields are empty string.
    """
    print(f"\nStep 6: Exporting CSV to {CSV_OUTPUT_PATH}...")

    # Ensure output directory exists
    CSV_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(CSV_OUTPUT_PATH, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_HEADERS)
        writer.writeheader()
        for domain, company_name in delta:
            row = {h: "" for h in CSV_HEADERS}
            row["Company Domain"] = domain
            row["Company"]        = company_name
            writer.writerow(row)

    print(f"  CSV written — {len(delta)} rows.")


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> int:
    print("=" * 60)
    print("seed_new_companies.py")
    print("Seed Company_Master stubs from HM_Person_Master domains")
    print("=" * 60)

    # Step 1 — Auth
    print("\nStep 1: Authenticating...")
    creds   = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    print("  Authenticated OK")

    # Step 2 — Read HM_Person_Master
    candidates, total_hm_rows, junk_skipped = read_hm_person_master(service)
    hm_rows_with_domain = len(candidates)

    # Step 3 — Read Company_Master existing domains
    existing_domains = read_company_master_domains(service)

    # Step 4 — Compute delta
    delta, already_exists = compute_delta(candidates, existing_domains)

    # Step 5 — Write stubs
    start_row    = find_first_empty_row(service)
    stubs_written = write_stubs(service, delta, start_row)

    # Step 6 — Export CSV
    export_csv(delta)

    # Step 7 — Summary
    print("\n" + "=" * 60)
    print("SEED SUMMARY")
    print("=" * 60)
    print(f"  HM rows read:                    {total_hm_rows}")
    print(f"  HM rows with domain (col F):     {hm_rows_with_domain}")
    print(f"  Already in Company_Master:       {already_exists}")
    print(f"  Junk/blank company name skipped: {junk_skipped}")
    print(f"  New unique domains (delta):      {len(delta)}")
    print(f"  Stubs written to Company_Master: {stubs_written}")
    print(f"  CSV exported: enrichment\\New_Companies_2026-02-24.csv")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
