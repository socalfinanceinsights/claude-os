"""
backfill_domains_from_email.py
Backfill Company_Domain (col F) in HM_Person_Master by extracting domains
from work email addresses stored in HM_ContactInfo.

Execution mode: one-time

Logic:
  1. Auth to Sheets API (same pattern as backfill_hm_domains.py)
  2. Read ALL of HM_ContactInfo col A:C in one call
  3. Filter rows where Channel_Type is an email type (col B index 1)
  4. Extract domain from email address (col C index 2), skip personal domains
  5. Build map: composite_key -> first valid work domain found
  6. Read HM_Person_Master col A:F
  7. For rows where col F is blank AND key has a domain in the map: queue write
  8. Single batchUpdate write for all queued domains
  9. Print summary: rows checked, domains filled, already had domain, no email match

Column indices confirmed from 00_Brain_Config.gs CONFIG.contactInfoCols:
  - key          = 0  (col A: Composite_Key)
  - channelType  = 1  (col B: Channel_Type)
  - channelValue = 2  (col C: Channel_Value)
  - companyDomain= 3  (col D: Company_Domain_at_Time — not used in this script)

Channel_Type values that are email rows (from 02_Lusha_Import.gs):
  - 'Work Email'
  - 'Direct Email'
  - 'Additional Email'

CONFIG.hmPersonCols.domain = 5 (col F: Company_Domain)
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

# Sheet names (from CONFIG in 00_Brain_Config.gs)
HM_PERSON_MASTER_SHEET = "HM_Person_Master"
HM_CONTACT_INFO_SHEET  = "HM_ContactInfo"
COMPANY_MASTER_SHEET   = "Company_Master"

# HM_Person_Master column indices (0-based) — CONFIG.hmPersonCols
PM_KEY_COL_IDX       = 0   # col A: Composite_Key
PM_DOMAIN_COL_IDX    = 5   # col F: Company_Domain
PM_DOMAIN_COL_LETTER = "F"

# HM_ContactInfo column indices (0-based) — CONFIG.contactInfoCols
CI_KEY_COL_IDX         = 0   # col A: Composite_Key
CI_CHANNEL_TYPE_COL_IDX = 1  # col B: Channel_Type
CI_CHANNEL_VALUE_COL_IDX = 2 # col C: Channel_Value

# Email channel type values written by 02_Lusha_Import.gs and 99_ARCHIVED_Import.gs
EMAIL_CHANNEL_TYPES = {"work email", "direct email", "additional email"}

# Personal/free email domains to skip — these are not company domains
PERSONAL_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "me.com", "live.com", "msn.com", "aol.com",
}


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


# ── Step 1: Read HM_ContactInfo — build key -> domain map from emails ─────────
def read_email_domain_map(service) -> dict[str, str]:
    """
    Read HM_ContactInfo col A:C (key, channel_type, channel_value).
    Filter for email-type rows only.
    Extract domain from email address, skip personal domains.
    Returns: {composite_key: first_valid_work_domain_found}
    If a key has multiple email rows, keeps the first valid work domain seen.
    """
    print(f"\nStep 1: Reading {HM_CONTACT_INFO_SHEET} col A:C...")

    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{HM_CONTACT_INFO_SHEET}!A:C",
        )
        .execute()
    )

    rows = resp.get("values", [])
    print(f"  Rows returned (including header): {len(rows)}")

    key_to_domain: dict[str, str] = {}
    stats = {
        "non_email_rows": 0,
        "no_at_sign": 0,
        "personal_domain_skipped": 0,
        "valid_domains_found": 0,
        "already_have_key": 0,
    }

    # Row 0 is header — skip it
    for row in rows[1:]:
        # Pad row to at least 3 cols so index access is safe
        while len(row) < 3:
            row.append("")

        key          = row[CI_KEY_COL_IDX].strip()
        channel_type = row[CI_CHANNEL_TYPE_COL_IDX].strip().lower()
        channel_val  = row[CI_CHANNEL_VALUE_COL_IDX].strip()

        if not key:
            continue  # skip rows with no key

        # Filter: only process email-type rows
        if channel_type not in EMAIL_CHANNEL_TYPES:
            stats["non_email_rows"] += 1
            continue

        # Must contain @ to be a valid email
        if "@" not in channel_val:
            stats["no_at_sign"] += 1
            continue

        # Extract domain: everything after @, lowercased and stripped
        domain = channel_val.split("@", 1)[1].lower().strip()

        # Skip personal/free email domains
        if domain in PERSONAL_DOMAINS:
            stats["personal_domain_skipped"] += 1
            continue

        # Skip empty domain (malformed email)
        if not domain:
            continue

        stats["valid_domains_found"] += 1

        # Keep first valid work domain per key
        if key not in key_to_domain:
            key_to_domain[key] = domain
        else:
            stats["already_have_key"] += 1

    print(f"  Non-email rows skipped          : {stats['non_email_rows']}")
    print(f"  Email rows with no @ sign       : {stats['no_at_sign']}")
    print(f"  Personal domain rows skipped    : {stats['personal_domain_skipped']}")
    print(f"  Valid work domain rows found    : {stats['valid_domains_found']}")
    print(f"  Unique keys with a work domain  : {len(key_to_domain)}")
    return key_to_domain


# ── Step 2: Read Company_Master col A — build known domain set ────────────────
def read_company_domains(service) -> set:
    """
    Read Company_Master col A (root domains).
    Returns a set of known domains. Email-extracted domains are only written
    to HM_Person_Master if they exist here — ensures domain matches a real company.
    """
    print(f"\nStep 2: Reading {COMPANY_MASTER_SHEET} col A (known domains)...")

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
    domains = {row[0].strip().lower() for row in rows[1:] if row and row[0].strip()}
    print(f"  Known company domains loaded: {len(domains)}")
    return domains


# ── Step 3: Read HM_Person_Master col A:F ─────────────────────────────────────
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
    company_domains: set,
) -> tuple[list[dict], int, int, int]:
    """
    For each person row where col F is blank, look up domain from email map.
    Only writes domain if it exists in Company_Master — validates company match.
    Returns:
        writes             : list of {range, values} dicts ready for batchUpdate
        already_had        : count of rows that already had a domain
        no_match_count     : count of rows with blank domain but no email match
        not_in_company_master : count of email domains not in Company_Master
    """
    print("\nStep 4: Computing writes...")

    writes: list[dict] = []
    already_had           = 0
    no_match_count        = 0
    not_in_company_master = 0

    for row in person_rows:
        if row["has_domain"]:
            already_had += 1
            continue

        domain = key_to_domain.get(row["key"])
        if not domain:
            no_match_count += 1
            continue

        # Only write if this domain is a known company in Company_Master
        if domain not in company_domains:
            not_in_company_master += 1
            continue

        cell_ref = f"{HM_PERSON_MASTER_SHEET}!{PM_DOMAIN_COL_LETTER}{row['row_num']}"
        writes.append({
            "range":  cell_ref,
            "values": [[domain]],
        })

    print(f"  Rows already had domain        : {already_had}")
    print(f"  Rows with no email match       : {no_match_count}")
    print(f"  Email domain not in Co. Master : {not_in_company_master}")
    print(f"  Writes queued                  : {len(writes)}")
    return writes, already_had, no_match_count, not_in_company_master


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
    print("backfill_domains_from_email.py")
    print("Backfill HM_Person_Master col F from email domains in HM_ContactInfo")
    print("=" * 60)

    # Auth
    print("\nAuthenticating...")
    creds   = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    print("  Authenticated OK")

    # Read ContactInfo — build key -> domain map from email addresses
    key_to_domain = read_email_domain_map(service)

    # Read Company_Master — build known domain set for validation
    company_domains = read_company_domains(service)

    # Read Person Master
    person_rows = read_person_master(service)

    rows_checked = len(person_rows)

    # Compute writes — only domains that exist in Company_Master
    writes, already_had, no_match_count, not_in_cm = compute_writes(
        person_rows, key_to_domain, company_domains
    )

    domains_filled = len(writes)

    # Write
    cells_updated = write_domains(service, writes)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Rows checked (col A non-blank) : {rows_checked}")
    print(f"  Already had a domain           : {already_had}")
    print(f"  No email match found           : {no_match_count}")
    print(f"  Email domain not in Co. Master : {not_in_cm}")
    print(f"  Domains filled (col F written) : {domains_filled}")
    print(f"  Cells confirmed updated        : {cells_updated}")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
