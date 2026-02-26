"""
fill_industry_from_subindustry.py
Fills blank Industry values (column M) using keyword matching against
Sub-Industry values (column N) in Company_Master sheet.

Execution mode: one-time
"""

import io
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# Fix Windows cp1252 console encoding — use UTF-8 stdout/stderr
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT  = Path("C:/AG_Work/04_BizDev_Bot")
TOKEN_PATH    = PROJECT_ROOT / "token.json"
REPORT_PATH   = PROJECT_ROOT / "enrichment" / "output" / "industry_fill_report.txt"

SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"
SHEET_NAME     = "Company_Master"
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets"]

BATCH_SIZE = 500

# ── Keyword Rules ─────────────────────────────────────────────────────────────
# Ordered by priority — first match wins.
# Each entry: (list_of_keywords_or_patterns, canonical_industry)
# Strings are matched as case-insensitive substrings UNLESS they contain a
# special marker; items starting with "RE:" are compiled as regex patterns
# and matched with re.search(..., flags=re.IGNORECASE).

KEYWORD_RULES = [
    # Aerospace & Defense — check BEFORE generic Technology
    (["aerospace", "space tech", "spacecraft", "satellite", "rocket", "launch vehicle",
      "defense", "defence", "military", "tactical", "munition", "energetics",
      "aircraft", "aviation", "drone", "uav", "missile"],
     "Aerospace & Defense"),

    # Biotech & Life Sciences — check BEFORE Healthcare
    (["biotech", "biopharma", "pharma", "pharmaceutical", "therapeutics", "therapy",
      "drug discovery", "drug delivery", "gene therapy", "cell therapy", "immunotherapy",
      "oncology", "genomic", "genome", "proteomics", "molecular", "antibody", "antibodies",
      "protein", "peptide", "biologic", "biosimilar", "diagnostic", "diagnostics",
      "assay", "reagent", "biospecimen", "pathology", "histology",
      "clinical trial", "clinical research", "cro",
      "life science", "neuroscience", "neurology", "endocrinology", "nephrology",
      "dermatology", "ophthalmology", "ophthalmic", "cardiology", "cardiovascular",
      "fertility", "reproductive", "stem cell", "regenerative",
      "medical device", "medical equipment", "medical instrument", "medical supply",
      "medical supplies", "surgical", "implant", "prosthetic", "orthopedic", "orthopaedic",
      "orthotics", "spine", "spinal", "dental", "hearing", "cochlear",
      "RE:\\bimaging\\b", "mri", "ultrasound", "x-ray", "ct scan",
      "ventilator", "respiratory", "infusion", "catheter", "stent",
      "RE:\\blab\\b", "laboratory", "lab equipment", "lab automation",
      "lab tech",
      "medical record", "emr", "ehr",
      "wearable", "biosensor", "biomarker",
      "animal health", "veterinary",
      "cannabis", "cbd", "hemp", "marijuana",
      "nutraceutical", "supplement"],
     "Biotech & Life Sciences"),

    # Healthcare Services & Hospitals
    (["healthcare", "health care", "hospital", "clinic", "nursing", "hospice",
      "pharmacy", "pharmacist", "home health", "urgent care", "telehealth",
      "mental health", "behavioral health", "wellness program",
      "health insurance", "health plan",
      "ambulance", "ems", "emergency medical"],
     "Healthcare Services & Hospitals"),

    # Technology & Software — broad, so checked after more specific verticals
    (["software", "saas", "platform", "app development", "mobile app",
      "RE:\\bai\\b", "artificial intelligence", "machine learning",
      "RE:\\bml\\b",
      "data analytics", "big data", "data management", "database",
      "cloud", "devops", "kubernetes", "microservice",
      "cybersecurity", "cyber security", "information security",
      "it consulting", "it outsourcing", "it services",
      "erp", "crm", "hrm", "hris", "hr tech", "payroll",
      "fintech", "regtech", "legaltech", "proptech", "edtech", "adtech",
      "blockchain", "crypto", "web3", "nft",
      "iot", "internet of things",
      "robotics", "autonomous", "automation",
      "RE:\\bvr\\b", "RE:\\bar\\b", "virtual reality", "augmented reality", "metaverse",
      "gaming", "video game",
      "streaming", "digital media", "content management",
      "e-commerce", "ecommerce", "marketplace",
      "semiconductor", "chip", "processor",
      "telecommunication", "telecom", "5g",
      "api", "sdk", "developer tool"],
     "Technology & Software"),

    # Manufacturing & Industrial
    (["manufacturing", "industrial", "fabrication", "machining", "extrusion",
      "assembly", "production line", "factory",
      "chemical", "polymer", "composite", "material science",
      "construction equipment", "heavy equipment",
      "tooling", "metalwork", "welding",
      "packaging", "printing",
      "electrical equipment", "power generation",
      "hvac", "plumbing", "mechanical",
      "gas distribution", "industrial gas"],
     "Manufacturing & Industrial"),

    # Consumer Packaged Goods (Food & Cosmetic)
    (["food", "beverage", "restaurant", "culinary", "bakery", "brewery",
      "snack", "nutrition", "meal", "catering", "foodservice",
      "cosmetic", "skincare", "beauty product", "personal care",
      "household product", "cleaning product",
      "pet food", "pet product"],
     "Consumer Packaged Goods (Food & Cosmetic)"),

    # Consumer Goods (Apparel, Electronics)
    (["apparel", "clothing", "fashion", "footwear", "shoe",
      "consumer electronics", "gadget",
      "furniture", "home decor", "home accessories",
      "sporting good", "athletic", "fitness equipment",
      "RE:\\btoy\\b", "RE:\\bgame\\b",
      "jewelry", "watch", "accessories"],
     "Consumer Goods (Apparel, Electronics)"),

    # Real Estate Management (REITs) — check BEFORE generic Real Estate
    (["reit", "real estate investment trust", "property management",
      "asset management", "portfolio management"],
     "Real Estate Management (REITs)"),

    # Real Estate Tech & PropTech
    (["proptech", "property technology", "real estate technology",
      "real estate data", "real estate software",
      "smart building", "building automation"],
     "Real Estate Tech & PropTech"),

    # Real Estate Dev. & Construction
    (["real estate", "construction", "building", "housing",
      "architecture", "structural engineering",
      "electrical contractor",
      "renovation", "remodel"],
     "Real Estate Dev. & Construction"),

    # E-commerce Businesses
    (["online retail", "online store", "direct-to-consumer", "dtc",
      "subscription box", "online marketplace"],
     "E-commerce Businesses"),

    # Logistics & Supply Chain
    (["logistics", "supply chain", "freight", "shipping", "warehouse",
      "fulfillment", "delivery", "courier", "last mile",
      "fleet management", "transportation management"],
     "Logistics & Supply Chain"),

    # Professional Services
    (["consulting", "advisory", "legal", "law firm", "accounting", "audit",
      "staffing", "recruiting", "talent acquisition",
      "marketing agency", "pr agency", "design agency",
      "management consulting", "strategy consulting"],
     "Professional Services (legal, consulting, etc.)"),

    # Financial Services & Insurance
    (["RE:\\bbanking\\b", "RE:\\bbank\\b", "credit union", "lending", "mortgage",
      "insurance", "underwriting", "actuary",
      "investment", "venture capital", "private equity", "hedge fund",
      "wealth management",
      "brokerage", "trading", "securities"],
     "Financial Services & Insurance"),

    # Wholesale Trade
    (["wholesale", "distribution", "distributor"],
     "Wholesale Trade"),

    # Transportation & Logistics (catch remaining transport)
    (["transportation", "transit", "railroad", "railway", "trucking",
      "ferry", "port", "maritime"],
     "Transportation & Logistics (beyond 3PL)"),

    # Retail Trade
    (["retail", "RE:\\bstore\\b", "boutique", "mall"],
     "Retail Trade (brick-and-mortar)"),

    # Leisure & Hospitality
    (["hotel", "resort", "hospitality", "tourism", "travel",
      "entertainment", "event", "festival", "concert", "theater", "theatre",
      "amusement", "theme park", "attraction",
      "media production", "film production", "movie", "tv production",
      "music", "radio", "podcast",
      "yoga", "spa", "recreation"],
     "Leisure & Hospitality"),

    # Others
    (["government", "public sector", "municipality",
      "education", "university", "college", "school", "academic",
      "non-profit", "nonprofit", "charity", "foundation",
      "utility", "water utility", "electric utility",
      "agriculture", "farming", "ranch",
      "mining", "quarry", "oil and gas",
      "religious", "church"],
     "Others (Government, Education, Non-Profit, Utilities, Agriculture, Mining, Misc.)"),
]


# Pre-compile regex patterns and build a fast lookup structure
def _compile_rules(rules):
    compiled = []
    for keywords, industry in rules:
        patterns = []
        for kw in keywords:
            if kw.startswith("RE:"):
                patterns.append(re.compile(kw[3:], re.IGNORECASE))
            else:
                # Escape and compile as a plain substring match (no word boundary)
                patterns.append(re.compile(re.escape(kw), re.IGNORECASE))
        compiled.append((patterns, industry))
    return compiled


COMPILED_RULES = _compile_rules(KEYWORD_RULES)


def classify_subindustry(sub_industry: str) -> str | None:
    """
    Return the canonical Industry string for a Sub-Industry value, or None
    if no keyword rule matches.
    """
    for patterns, industry in COMPILED_RULES:
        for pat in patterns:
            if pat.search(sub_industry):
                return industry
    return None


# ── Authentication ────────────────────────────────────────────────────────────
def get_credentials() -> Credentials:
    raw = json.loads(TOKEN_PATH.read_text(encoding="utf-8"))

    # MCP writes 'token'; google-auth expects 'access_token'
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


# ── Step 1: Read columns A, M, N ──────────────────────────────────────────────
def read_sheet(service):
    print(f"\nStep 1: Reading columns A, M, N from {SHEET_NAME}...")

    resp = (
        service.spreadsheets()
        .values()
        .batchGet(
            spreadsheetId=SPREADSHEET_ID,
            ranges=[
                f"{SHEET_NAME}!A:A",   # row identifier (Company Name / domain)
                f"{SHEET_NAME}!M:M",   # Industry
                f"{SHEET_NAME}!N:N",   # Sub-Industry
            ],
        )
        .execute()
    )

    value_ranges = resp.get("valueRanges", [])

    col_a = value_ranges[0].get("values", []) if len(value_ranges) > 0 else []
    col_m = value_ranges[1].get("values", []) if len(value_ranges) > 1 else []
    col_n = value_ranges[2].get("values", []) if len(value_ranges) > 2 else []

    # Determine total rows (max across all three columns; skip header row 0)
    total_rows = max(len(col_a), len(col_m), len(col_n))
    print(f"  Total rows returned (including header): {total_rows}")

    rows = []  # list of (0-based index, company_name, industry, sub_industry)
    for i in range(1, total_rows):  # row 0 is header
        a_val = col_a[i][0].strip() if i < len(col_a) and col_a[i] else ""
        m_val = col_m[i][0].strip() if i < len(col_m) and col_m[i] else ""
        n_val = col_n[i][0].strip() if i < len(col_n) and col_n[i] else ""
        rows.append((i, a_val, m_val, n_val))

    print(f"  Data rows (excluding header): {len(rows)}")
    return rows


# ── Step 2: Classify rows ─────────────────────────────────────────────────────
def classify_rows(rows):
    print("\nStep 2: Classifying rows with blank Industry and non-blank Sub-Industry...")

    total_blanks      = 0   # M is blank
    no_subindustry    = 0   # M blank AND N blank — can't classify
    classified        = []  # (0-based row index, sheet_row, canonical_industry, sub_industry)
    unclassified      = []  # (sheet_row, sub_industry)

    for row_idx, _company, industry, sub_industry in rows:
        if industry:
            continue  # M already has a value — skip

        total_blanks += 1
        sheet_row = row_idx + 1  # convert to 1-based sheet row

        if not sub_industry:
            no_subindustry += 1
            continue

        result = classify_subindustry(sub_industry)
        if result:
            classified.append((row_idx, sheet_row, result, sub_industry))
        else:
            unclassified.append((sheet_row, sub_industry))

    print(f"  Total blank Industry rows   : {total_blanks}")
    print(f"  Classifiable (has Sub-Ind.) : {total_blanks - no_subindustry}")
    print(f"  Classified (keyword match)  : {len(classified)}")
    print(f"  Unclassified (no match)     : {len(unclassified)}")
    print(f"  Still blank (no Sub-Ind.)   : {no_subindustry}")

    return total_blanks, no_subindustry, classified, unclassified


# ── Step 3: Write to sheet ────────────────────────────────────────────────────
def write_to_sheet(service, classified):
    if not classified:
        print("\nStep 3: Nothing to write.")
        return 0, 0, []

    print(f"\nStep 3: Writing {len(classified)} Industry values in batches of {BATCH_SIZE}...")

    total_written = 0
    batch_calls   = 0
    errors        = []

    for batch_start in range(0, len(classified), BATCH_SIZE):
        batch = classified[batch_start : batch_start + BATCH_SIZE]
        data = [
            {
                "range": f"{SHEET_NAME}!M{sheet_row}",
                "values": [[canonical_industry]],
            }
            for _row_idx, sheet_row, canonical_industry, _sub in batch
        ]

        try:
            resp = (
                service.spreadsheets()
                .values()
                .batchUpdate(
                    spreadsheetId=SPREADSHEET_ID,
                    body={"valueInputOption": "RAW", "data": data},
                )
                .execute()
            )
            batch_calls += 1
            updated = resp.get("totalUpdatedCells", len(batch))
            total_written += updated
            print(f"  Batch {batch_calls}: wrote {updated} cells "
                  f"(entries {batch_start + 1}–{batch_start + len(batch)})")
        except Exception as exc:
            errors.append(f"Batch {batch_calls + 1} failed: {exc}")
            print(f"  ERROR in batch {batch_calls + 1}: {exc}", file=sys.stderr)

    print(f"  Total cells written : {total_written}")
    print(f"  batchUpdate calls   : {batch_calls}")
    if errors:
        print(f"  Errors              : {len(errors)}")

    return total_written, batch_calls, errors


# ── Step 4: Build report ──────────────────────────────────────────────────────
def build_report(
    total_blanks, no_subindustry, classified, unclassified,
    total_written, batch_calls, errors
):
    filled       = len(classified)
    still_blank  = no_subindustry
    unclassified_count = len(unclassified)

    # Breakdown by canonical industry
    industry_counts: dict[str, int] = defaultdict(int)
    for _ri, _sr, canonical, _sub in classified:
        industry_counts[canonical] += 1

    lines = [
        "=" * 70,
        "INDUSTRY FILL REPORT — fill_industry_from_subindustry.py",
        f"Generated : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "=" * 70,
        "",
        "── Summary ─────────────────────────────────────────────────────────────",
        f"  Total blank Industry rows before : {total_blanks}",
        f"  Filled (keyword match)           : {filled}",
        f"  Still blank (no Sub-Industry)    : {still_blank}",
        f"  Unclassified (had Sub-Ind, no match) : {unclassified_count}",
        "",
        f"  Cells actually written to sheet  : {total_written}",
        f"  batchUpdate API calls            : {batch_calls}",
        f"  Errors                           : {len(errors)}",
        "",
        "── Breakdown by Canonical Industry ─────────────────────────────────────",
    ]

    for ind, cnt in sorted(industry_counts.items(), key=lambda x: -x[1]):
        lines.append(f"  {cnt:>5}  {ind}")

    lines += [
        "",
        "── Unclassified Sub-Industry Values ─────────────────────────────────────",
        f"  (Total: {unclassified_count})",
        "",
    ]
    for sheet_row, sub in sorted(unclassified, key=lambda x: x[0]):
        lines.append(f"  Row {sheet_row:>6}  |  {sub}")

    if errors:
        lines += ["", "── Errors ───────────────────────────────────────────────────────────────"]
        for e in errors:
            lines.append(f"  {e}")

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 70)
    print("fill_industry_from_subindustry.py — Company_Master column M fill")
    print("=" * 70)

    # Auth
    print("\nAuthenticating...")
    creds   = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    print("  Authenticated OK")

    # Step 1: Read
    rows = read_sheet(service)

    # Step 2: Classify
    total_blanks, no_subindustry, classified, unclassified = classify_rows(rows)

    # Step 3: Write
    total_written, batch_calls, errors = write_to_sheet(service, classified)

    # Step 4: Report
    report_text = build_report(
        total_blanks, no_subindustry, classified, unclassified,
        total_written, batch_calls, errors
    )

    print("\n" + report_text)

    REPORT_PATH.write_text(report_text, encoding="utf-8")
    print(f"\nReport saved to: {REPORT_PATH}")

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
