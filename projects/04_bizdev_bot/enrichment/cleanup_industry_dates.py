"""
cleanup_industry_dates.py
4-pass cleanup on Company_Master sheet:
  Pass 1 — Normalize non-canonical Industry values (col M)
  Pass 2 — Fill blank Industry from Sub-Industry (col N)
  Pass 3 — Normalize Last Funding Date to YYYY-MM-DD (col U)
  Pass 4 — Write ARRAYFORMULA for Months_Since_Funding (col Z)

Execution mode: one-time
"""

import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Fix Windows cp1252 console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT   = Path("C:/AG_Work/04_BizDev_Bot")
TOKEN_PATH     = PROJECT_ROOT / "token.json"
REPORT_PATH    = PROJECT_ROOT / "enrichment" / "output" / "industry_date_cleanup_report.txt"

SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"
SHEET_NAME     = "Company_Master"
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets"]

BATCH_SIZE = 500

# ── Canonical industry values ─────────────────────────────────────────────────
CANONICAL_INDUSTRIES = {
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
}

# Exact-match overrides (checked before prefix map)
INDUSTRY_MAP = {
    "Aerospace":                  "Aerospace & Defense",
    "Biopharma":                  "Biotech & Life Sciences",
    "Biotech":                    "Biotech & Life Sciences",
    "Semiconductors":             "Technology & Software",
    "Insurance":                  "Financial Services & Insurance",
    "Telecommunications":         "Technology & Software",
    "Medical Diagnostics":        "Biotech & Life Sciences",
    "Medical Devices":            "Biotech & Life Sciences",
    "Professional Association":   "Professional Services (legal, consulting, etc.)",
    "Life Sciences":              "Biotech & Life Sciences",
    "Advanced Materials":         "Manufacturing & Industrial",
    "Electric Marine":            "Manufacturing & Industrial",
}

# Prefix map — checked in order, first match wins
# Keys are prefixes; values are canonical strings
PREFIX_MAP_ORDERED = [
    ("Software",                  "Technology & Software"),
    ("AI ",                       "Technology & Software"),
    ("HR Tech",                   "Technology & Software"),
    ("LegalTech",                 "Technology & Software"),
    ("EduTech",                   "Technology & Software"),
    ("FinTech",                   "Technology & Software"),
    ("AdTech",                    "Technology & Software"),
    ("Sustainability",            "Technology & Software"),
    ("Sports Tech",               "Technology & Software"),
    ("IoT",                       "Technology & Software"),

    ("Bioanalytical",             "Biotech & Life Sciences"),
    ("Biopharma",                 "Biotech & Life Sciences"),
    ("Life Sciences",             "Biotech & Life Sciences"),
    ("Medical Tech",              "Biotech & Life Sciences"),
    ("Medical Devices",           "Biotech & Life Sciences"),
    ("Medical Accessories",       "Biotech & Life Sciences"),
    ("HealthTech",                "Biotech & Life Sciences"),
    ("Biotech",                   "Biotech & Life Sciences"),

    ("Aerospace",                 "Aerospace & Defense"),
    ("Space Tech",                "Aerospace & Defense"),
    ("Defense Tech",              "Aerospace & Defense"),
    ("Defense/",                  "Aerospace & Defense"),
    ("Defense ",                  "Aerospace & Defense"),

    ("Healthcare",                "Healthcare Services & Hospitals"),

    ("Robotics",                  "Manufacturing & Industrial"),
    ("Manufacturing",             "Manufacturing & Industrial"),

    ("FoodTech",                  "Consumer Packaged Goods (Food & Cosmetic)"),
    ("Food",                      "Consumer Packaged Goods (Food & Cosmetic)"),
    ("Health (Supplements)",      "Consumer Packaged Goods (Food & Cosmetic)"),

    ("Cannabis (Consumer",        "Consumer Goods (Apparel, Electronics)"),
    ("Consumer Goods",            "Consumer Goods (Apparel, Electronics)"),
    ("Consumer Services",         "Consumer Goods (Apparel, Electronics)"),
    ("Clothing",                  "Consumer Goods (Apparel, Electronics)"),
    ("Beauty",                    "Consumer Goods (Apparel, Electronics)"),
    ("Fashion",                   "Consumer Goods (Apparel, Electronics)"),
    ("Sports Equipment",          "Consumer Goods (Apparel, Electronics)"),

    ("Real Estate (REIT)",        "Real Estate Management (REITs)"),
    ("Real Estate Tech",          "Real Estate Tech & PropTech"),
    ("Real Estate Data",          "Real Estate Tech & PropTech"),
    ("Fintech (Real Estate)",     "Real Estate Tech & PropTech"),
    ("Real Estate Dev",           "Real Estate Dev. & Construction"),
    ("Real Estate",               "Real Estate Dev. & Construction"),

    ("Food Logistics",            "Logistics & Supply Chain"),
    ("Logistics",                 "Logistics & Supply Chain"),

    ("Wholesale",                 "Wholesale Trade"),

    ("Venture Capital",           "Financial Services & Insurance"),
    ("Finance",                   "Financial Services & Insurance"),

    ("Retail Tech",               "Technology & Software"),
    ("Retail (",                  "Retail Trade (brick-and-mortar)"),

    ("Media",                     "Leisure & Hospitality"),
    ("Events",                    "Leisure & Hospitality"),
    ("Tourism",                   "Leisure & Hospitality"),

    ("Education",                 "Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)"),
    ("Non-Profit",                "Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)"),
    ("Non-profit",                "Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)"),
    ("Research (Academic)",       "Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)"),
    ("Research (Public",          "Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)"),
    ("Agriculture",               "Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)"),

    # Lower-priority generics — after specifics above
    ("Research",                  "Biotech & Life Sciences"),
    ("Engineering",               "Manufacturing & Industrial"),
    ("Accounting",                "Professional Services (legal, consulting, etc.)"),
    ("Professional Services",     "Professional Services (legal, consulting, etc.)"),
    ("Technology",                "Technology & Software"),

    ("Cannabis",                  "Consumer Packaged Goods (Food & Cosmetic)"),

    ("Identity",                  "Technology & Software"),
    ("Electronics",               "Technology & Software"),
    ("EV Charging",               "Technology & Software"),
    ("Automotive",                "Manufacturing & Industrial"),
]


def map_industry(value: str) -> tuple[str | None, str]:
    """
    Returns (canonical_value, method) or (None, "unmapped").
    method is one of: "exact_canonical", "industry_map", "prefix_map", "unmapped"
    """
    if not value or not value.strip():
        return None, "empty"

    v = value.strip()

    # Already canonical
    if v in CANONICAL_INDUSTRIES:
        return v, "exact_canonical"

    # Exact override map
    if v in INDUSTRY_MAP:
        return INDUSTRY_MAP[v], "industry_map"

    # Prefix map — first match wins
    for prefix, canonical in PREFIX_MAP_ORDERED:
        if v.startswith(prefix):
            return canonical, "prefix_map"

    return None, "unmapped"


# ── Date normalisation ─────────────────────────────────────────────────────────
def normalize_date(raw: str) -> tuple[str | None, str]:
    """
    Returns (normalized_date_str, action) where action describes what happened.
    Returns (None, "empty") for blank input.
    Returns (raw, "unchanged") if already ISO YYYY-MM-DD and valid.
    """
    if not raw or not raw.strip():
        return None, "empty"

    v = raw.strip()

    # Already YYYY-MM-DD — validate and fix day=00
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        parts = v.split("-")
        year, month, day = parts[0], parts[1], parts[2]
        # Fix day = 00
        if day == "00":
            fixed = f"{year}-{month}-01"
            return fixed, f"fixed_day_00 -> {fixed}"
        return v, "unchanged"

    # YYYY-MM (year-month only) → pad to first of month
    if re.fullmatch(r"\d{4}-\d{2}", v):
        padded = v + "-01"
        return padded, f"padded_ym -> {padded}"

    # YYYY only → pad to Jan 1
    if re.fullmatch(r"\d{4}", v):
        padded = v + "-01-01"
        return padded, f"padded_y -> {padded}"

    # US format MM/DD/YYYY
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", v)
    if m:
        month_n, day_n, year_n = m.group(1), m.group(2), m.group(3)
        converted = f"{year_n}-{int(month_n):02d}-{int(day_n):02d}"
        return converted, f"us_format -> {converted}"

    # Unrecognised
    return None, f"unrecognised_format: {v!r}"


# ── Authentication ─────────────────────────────────────────────────────────────
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


# ── Sheet helpers ──────────────────────────────────────────────────────────────
def col_letter_to_index(letter: str) -> int:
    letter = letter.upper()
    result = 0
    for ch in letter:
        result = result * 26 + (ord(ch) - ord("A") + 1)
    return result - 1


def batch_write_values(service, updates: list[tuple[str, str]]) -> int:
    """
    updates: list of (cell_ref, value) e.g. ("M5", "Technology & Software")
    Returns total cells written.
    """
    if not updates:
        return 0

    total = 0
    for batch_start in range(0, len(updates), BATCH_SIZE):
        batch = updates[batch_start: batch_start + BATCH_SIZE]
        data = [
            {
                "range": f"{SHEET_NAME}!{cell_ref}",
                "values": [[value]],
            }
            for cell_ref, value in batch
        ]
        resp = (
            service.spreadsheets()
            .values()
            .batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body={"valueInputOption": "RAW", "data": data},
            )
            .execute()
        )
        total += resp.get("totalUpdatedCells", len(batch))
        print(f"  Wrote batch rows {batch_start+1}–{batch_start+len(batch)}: {resp.get('totalUpdatedCells', len(batch))} cells")

    return total


def get_sheet_id(service) -> int:
    """Return the sheetId (integer) for SHEET_NAME."""
    meta = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    for sheet in meta.get("sheets", []):
        props = sheet.get("properties", {})
        if props.get("title") == SHEET_NAME:
            return props["sheetId"]
    raise ValueError(f"Sheet '{SHEET_NAME}' not found in spreadsheet")


# ── Pass 1 + 2: read columns M and N ──────────────────────────────────────────
def read_industry_columns(service) -> tuple[list, list]:
    """Returns (col_m_values, col_n_values) — both as flat lists (row 0 = header)."""
    print("\nReading columns M and N...")
    resp = (
        service.spreadsheets()
        .values()
        .batchGet(
            spreadsheetId=SPREADSHEET_ID,
            ranges=[f"{SHEET_NAME}!M:M", f"{SHEET_NAME}!N:N"],
        )
        .execute()
    )
    vr = resp.get("valueRanges", [])

    def extract_col(vr_entry):
        rows = vr_entry.get("values", []) if vr_entry else []
        return [r[0] if r else "" for r in rows]

    col_m = extract_col(vr[0] if len(vr) > 0 else {})
    col_n = extract_col(vr[1] if len(vr) > 1 else {})
    print(f"  M rows: {len(col_m)}, N rows: {len(col_n)}")
    return col_m, col_n


# ── Pass 3: read column U ──────────────────────────────────────────────────────
def read_date_column(service) -> list:
    """Returns col_u_values as flat list (row 0 = header)."""
    print("\nReading column U...")
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=f"{SHEET_NAME}!U:U")
        .execute()
    )
    rows = resp.get("values", [])
    col_u = [r[0] if r else "" for r in rows]
    print(f"  U rows: {len(col_u)}")
    return col_u


# ── Pass 4: clear Z3:Z2800 via batchUpdate then write formula to Z2 ───────────
def write_months_formula(service, sheet_id: int) -> None:
    """
    1. Clear Z3:Z2800 (rows 3–2800, 0-based rows 2–2799, col Z index 25)
       using updateCells with fields='userEnteredValue' and no rows data.
    2. Write ARRAYFORMULA to Z2 via values API with USER_ENTERED.
    """
    print("\nPass 4: Writing Months_Since_Funding ARRAYFORMULA to Z2...")

    # Step 1: Clear Z3:Z2800 via batchUpdate
    # Row 0-based: row 2 = sheet row 3; row 2799 = sheet row 2800
    # Column Z = index 25
    print("  Clearing Z3:Z2800...")
    clear_request = {
        "updateCells": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": 2,      # row 3 (0-based)
                "endRowIndex": 2800,     # exclusive → up to row 2800
                "startColumnIndex": 25,  # col Z
                "endColumnIndex": 26,
            },
            "fields": "userEnteredValue",
            # No 'rows' key → clears the range
        }
    }
    service.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": [clear_request]},
    ).execute()
    print("  Z3:Z2800 cleared.")

    # Step 2: Write ARRAYFORMULA to Z2
    formula = '=ARRAYFORMULA(IF(U2:U="","",IFERROR(DATEDIF(DATEVALUE(U2:U),TODAY(),"M"),"")))'
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!Z2",
        valueInputOption="USER_ENTERED",
        body={"values": [[formula]]},
    ).execute()
    print(f"  Formula written to Z2: {formula}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 65)
    print("cleanup_industry_dates.py — Company_Master 4-pass cleanup")
    print(f"Run: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("=" * 65)

    # Auth
    print("\nAuthenticating...")
    creds = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    print("  Authenticated OK")

    sheet_id = get_sheet_id(service)
    print(f"  Sheet ID for '{SHEET_NAME}': {sheet_id}")

    report_lines: list[str] = []

    # ── PASS 1 + 2 ─────────────────────────────────────────────────────────────
    col_m, col_n = read_industry_columns(service)

    # Determine data rows — skip header (row index 0)
    max_rows = max(len(col_m), len(col_n))

    # Pad to same length
    while len(col_m) < max_rows:
        col_m.append("")
    while len(col_n) < max_rows:
        col_n.append("")

    # Pass 1 stats
    p1_writes: list[tuple[str, str]] = []    # (cell_ref, new_value)
    p1_normalized = 0
    p1_unmapped: list[tuple[int, str, str]] = []  # (sheet_row, original, reason)

    # Pass 2 stats
    p2_writes: list[tuple[str, str]] = []
    p2_filled = 0
    p2_still_blank = 0

    print("\n--- Pass 1: Normalize Industry (col M) ---")
    for i in range(1, max_rows):  # skip header
        sheet_row = i + 1          # 1-based sheet row
        m_val = col_m[i].strip() if col_m[i] else ""

        if not m_val:
            # Handled in Pass 2
            continue

        canonical, method = map_industry(m_val)

        if method == "exact_canonical":
            continue  # already correct

        if canonical is not None:
            cell_ref = f"M{sheet_row}"
            p1_writes.append((cell_ref, canonical))
            p1_normalized += 1
        else:
            p1_unmapped.append((sheet_row, m_val, method))

    print(f"  Values to normalize: {p1_normalized}")
    print(f"  Unmapped values:     {len(p1_unmapped)}")

    print("\n--- Pass 2: Fill blank Industry from Sub-Industry (col N) ---")
    for i in range(1, max_rows):
        sheet_row = i + 1
        m_val = col_m[i].strip() if col_m[i] else ""
        n_val = col_n[i].strip() if col_n[i] else ""

        if m_val:
            # Not blank — Pass 1 handles it
            continue

        if not n_val:
            # Both blank — nothing to do
            continue

        canonical, method = map_industry(n_val)

        if canonical is not None:
            cell_ref = f"M{sheet_row}"
            p2_writes.append((cell_ref, canonical))
            p2_filled += 1
        else:
            p2_still_blank += 1

    print(f"  Blanks filled from Sub-Industry: {p2_filled}")
    print(f"  Still blank (no Sub-Industry match): {p2_still_blank}")

    # Write Pass 1 + 2
    all_industry_writes = p1_writes + p2_writes
    print(f"\nWriting {len(all_industry_writes)} Industry updates to sheet...")
    cells_written_industry = batch_write_values(service, all_industry_writes)
    print(f"  Total Industry cells written: {cells_written_industry}")

    # ── PASS 3 ─────────────────────────────────────────────────────────────────
    print("\n--- Pass 3: Normalize Last Funding Date (col U) ---")
    col_u = read_date_column(service)

    p3_writes: list[tuple[str, str]] = []
    p3_normalized = 0
    p3_padded = 0
    p3_unchanged = 0
    p3_unrecognised: list[tuple[int, str]] = []

    for i in range(1, len(col_u)):
        sheet_row = i + 1
        raw = col_u[i].strip() if col_u[i] else ""

        if not raw:
            continue

        normalized, action = normalize_date(raw)

        if action == "unchanged":
            p3_unchanged += 1
            continue

        if normalized is None:
            p3_unrecognised.append((sheet_row, raw))
            continue

        cell_ref = f"U{sheet_row}"
        p3_writes.append((cell_ref, normalized))

        if "padded" in action:
            p3_padded += 1
        else:
            p3_normalized += 1

    print(f"  Dates normalized (format changed):   {p3_normalized}")
    print(f"  Dates padded (year/year-month):      {p3_padded}")
    print(f"  Already valid ISO (unchanged):       {p3_unchanged}")
    print(f"  Unrecognised / skipped:              {len(p3_unrecognised)}")
    print(f"  Total date writes:                   {len(p3_writes)}")

    print(f"\nWriting {len(p3_writes)} date updates to sheet...")
    cells_written_dates = batch_write_values(service, p3_writes)
    print(f"  Total date cells written: {cells_written_dates}")

    # ── PASS 4 ─────────────────────────────────────────────────────────────────
    write_months_formula(service, sheet_id)

    # ── Build report ───────────────────────────────────────────────────────────
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    report_lines = [
        "=" * 65,
        "INDUSTRY + DATE CLEANUP REPORT",
        f"Generated: {ts}",
        "=" * 65,
        "",
        "--- PASS 1: Normalize Industry (col M) ---",
        f"  Values normalized : {p1_normalized}",
        f"  Unmapped values   : {len(p1_unmapped)}",
    ]

    if p1_unmapped:
        report_lines.append("")
        report_lines.append("  Unmapped Industry values (row, original):")
        for sheet_row, original, reason in p1_unmapped:
            report_lines.append(f"    Row {sheet_row:>5}: {original!r}  [{reason}]")

    report_lines += [
        "",
        "--- PASS 2: Fill blank Industry from Sub-Industry ---",
        f"  Blanks filled     : {p2_filled}",
        f"  Still blank       : {p2_still_blank}",
        "",
        "--- PASS 3: Normalize Last Funding Date (col U) ---",
        f"  Normalized        : {p3_normalized}",
        f"  Padded            : {p3_padded}",
        f"  Already valid ISO : {p3_unchanged}",
        f"  Unrecognised      : {len(p3_unrecognised)}",
    ]

    if p3_unrecognised:
        report_lines.append("")
        report_lines.append("  Unrecognised date values:")
        for sheet_row, raw in p3_unrecognised:
            report_lines.append(f"    Row {sheet_row:>5}: {raw!r}")

    # Sample of date writes
    if p3_writes:
        report_lines.append("")
        report_lines.append("  Sample date normalizations (up to 10):")
        for cell_ref, new_val in p3_writes[:10]:
            # Find original — look up from col_u by row
            row_i = int(cell_ref[1:]) - 1
            orig = col_u[row_i] if row_i < len(col_u) else "?"
            report_lines.append(f"    {cell_ref}: {orig!r} -> {new_val!r}")

    report_lines += [
        "",
        "--- PASS 4: Months_Since_Funding ARRAYFORMULA (col Z) ---",
        "  Formula written to Z2.",
        "  Z3:Z2800 cleared.",
        "",
        "=" * 65,
        "SUMMARY",
        "=" * 65,
        f"  Pass 1: {p1_normalized} values normalized, {len(p1_unmapped)} unmapped",
        f"  Pass 2: {p2_filled} blanks filled from Sub-Industry, {p2_still_blank} still blank",
        f"  Pass 3: {p3_normalized + p3_padded} dates normalized/padded ({p3_normalized} format changes, {p3_padded} padded)",
        "  Pass 4: Formula written to Z2",
    ]

    report_text = "\n".join(report_lines)
    print("\n" + report_text)

    REPORT_PATH.write_text(report_text, encoding="utf-8")
    print(f"\nReport saved to: {REPORT_PATH}")

    # Stdout summary (clean, concise)
    print("\n" + "=" * 65)
    print("FINAL SUMMARY")
    print("=" * 65)
    print(f"  Pass 1: {p1_normalized} values normalized, {len(p1_unmapped)} unmapped")
    print(f"  Pass 2: {p2_filled} blanks filled from Sub-Industry, {p2_still_blank} still blank")
    print(f"  Pass 3: {p3_normalized + p3_padded} dates normalized/padded, {len(p3_unrecognised)} unrecognised")
    print("  Pass 4: Formula written to Z2")

    return 0


if __name__ == "__main__":
    sys.exit(main())
