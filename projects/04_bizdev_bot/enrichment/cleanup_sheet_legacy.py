"""
cleanup_sheet_legacy.py
Normalize legacy Antigravity-formatted values in Company_Master columns R, S, Y
to standard buckets. Only writes cells where the value actually changes.

Execution mode: one-time
"""

import io
import json
import random
import re
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
PROJECT_ROOT  = Path("C:/AG_Work/04_BizDev_Bot")
TOKEN_PATH    = PROJECT_ROOT / "token.json"
REPORT_PATH   = PROJECT_ROOT / "enrichment" / "output" / "legacy_cleanup_report.txt"

SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"
SHEET_NAME     = "Company_Master"
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets"]

BATCH_SIZE = 500

# Standard buckets (for reference / exact-match short-circuit)
SIZE_BUCKETS    = {"1-10", "11-50", "51-200", "201-500", "501-1000",
                   "1001-5000", "5001-10000", "10001+"}
REVENUE_BUCKETS = {"<$1M", "$1M-$10M", "$10M-$50M", "$50M-$100M",
                   "$100M-$500M", "$500M-$1B", "$1B+"}
STAGE_BUCKETS   = {"Pre-Seed", "Seed", "Early Stage", "Growth",
                   "Late Stage", "Mature", "Public", "Acquired", "Defunct"}


# ── Authentication ────────────────────────────────────────────────────────────
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


# ── Normalization: CompanySizeNorm ────────────────────────────────────────────
def normalize_size(raw: str) -> str:
    """
    Normalize CompanySizeNorm value to a standard bucket.
    Returns the original value unchanged if no rule matches or already standard.
    """
    if not raw or not raw.strip():
        return raw

    v = raw.strip()

    # Strip "Employees " prefix (regular space or non-breaking space U+00A0)
    v = re.sub(r"^Employees[\s\u00a0]+", "", v)

    # Replace en-dash (U+2013) with hyphen
    v = v.replace("\u2013", "-")

    # Remove commas from numbers
    v = v.replace(",", "")

    # Already a standard bucket — no change needed
    if v in SIZE_BUCKETS:
        return v if v != raw.strip().replace(",", "").replace("\u2013", "-").lstrip("Employees ").lstrip("Employees\u00a0") else raw
    # Simpler: just return v if it matches a bucket (the strip/replace above may differ from raw)
    if v in SIZE_BUCKETS:
        return v

    # Explicit mapping rules (post-prefix-strip, post-en-dash, post-comma-removal)
    size_map = {
        ">10000":   "10001+",
        ">10,000":  "10001+",  # already comma-stripped above but handle original too
        "501-999":  "501-1000",
        "500-999":  "501-1000",
        "500-1000": "501-1000",
        "1000-4999": "1001-5000",
        "5000-9999": "5001-10000",
        "100-249":  "51-200",
        "101-200":  "51-200",
        "250-499":  "201-500",
        "21-50":    "11-50",
    }

    mapped = size_map.get(v)
    if mapped:
        return mapped

    # If v now matches a standard bucket, return it
    if v in SIZE_BUCKETS:
        return v

    # No rule matched — return unchanged original
    return raw


# ── Normalization: CompanyRevenueNorm ─────────────────────────────────────────
def normalize_revenue(raw: str) -> str:
    """
    Normalize CompanyRevenueNorm value to a standard bucket.
    Returns original if no rule matches or already standard.
    """
    if not raw or not raw.strip():
        return raw

    v = raw.strip()

    # Strip "Revenue " prefix (case-sensitive per spec)
    v = re.sub(r"^Revenue\s+", "", v)

    # Normalize spaces around hyphens: "$100M - $500M" -> "$100M-$500M"
    v = re.sub(r"\s*-\s*", "-", v)

    # Already a standard bucket
    if v in REVENUE_BUCKETS:
        return v

    # Explicit mapping table (post-prefix-strip, post-space-normalize)
    revenue_map = {
        # Antigravity variants -> standard
        "$1M-$9.99M":       "$1M-$10M",
        "$1M-$9.9M":        "$1M-$10M",
        "$10M-$49.99M":     "$10M-$50M",
        "$10M-$49.9M":      "$10M-$50M",
        "$50M-$99.99M":     "$50M-$100M",
        "$50M-$99.9M":      "$50M-$100M",
        "$100M-$499.99M":   "$100M-$500M",
        "$100M-$499.9M":    "$100M-$500M",
        "$500M-$999.99M":   "$500M-$1B",
        "$500M-$999.9M":    "$500M-$1B",
        # Big revenue / $1B+
        ">=$3B":            "$1B+",
        ">=3B":             "$1B+",
        "$1B-$2.99B":       "$1B+",
        "$1B-$3B":          "$1B+",
        "$1B-$10B":         "$1B+",
        "$10B-$50B":        "$1B+",
        "$10B+":            "$1B+",
        # Miscellaneous non-standard ranges
        "$5M-$10M":         "$1M-$10M",
        "$10M-$20M":        "$10M-$50M",
        "$25M-$50M":        "$10M-$50M",
        "$100M-$250M":      "$100M-$500M",
        "$250M-$500M":      "$100M-$500M",
        # Missing $ prefix variants
        "500M-$1B":         "$500M-$1B",
        "100M-$500M":       "$100M-$500M",
        "50M-$100M":        "$50M-$100M",
        "10M-$50M":         "$10M-$50M",
        "1M-$10M":          "$1M-$10M",
    }

    mapped = revenue_map.get(v)
    if mapped:
        return mapped

    # If v now matches a standard bucket, return it
    if v in REVENUE_BUCKETS:
        return v

    # No rule matched — return unchanged original
    return raw


# ── Normalization: Growth Stage ───────────────────────────────────────────────
def normalize_stage(raw: str) -> str:
    """
    Normalize Growth Stage value to standard vocabulary.
    Returns original if no rule matches or already standard.
    """
    if not raw or not raw.strip():
        return raw

    v = raw.strip()

    # Already standard
    if v in STAGE_BUCKETS:
        return v

    stage_map = {
        "Minor/slow growth":                                    "Mature",
        "High growth (expansion, M&A, transformation)":        "Growth",
        "Stable (established, recurring hires)":                "Mature",
        "Pre Seed Round":                                       "Pre-Seed",
    }

    mapped = stage_map.get(v)
    if mapped:
        return mapped

    # No rule matched
    return raw


# ── Step 1: Read sheet ────────────────────────────────────────────────────────
def read_sheet(service) -> tuple[list, list, list, list]:
    """
    Read columns A, R, S, Y from Company_Master.
    Returns four parallel lists (index 0 = header row):
        domains, sizes, revenues, stages
    Each list entry is the raw string value (empty string if blank).
    """
    print(f"\nStep 1: Reading columns A, R, S, Y from {SHEET_NAME}...")

    ranges = [
        f"{SHEET_NAME}!A:A",
        f"{SHEET_NAME}!R:R",
        f"{SHEET_NAME}!S:S",
        f"{SHEET_NAME}!Y:Y",
    ]

    resp = (
        service.spreadsheets()
        .values()
        .batchGet(spreadsheetId=SPREADSHEET_ID, ranges=ranges)
        .execute()
    )

    value_ranges = resp.get("valueRanges", [])

    def extract_col(vr_index: int) -> list[str]:
        if vr_index >= len(value_ranges):
            return []
        rows = value_ranges[vr_index].get("values", [])
        return [row[0] if row else "" for row in rows]

    domains  = extract_col(0)
    sizes    = extract_col(1)
    revenues = extract_col(2)
    stages   = extract_col(3)

    # Pad shorter lists to match domain length
    max_len = max(len(domains), len(sizes), len(revenues), len(stages))
    domains  += [""] * (max_len - len(domains))
    sizes    += [""] * (max_len - len(sizes))
    revenues += [""] * (max_len - len(revenues))
    stages   += [""] * (max_len - len(stages))

    print(f"  Total rows (incl. header): {max_len}")
    print(f"  Non-empty sizes    : {sum(1 for v in sizes    if v.strip())}")
    print(f"  Non-empty revenues : {sum(1 for v in revenues if v.strip())}")
    print(f"  Non-empty stages   : {sum(1 for v in stages   if v.strip())}")

    return domains, sizes, revenues, stages


# ── Step 2+3: Apply rules and compute changes ─────────────────────────────────
def compute_changes(
    domains: list, sizes: list, revenues: list, stages: list
) -> list[tuple[str, str, str, str, int]]:
    """
    Returns list of (cell_ref, new_value, domain, col_label, row_1based) tuples
    for every cell where the normalized value differs from current.
    Skips row 0 (header).
    """
    print("\nStep 2+3: Applying normalization rules and computing changes...")

    changes: list[tuple[str, str, str, str, int]] = []

    for row_idx in range(1, len(domains)):   # row 0 = header
        sheet_row = row_idx + 1              # 1-based
        domain    = domains[row_idx]

        # CompanySizeNorm — column R
        old_size = sizes[row_idx] if row_idx < len(sizes) else ""
        new_size = normalize_size(old_size)
        if new_size != old_size:
            changes.append((f"R{sheet_row}", new_size, domain, "CompanySizeNorm (R)", sheet_row))

        # CompanyRevenueNorm — column S
        old_rev = revenues[row_idx] if row_idx < len(revenues) else ""
        new_rev = normalize_revenue(old_rev)
        if new_rev != old_rev:
            changes.append((f"S{sheet_row}", new_rev, domain, "CompanyRevenueNorm (S)", sheet_row))

        # Growth Stage — column Y
        old_stage = stages[row_idx] if row_idx < len(stages) else ""
        new_stage = normalize_stage(old_stage)
        if new_stage != old_stage:
            changes.append((f"Y{sheet_row}", new_stage, domain, "Growth Stage (Y)", sheet_row))

    print(f"  Total cells to change: {len(changes)}")
    return changes


# ── Step 4: Report ────────────────────────────────────────────────────────────
def build_report(
    changes: list,
    domains: list, sizes: list, revenues: list, stages: list,
) -> tuple[str, dict]:
    """Build and print a full change report. Returns (report_text, col_counts)."""

    col_counts: dict[str, int] = {}
    for _, _, _, col_label, _ in changes:
        col_counts[col_label] = col_counts.get(col_label, 0) + 1

    lines = [
        "=" * 70,
        "LEGACY CLEANUP REPORT",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "=" * 70,
        f"Total cells to change: {len(changes)}",
        "",
        "Breakdown by column:",
    ]
    for col_label, count in sorted(col_counts.items(), key=lambda x: -x[1]):
        lines.append(f"  {col_label:<30} -> {count} cells")

    lines += ["", "-" * 70, "ALL CHANGES:", "-" * 70]

    # Group by column for readability
    by_col: dict[str, list] = {}
    for cell_ref, new_val, domain, col_label, row_n in changes:
        # Find old value
        if col_label.startswith("CompanySizeNorm"):
            old_val = sizes[row_n - 1] if (row_n - 1) < len(sizes) else ""
        elif col_label.startswith("CompanyRevenueNorm"):
            old_val = revenues[row_n - 1] if (row_n - 1) < len(revenues) else ""
        else:
            old_val = stages[row_n - 1] if (row_n - 1) < len(stages) else ""
        by_col.setdefault(col_label, []).append(
            (cell_ref, old_val, new_val, domain, row_n)
        )

    for col_label in sorted(by_col.keys()):
        lines += ["", f"  [{col_label}]"]
        for cell_ref, old_val, new_val, domain, row_n in by_col[col_label]:
            lines.append(f"    row {row_n:>4}  {cell_ref:<6}  {domain:<40}  '{old_val}'  ->  '{new_val}'")

    report_text = "\n".join(lines)
    print(report_text)
    return report_text, col_counts


# ── Step 5: Write changes ─────────────────────────────────────────────────────
def write_changes(service, changes: list) -> tuple[int, int, list]:
    if not changes:
        print("\nStep 5: No changes to write.")
        return 0, 0, []

    print(f"\nStep 5: Writing {len(changes)} cells in batches of {BATCH_SIZE}...")

    total_written = 0
    batch_calls   = 0
    errors        = []

    for batch_start in range(0, len(changes), BATCH_SIZE):
        batch = changes[batch_start : batch_start + BATCH_SIZE]
        data  = [
            {
                "range": f"{SHEET_NAME}!{cell_ref}",
                "values": [[new_val]],
            }
            for cell_ref, new_val, _, _, _ in batch
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
            updated      = resp.get("totalUpdatedCells", len(batch))
            total_written += updated
            print(f"  Batch {batch_calls}: wrote {updated} cells "
                  f"(items {batch_start + 1}–{batch_start + len(batch)})")
        except Exception as exc:
            errors.append(f"Batch {batch_calls + 1} failed: {exc}")
            print(f"  ERROR in batch {batch_calls + 1}: {exc}", file=sys.stderr)

    print(f"  Total cells written : {total_written}")
    print(f"  batchUpdate calls   : {batch_calls}")
    if errors:
        print(f"  Errors              : {len(errors)}")
    return total_written, batch_calls, errors


# ── Step 6: Spot-check ────────────────────────────────────────────────────────
def spot_check(service, changes: list) -> list[str]:
    if not changes:
        return []

    print("\nStep 6: Spot-checking 5 random changed cells...")
    sample = random.sample(changes, min(5, len(changes)))
    lines  = []

    ranges = [f"{SHEET_NAME}!{cell_ref}" for cell_ref, _, _, _, _ in sample]
    try:
        resp = (
            service.spreadsheets()
            .values()
            .batchGet(spreadsheetId=SPREADSHEET_ID, ranges=ranges)
            .execute()
        )
        vrs = resp.get("valueRanges", [])
        for i, (cell_ref, expected, domain, col_label, _) in enumerate(sample):
            actual_rows = vrs[i].get("values", []) if i < len(vrs) else []
            actual      = actual_rows[0][0] if actual_rows and actual_rows[0] else ""
            status      = "OK" if actual == expected else "MISMATCH"
            line = (f"  {status}  {cell_ref}  "
                    f"expected='{expected[:40]}'  actual='{actual[:40]}'  [{domain}]")
            lines.append(line)
            print(line)
    except Exception as exc:
        lines.append(f"  Spot-check failed: {exc}")
        print(f"  Spot-check error: {exc}", file=sys.stderr)

    return lines


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 70)
    print("cleanup_sheet_legacy.py — Normalize legacy Antigravity formatting")
    print("=" * 70)

    print("\nAuthenticating...")
    creds   = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    print("  Authenticated OK")

    domains, sizes, revenues, stages = read_sheet(service)
    changes = compute_changes(domains, sizes, revenues, stages)

    if not changes:
        print("\nNo changes needed — all values already normalized or empty.")
        REPORT_PATH.write_text(
            "No changes needed — all values already normalized or empty.\n",
            encoding="utf-8",
        )
        return 0

    report_text, col_counts = build_report(changes, domains, sizes, revenues, stages)

    total_written, batch_calls, errors = write_changes(service, changes)
    spot_lines = spot_check(service, changes)

    summary_lines = [
        "",
        "=" * 70,
        "WRITE SUMMARY",
        "=" * 70,
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

    full_report = report_text + "\n" + summary_text
    REPORT_PATH.write_text(full_report, encoding="utf-8")
    print(f"\nReport saved to: {REPORT_PATH}")

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
