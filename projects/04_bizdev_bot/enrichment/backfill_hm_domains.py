"""
backfill_hm_domains.py
Backfill Company_Domain (col F) in HM_Person_Master from HM_ContactInfo.

Execution mode: one-time
Logic:
  1. Auth to Sheets API (same pattern as import_to_sheet.py)
  2. Read HM_ContactInfo col A:D — build map: key -> first non-blank domain
  3. Read HM_Person_Master col A:F — identify rows where col F is blank
     but col A (Composite_Key) is non-blank
  4. For matching rows: fill col F from ContactInfo map (blank-only)
  5. Write all updates in ONE batchUpdate call (ValueInputOption=RAW)
  6. Print summary: rows checked, domains filled, already had domain, no match
"""

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


# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT   = Path("C:/AG_Work/04_BizDev_Bot")
TOKEN_PATH     = PROJECT_ROOT / "token.json"

SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets"]

# Sheet and column positions (1-based for Sheets API range notation)
HM_PERSON_MASTER_SHEET = "HM_Person_Master"
HM_CONTACT_INFO_SHEET  = "HM_ContactInfo"

# HM_Person_Master: col A = Composite_Key (index 0), col F = Company_Domain (index 5)
PM_KEY_COL_IDX    = 0   # col A
PM_DOMAIN_COL_IDX = 5   # col F
PM_DOMAIN_COL_LETTER = "F"

# HM_ContactInfo: col A = Composite_Key (index 0), col D = Company_Domain_at_Time (index 3)
CI_KEY_COL_IDX    = 0   # col A
CI_DOMAIN_COL_IDX = 3   # col D


# ── Authentication ────────────────────────────────────────────────────────────
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


# ── Step 1: Read HM_ContactInfo — build key -> domain map ────────────────────
def read_contact_info_map(service) -> dict[str, str]:
    """
    Read HM_ContactInfo col A:D.
    Returns: {composite_key: first_non_blank_domain}
    If a key appears multiple times, keeps the first non-blank domain seen.
    """
    print(f"\nStep 1: Reading {HM_CONTACT_INFO_SHEET} col A:D...")

    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{HM_CONTACT_INFO_SHEET}!A:D",
        )
        .execute()
    )

    rows = resp.get("values", [])
    print(f"  Rows returned (including header): {len(rows)}")

    key_to_domain: dict[str, str] = {}
    blank_domain_rows = 0

    # Row 0 is header — skip it
    for row_idx, row in enumerate(rows[1:], start=2):
        # Pad row to at least 4 cols so index access is safe
        while len(row) < 4:
            row.append("")

        key    = row[CI_KEY_COL_IDX].strip()
        domain = row[CI_DOMAIN_COL_IDX].strip()

        if not key:
            continue  # skip rows with no key

        if not domain:
            blank_domain_rows += 1
            continue  # no domain to record

        # Keep first non-blank domain per key
        if key not in key_to_domain:
            key_to_domain[key] = domain

    print(f"  Unique keys with a domain: {len(key_to_domain)}")
    print(f"  Rows skipped (blank domain): {blank_domain_rows}")
    return key_to_domain


# ── Step 2: Read HM_Person_Master col A:F ────────────────────────────────────
def read_person_master(service) -> list[dict]:
    """
    Read HM_Person_Master col A:F.
    Returns list of dicts for rows where col A is non-blank:
        {row_num, key, has_domain}
    row_num is 1-based (Sheets row number).
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

    person_rows = []

    # Row 0 is header — skip it; row_num starts at 2
    for row_idx, row in enumerate(rows[1:], start=2):
        # Pad to at least 6 cols
        while len(row) < 6:
            row.append("")

        key    = row[PM_KEY_COL_IDX].strip()
        domain = row[PM_DOMAIN_COL_IDX].strip()

        if not key:
            continue  # col A blank — not a data row (formula stub)

        person_rows.append({
            "row_num":    row_idx,
            "key":        key,
            "has_domain": bool(domain),
        })

    print(f"  Data rows (col A non-blank): {len(person_rows)}")
    return person_rows


# ── Step 3: Compute writes ────────────────────────────────────────────────────
def compute_writes(
    person_rows: list[dict],
    key_to_domain: dict[str, str],
) -> tuple[list[dict], int, int]:
    """
    For each person row where col F is blank, look up domain from ContactInfo map.
    Returns:
        writes          : list of {range, values} dicts ready for batchUpdate
        already_had     : count of rows that already had a domain
        no_match_count  : count of rows with blank domain but no ContactInfo match
    """
    print("\nStep 3: Computing writes...")

    writes: list[dict] = []
    already_had   = 0
    no_match_count = 0

    for row in person_rows:
        if row["has_domain"]:
            already_had += 1
            continue

        domain = key_to_domain.get(row["key"])
        if not domain:
            no_match_count += 1
            continue

        cell_ref = f"{HM_PERSON_MASTER_SHEET}!{PM_DOMAIN_COL_LETTER}{row['row_num']}"
        writes.append({
            "range":  cell_ref,
            "values": [[domain]],
        })

    print(f"  Rows already had domain : {already_had}")
    print(f"  Rows with no CI match   : {no_match_count}")
    print(f"  Writes queued           : {len(writes)}")
    return writes, already_had, no_match_count


# ── Step 4: Write to sheet ────────────────────────────────────────────────────
def write_domains(service, writes: list[dict]) -> int:
    """
    Single batchUpdate call — ValueInputOption=RAW.
    Returns total cells updated.
    """
    if not writes:
        print("\nStep 4: Nothing to write — skipping batchUpdate.")
        return 0

    print(f"\nStep 4: Writing {len(writes)} domains in a single batchUpdate call...")

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
    return total_updated


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> int:
    print("=" * 60)
    print("backfill_hm_domains.py — HM_Person_Master col F backfill")
    print("=" * 60)

    # Auth
    print("\nAuthenticating...")
    creds   = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    print("  Authenticated OK")

    # Read ContactInfo map
    key_to_domain = read_contact_info_map(service)

    # Read Person Master
    person_rows = read_person_master(service)

    rows_checked = len(person_rows)

    # Compute writes
    writes, already_had, no_match_count = compute_writes(person_rows, key_to_domain)

    domains_filled = len(writes)

    # Write
    cells_updated = write_domains(service, writes)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Rows checked (col A non-blank) : {rows_checked}")
    print(f"  Already had a domain           : {already_had}")
    print(f"  No ContactInfo match found     : {no_match_count}")
    print(f"  Domains filled (col F written) : {domains_filled}")
    print(f"  Cells confirmed updated        : {cells_updated}")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
