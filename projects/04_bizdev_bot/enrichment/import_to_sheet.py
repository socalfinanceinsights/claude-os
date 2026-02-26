"""
import_to_sheet.py
Wave 3 executor: Import normalized enrichment data from write_manifest.json into Company_Master sheet.

Execution mode: one-time
"""

import io
import json
import random
import sys
from pathlib import Path
from datetime import datetime, timezone

# Fix Windows cp1252 console encoding — use UTF-8 stdout/stderr
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path("C:/AG_Work/04_BizDev_Bot")
TOKEN_PATH   = PROJECT_ROOT / "token.json"
MANIFEST_PATH = PROJECT_ROOT / "enrichment" / "output" / "write_manifest.json"
REPORT_PATH   = PROJECT_ROOT / "enrichment" / "output" / "import_report.txt"

SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"
SHEET_NAME     = "Company_Master"
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets"]

BATCH_SIZE = 500  # max cell updates per batchUpdate call

# Field name → column letter mapping (confirmed from live headers 2026-02-19)
FIELD_TO_COL = {
    "Industry":                  "M",
    "Sub-Industry":              "N",
    "CompanySizeNorm":           "R",
    "CompanyRevenueNorm":        "S",
    "Last Funding Type":         "T",
    "Last Funding Date":         "U",
    "Last Funding Amount":       "V",
    "Number of Funding Rounds":  "W",
    "Total Funding Amount":      "X",
    "Growth Stage":              "Y",
}

# Column letter → 0-based index helper
def col_letter_to_index(letter: str) -> int:
    letter = letter.upper()
    result = 0
    for ch in letter:
        result = result * 26 + (ord(ch) - ord("A") + 1)
    return result - 1


# ── Authentication ────────────────────────────────────────────────────────────
def get_credentials() -> Credentials:
    """
    Load credentials from token.json.
    The MCP token format uses 'token' instead of 'access_token', so we
    load it manually and rename the key before constructing Credentials.
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
        # Persist refreshed token
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
def read_sheet(service) -> tuple[dict, dict]:
    """
    Returns:
        domain_to_row  : {lowercase_domain: 0-based_row_index}
        occupied_cells : {(row_index, col_letter): True}  — cells with existing data
    """
    print(f"\nStep 1: Reading sheet data from {SHEET_NAME}...")

    ranges = [
        f"{SHEET_NAME}!A:A",   # domain column
        f"{SHEET_NAME}!M:N",   # Industry + Sub-Industry
        f"{SHEET_NAME}!R:Y",   # CompanySizeNorm through Growth Stage
    ]

    resp = (
        service.spreadsheets()
        .values()
        .batchGet(spreadsheetId=SPREADSHEET_ID, ranges=ranges)
        .execute()
    )

    value_ranges = resp.get("valueRanges", [])

    # Parse column A → domain_to_row
    col_a_values = value_ranges[0].get("values", []) if value_ranges else []
    domain_to_row: dict[str, int] = {}
    for row_idx, row in enumerate(col_a_values):
        if row and row[0].strip():
            domain_to_row[row[0].strip().lower()] = row_idx

    print(f"  Rows with domains: {len(domain_to_row)}")

    # Parse occupied cells
    occupied_cells: dict[tuple, bool] = {}

    # Cols M–N (Industry + Sub-Industry)
    col_mn_values = value_ranges[1].get("values", []) if len(value_ranges) > 1 else []
    mn_cols = ["M", "N"]
    for row_idx, row in enumerate(col_mn_values):
        for col_offset, col_letter in enumerate(mn_cols):
            if col_offset < len(row) and row[col_offset].strip():
                occupied_cells[(row_idx, col_letter)] = True

    # Cols R–Y (indices 17–24)
    # batchGet returns R:Y as a grid; first cell in each row is col R
    col_ry_info = value_ranges[2] if len(value_ranges) > 2 else {}
    col_ry_values = col_ry_info.get("values", [])
    # Determine start column from the range metadata
    # "Company_Master!R1" → col R = index 17
    ry_cols = ["R", "S", "T", "U", "V", "W", "X", "Y"]
    for row_idx, row in enumerate(col_ry_values):
        for col_offset, col_letter in enumerate(ry_cols):
            if col_offset < len(row) and row[col_offset].strip():
                occupied_cells[(row_idx, col_letter)] = True

    print(f"  Occupied cells found: {len(occupied_cells)}")
    return domain_to_row, occupied_cells


# ── Step 2: Read manifest ─────────────────────────────────────────────────────
def read_manifest(path: Path = None) -> dict:
    resolved = path or MANIFEST_PATH
    print(f"\nStep 2: Reading manifest from {resolved.name}...")
    data = json.loads(resolved.read_text(encoding="utf-8"))
    domain_to_fields = data.get("domain_to_fields", {})
    print(f"  Domains in manifest: {len(domain_to_fields)}")
    return domain_to_fields


# ── Step 3: Compute diff ──────────────────────────────────────────────────────
def compute_diff(
    domain_to_fields: dict,
    domain_to_row: dict,
    occupied_cells: dict,
) -> tuple[list, list]:
    """
    Returns:
        writes       : list of (cell_ref, value, domain, field_name)
        unmatched    : list of domain strings not found in sheet
    """
    print("\nStep 3: Computing diff (blank cells only)...")

    writes: list[tuple[str, str, str, str]] = []
    unmatched: list[str] = []

    for domain, fields in domain_to_fields.items():
        domain_lower = domain.lower()
        row_idx = domain_to_row.get(domain_lower)

        if row_idx is None:
            unmatched.append(domain)
            continue

        # row_idx is 0-based; Sheets rows are 1-based
        sheet_row = row_idx + 1

        for field_name, value in fields.items():
            col_letter = FIELD_TO_COL.get(field_name)
            if col_letter is None:
                continue  # unmapped field — skip
            if not str(value).strip():
                continue  # blank manifest value — skip

            # Only write if sheet cell is currently empty
            if (row_idx, col_letter) not in occupied_cells:
                cell_ref = f"{col_letter}{sheet_row}"
                writes.append((cell_ref, str(value), domain, field_name))

    print(f"  Writes queued: {len(writes)}")
    print(f"  Unmatched domains: {len(unmatched)}")
    return writes, unmatched


# ── Step 4: Report ────────────────────────────────────────────────────────────
def print_report(writes: list, unmatched: list, domain_to_fields: dict, domain_to_row: dict):
    total_domains_in_manifest = len(domain_to_fields)
    matched = total_domains_in_manifest - len(unmatched)

    # Breakdown by field
    field_counts: dict[str, int] = {}
    for _, _, _, field_name in writes:
        field_counts[field_name] = field_counts.get(field_name, 0) + 1

    lines = [
        "=" * 60,
        "IMPORT REPORT",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "=" * 60,
        f"Domains in manifest : {total_domains_in_manifest}",
        f"Domains matched     : {matched}",
        f"Domains unmatched   : {len(unmatched)}",
        f"Total cells to write: {len(writes)}",
        "",
        "Breakdown by field:",
    ]
    for field, count in sorted(field_counts.items(), key=lambda x: -x[1]):
        col = FIELD_TO_COL.get(field, "?")
        lines.append(f"  {field:<30} col {col}  -> {count} cells")

    if unmatched[:10]:
        lines += ["", "Sample unmatched domains (up to 10):"]
        for d in unmatched[:10]:
            lines.append(f"  {d}")

    # Sample of 5 writes
    lines += ["", "Sample writes (5):"]
    sample = random.sample(writes, min(5, len(writes)))
    for cell_ref, value, domain, field_name in sample:
        lines.append(f"  {cell_ref}  {field_name:<30} = {value[:50]}   [{domain}]")

    report_text = "\n".join(lines)
    print("\n" + report_text)
    return report_text


# ── Step 5: Write to sheet ────────────────────────────────────────────────────
def write_to_sheet(service, writes: list) -> tuple[int, int, list]:
    """
    Returns:
        total_written : int
        batch_calls   : int
        errors        : list of error strings
    """
    if not writes:
        print("\nStep 5: Nothing to write.")
        return 0, 0, []

    print(f"\nStep 5: Writing {len(writes)} cells in batches of {BATCH_SIZE}...")

    total_written = 0
    batch_calls = 0
    errors = []

    # Chunk into batches
    for batch_start in range(0, len(writes), BATCH_SIZE):
        batch = writes[batch_start : batch_start + BATCH_SIZE]
        data = [
            {
                "range": f"{SHEET_NAME}!{cell_ref}",
                "values": [[value]],
            }
            for cell_ref, value, _, _ in batch
        ]

        try:
            resp = (
                service.spreadsheets()
                .values()
                .batchUpdate(
                    spreadsheetId=SPREADSHEET_ID,
                    body={
                        "valueInputOption": "RAW",
                        "data": data,
                    },
                )
                .execute()
            )
            batch_calls += 1
            updated = resp.get("totalUpdatedCells", len(batch))
            total_written += updated
            print(f"  Batch {batch_calls}: wrote {updated} cells (rows {batch_start+1}–{batch_start+len(batch)})")
        except Exception as exc:
            errors.append(f"Batch {batch_calls+1} failed: {exc}")
            print(f"  ERROR in batch {batch_calls+1}: {exc}", file=sys.stderr)

    print(f"  Total cells written: {total_written}")
    print(f"  batchUpdate calls  : {batch_calls}")
    if errors:
        print(f"  Errors             : {len(errors)}")
    return total_written, batch_calls, errors


# ── Step 6: Spot-check ────────────────────────────────────────────────────────
def spot_check(service, writes: list) -> list[str]:
    """Read back 5 random updated cells and verify values."""
    if not writes:
        return []

    print("\nStep 6: Spot-checking 5 random written cells...")
    sample = random.sample(writes, min(5, len(writes)))
    lines = []

    ranges = [f"{SHEET_NAME}!{cell_ref}" for cell_ref, _, _, _ in sample]
    try:
        resp = (
            service.spreadsheets()
            .values()
            .batchGet(spreadsheetId=SPREADSHEET_ID, ranges=ranges)
            .execute()
        )
        value_ranges = resp.get("valueRanges", [])
        for i, (cell_ref, expected_value, domain, field_name) in enumerate(sample):
            actual_rows = value_ranges[i].get("values", []) if i < len(value_ranges) else []
            actual = actual_rows[0][0] if actual_rows and actual_rows[0] else ""
            match = "OK" if actual == expected_value else "MISMATCH"
            line = f"  {match}  {cell_ref}  expected={expected_value[:40]}  actual={actual[:40]}  [{domain}]"
            lines.append(line)
            print(line)
    except Exception as exc:
        lines.append(f"  Spot-check failed: {exc}")
        print(f"  Spot-check error: {exc}", file=sys.stderr)

    return lines


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("import_to_sheet.py — Company_Master enrichment import")
    print("=" * 60)

    # Parse --source flag to override MANIFEST_PATH
    args = sys.argv[1:]
    manifest_path = MANIFEST_PATH
    if "--source" in args:
        idx = args.index("--source")
        if idx + 1 < len(args):
            manifest_path = Path(args[idx + 1])
            print(f"\n--source override: {manifest_path}")

    # Auth
    print("\nAuthenticating...")
    creds = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    print("  Authenticated OK")

    # Steps
    domain_to_row, occupied_cells = read_sheet(service)
    domain_to_fields = read_manifest(manifest_path)
    writes, unmatched = compute_diff(domain_to_fields, domain_to_row, occupied_cells)

    # Report (print + capture for file)
    report_text = print_report(writes, unmatched, domain_to_fields, domain_to_row)

    # Write
    total_written, batch_calls, errors = write_to_sheet(service, writes)

    # Spot-check
    spot_lines = spot_check(service, writes)

    # ── Final summary ──────────────────────────────────────────────────────
    summary_lines = [
        "",
        "=" * 60,
        "WRITE SUMMARY",
        "=" * 60,
        f"Cells written    : {total_written}",
        f"batchUpdate calls: {batch_calls}",
        f"Errors           : {len(errors)}",
        "",
        "Spot-check results:",
    ] + (spot_lines if spot_lines else ["  (nothing to check)"])

    if errors:
        summary_lines += ["", "Errors:"] + [f"  {e}" for e in errors]

    summary_text = "\n".join(summary_lines)
    print(summary_text)

    # ── Write report file ──────────────────────────────────────────────────
    full_report = report_text + "\n" + summary_text
    REPORT_PATH.write_text(full_report, encoding="utf-8")
    print(f"\nReport saved to: {REPORT_PATH}")

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
