"""
normalize.py
Normalizes CompanySizeNorm, CompanyRevenueNorm, Total Funding Amount, and Growth Stage
in the Company_Master post-Antigravity enrichment CSV.

Run from: C:\AG_Work\04_BizDev_Bot\enrichment\
"""

import csv
import shutil
from pathlib import Path
from collections import defaultdict

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

SOURCE_CSV = Path(
    r"C:\AG_Work\04_BizDev_Bot\tempFiles\Data Enrichment"
    r"\full Company_Master data set Post Antigravity enrichment.csv"
)
OUTPUT_DIR = Path(r"C:\AG_Work\04_BizDev_Bot\enrichment\output")
ANOMALIES_CSV = OUTPUT_DIR / "revenue_anomalies.csv"
AUDIT_TXT = OUTPUT_DIR / "normalization_audit.txt"

# Standard buckets
SIZE_BUCKETS = {"1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"}
REVENUE_BUCKETS = {"<$1M", "$1M-$10M", "$10M-$50M", "$50M-$100M", "$100M-$500M", "$500M-$1B", "$1B+"}

# ---------------------------------------------------------------------------
# CompanySizeNorm mappings
# Strip "Employees " prefix + normalize en-dash/hyphen variants, then map.
# Values that already match SIZE_BUCKETS pass through unchanged.
# ---------------------------------------------------------------------------

# After stripping "Employees " prefix and normalising dashes:
SIZE_EXPLICIT_MAP = {
    # Antigravity en-dash variants (after prefix strip, en-dash → hyphen)
    "100-249":   "51-200",
    "20-99":     None,        # AMBIGUOUS — flag, leave original
    "250-499":   "201-500",
    "500-999":   "501-1000",
    "1,000-4,999": "1001-5000",
    # Numeric range corrections
    "101-200":   "51-200",
    "100-200":   "51-200",
    "51-100":    "51-200",
    "21-50":     "11-50",
    "101-500":   "201-500",   # round up to next standard bucket
    "101-250":   "51-200",
    "151-200":   "51-200",
    "201-5000":  "1001-5000",  # clearly a data error — use mid bucket
    "2001-5000": "1001-5000",
    "10000+":    "10001+",
    ">10,000":   "10001+",
    "501-999":   "501-1000",
    "unknown / undisclosed": None,  # leave unchanged (not a range)
}

# ---------------------------------------------------------------------------
# CompanyRevenueNorm mappings
# Strip "Revenue " prefix first, then map.
# ---------------------------------------------------------------------------

REVENUE_EXPLICIT_MAP = {
    # Antigravity formatted variants (after prefix strip)
    "$1M - $9.99M":    "$1M-$10M",
    "$10M - $49.99M":  "$10M-$50M",
    "$50M - $99.99M":  "$50M-$100M",
    "$100M - $499.99M": "$100M-$500M",
    "$500M - $999.99M": "$500M-$1B",
    "< $1M":           "<$1M",
    ">= $3B":          "$1B+",
    "$1B - $2.99B":    "$1B+",
    # Off-band mappings — round UP to nearest standard bucket
    "$5M-$10M":    "$1M-$10M",
    "$10M-$20M":   "$10M-$50M",
    "$25M-$50M":   "$10M-$50M",
    "$100M-$250M": "$100M-$500M",
    "$250M-$500M": "$100M-$500M",
    "$10M-$25M":   "$10M-$50M",
    "$25M-$100M":  "$50M-$100M",
    # Ambiguous — flag, leave original
    "$5M-$20M":    None,
    # Missing $ prefix corrections
    "100M-500M":   "$100M-$500M",
    "500M-$1B":    "$500M-$1B",
    "100M-$500M":  "$100M-$500M",
    "1B+":         "$1B+",
    # No-space variants (seen in data without prefix)
    "1M-10M":      "$1M-$10M",
    "10M-50M":     "$10M-$50M",
    # Unknown — strip prefix but leave as non-bucket value
    "unknown / undisclosed": "Unknown / Undisclosed",
    # Large buckets
    "$1B-$10B":    "$1B+",
    "$10B-$50B":   "$1B+",
    # Raw numbers that got into this column (treat as data errors, flag)
    "<$10M":       "$1M-$10M",   # best guess: conservative
}

# Raw numeric strings in CompanyRevenueNorm — these are genuine anomalies.
# We'll detect them by checking if the value is entirely numeric digits.

# ---------------------------------------------------------------------------
# Growth Stage mappings
# ---------------------------------------------------------------------------

GROWTH_MAP = {
    "Minor/slow growth":                              "Mature",
    "High growth (expansion, M&A, transformation)":  "Growth",
    "Stable (established, recurring hires)":          "Mature",
    "Pre Seed Round":                                 "Pre-Seed",
    # "N/A - Student Organization" — flag in audit, leave as-is
}

GROWTH_LEAVE_AS_IS_FLAG = {"N/A - Student Organization"}

# Size/Revenue mismatch detection
SMALL_SIZES   = {"1-10", "11-50"}
LARGE_REVENUES = {"$100M-$500M", "$500M-$1B", "$1B+"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def strip_employees_prefix(val: str) -> str:
    """Remove 'Employees ' prefix and normalise en-dash to hyphen."""
    v = val.strip()
    if v.lower().startswith("employees "):
        v = v[len("employees "):].strip()
    # Replace en-dash (–) and em-dash (—) with hyphen
    v = v.replace("\u2013", "-").replace("\u2014", "-")
    # Remove commas in numbers (e.g. "1,000-4,999")
    return v


def strip_revenue_prefix(val: str) -> str:
    """Remove 'Revenue ' prefix."""
    v = val.strip()
    if v.lower().startswith("revenue "):
        v = v[len("revenue "):].strip()
    return v


def normalize_size(val: str):
    """
    Returns (new_val, action) where action is one of:
      'unchanged', 'mapped', 'ambiguous', 'unknown_left'
    """
    if not val or not val.strip():
        return val, "unchanged"

    stripped = strip_employees_prefix(val)

    # Already a standard bucket (after stripping prefix)?
    if stripped in SIZE_BUCKETS:
        # If original had prefix, it was changed; otherwise truly unchanged
        if stripped != val:
            return stripped, "mapped"
        return val, "unchanged"

    stripped_lower = stripped.lower()

    # Check explicit map (case-insensitive key match)
    for key, mapped in SIZE_EXPLICIT_MAP.items():
        if stripped_lower == key.lower():
            if mapped is None:
                return val, "ambiguous"
            return mapped, "mapped"

    # Fallback: unknown value, leave as-is
    return val, "unknown_left"


def normalize_revenue(val: str):
    """
    Returns (new_val, action) where action is one of:
      'unchanged', 'mapped', 'ambiguous', 'unknown_left'
    """
    if not val or not val.strip():
        return val, "unchanged"

    stripped = strip_revenue_prefix(val)

    # Already a standard bucket?
    if stripped in REVENUE_BUCKETS:
        if stripped != val:
            return stripped, "mapped"
        return val, "unchanged"

    stripped_lower = stripped.lower()

    # Check explicit map
    for key, mapped in REVENUE_EXPLICIT_MAP.items():
        if stripped_lower == key.lower():
            if mapped is None:
                return val, "ambiguous"
            return mapped, "mapped"

    # Raw numeric string — flag as anomaly, leave unchanged
    if stripped.replace(",", "").replace(".", "").isdigit():
        return val, "ambiguous"

    # Unknown — leave as-is
    return val, "unknown_left"


def normalize_funding(val: str):
    """
    Convert "0" → "". All other values pass through unchanged.
    Returns (new_val, changed: bool)
    """
    if val.strip() == "0":
        return "", True
    return val, False


def normalize_growth(val: str):
    """
    Returns (new_val, action)
    """
    if not val or not val.strip():
        return val, "unchanged"
    if val in GROWTH_LEAVE_AS_IS_FLAG:
        return val, "flag_leave"
    if val in GROWTH_MAP:
        return GROWTH_MAP[val], "mapped"
    return val, "unchanged"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Backup
    backup_path = SOURCE_CSV.with_name(
        SOURCE_CSV.stem + "_pre_normalize" + SOURCE_CSV.suffix
    )
    shutil.copy2(SOURCE_CSV, backup_path)
    print(f"Backup created: {backup_path}")

    # 2. Read source
    with open(SOURCE_CSV, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    print(f"Rows read: {len(rows)}")

    # 3. Process rows
    anomalies = []

    # Counters
    counters = defaultdict(int)
    # keys: size_changed, size_ambiguous, size_unknown
    #       rev_changed, rev_ambiguous, rev_unknown
    #       funding_changed
    #       growth_changed, growth_flagged
    #       mismatch_flagged
    # Also track Growth Stage "flag_leave" separately
    growth_leave_count = 0

    for row in rows:
        company  = row.get("Company", "")
        domain   = row.get("Company Domain", "")
        size_orig   = row.get("CompanySizeNorm", "")
        rev_orig    = row.get("CompanyRevenueNorm", "")
        funding_orig = row.get("Total Funding Amount", "")
        growth_orig = row.get("Growth Stage", "")

        anomaly_reasons = []

        # --- CompanySizeNorm ---
        new_size, size_action = normalize_size(size_orig)
        if size_action == "mapped":
            counters["size_changed"] += 1
            row["CompanySizeNorm"] = new_size
        elif size_action == "ambiguous":
            counters["size_ambiguous"] += 1
            anomaly_reasons.append(f"size_ambiguous: {size_orig!r}")
            # leave original
        elif size_action == "unknown_left":
            counters["size_unknown"] += 1

        # --- CompanyRevenueNorm ---
        new_rev, rev_action = normalize_revenue(rev_orig)
        if rev_action == "mapped":
            counters["rev_changed"] += 1
            row["CompanyRevenueNorm"] = new_rev
        elif rev_action == "ambiguous":
            counters["rev_ambiguous"] += 1
            anomaly_reasons.append(f"rev_ambiguous: {rev_orig!r}")
            # leave original
        elif rev_action == "unknown_left":
            counters["rev_unknown"] += 1

        # After potential normalization, read effective values for mismatch check
        eff_size = row.get("CompanySizeNorm", "")
        eff_rev  = row.get("CompanyRevenueNorm", "")

        # --- Total Funding Amount ---
        new_funding, funding_changed = normalize_funding(funding_orig)
        if funding_changed:
            counters["funding_changed"] += 1
            row["Total Funding Amount"] = new_funding

        # --- Growth Stage ---
        new_growth, growth_action = normalize_growth(growth_orig)
        if growth_action == "mapped":
            counters["growth_changed"] += 1
            row["Growth Stage"] = new_growth
        elif growth_action == "flag_leave":
            growth_leave_count += 1
            anomaly_reasons.append(f"growth_flag_leave: {growth_orig!r}")

        # --- Size/Revenue mismatch ---
        if eff_size in SMALL_SIZES and eff_rev in LARGE_REVENUES:
            counters["mismatch_flagged"] += 1
            anomaly_reasons.append(f"size_rev_mismatch: size={eff_size!r} rev={eff_rev!r}")

        # Collect anomaly row
        if anomaly_reasons:
            anomalies.append({
                "Company": company,
                "Domain": domain,
                "CompanySizeNorm": eff_size,
                "CompanyRevenueNorm": eff_rev,
                "Growth Stage": row.get("Growth Stage", ""),
                "flag_reason": " | ".join(anomaly_reasons),
            })

    # 4. Overwrite source CSV
    with open(SOURCE_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Normalized CSV written: {SOURCE_CSV}")

    # 5. Write anomalies
    anomaly_fields = ["Company", "Domain", "CompanySizeNorm", "CompanyRevenueNorm", "Growth Stage", "flag_reason"]
    with open(ANOMALIES_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=anomaly_fields)
        writer.writeheader()
        writer.writerows(anomalies)
    print(f"Anomalies written: {ANOMALIES_CSV} ({len(anomalies)} rows)")

    # 6. Write audit
    audit_lines = [
        "=== Normalization Audit ===",
        f"Source: {SOURCE_CSV}",
        f"Total rows processed: {len(rows)}",
        "",
        "--- CompanySizeNorm ---",
        f"  Values changed (mapped to standard bucket): {counters['size_changed']}",
        f"  Ambiguous values flagged (left unchanged):  {counters['size_ambiguous']}",
        f"  Unknown values (left unchanged, not mapped): {counters['size_unknown']}",
        "",
        "--- CompanyRevenueNorm ---",
        f"  Values changed (mapped to standard bucket): {counters['rev_changed']}",
        f"  Ambiguous values flagged (left unchanged):  {counters['rev_ambiguous']}",
        f"  Unknown values (left unchanged, not mapped): {counters['rev_unknown']}",
        "",
        "--- Total Funding Amount ---",
        f"  '0' converted to empty string: {counters['funding_changed']}",
        "",
        "--- Growth Stage ---",
        f"  Values changed (mapped to standard vocab): {counters['growth_changed']}",
        f"  'N/A - Student Organization' flagged (left unchanged): {growth_leave_count}",
        "",
        "--- Size/Revenue Mismatch ---",
        f"  Rows flagged (small size + large revenue): {counters['mismatch_flagged']}",
        "",
        f"Total anomaly rows written to revenue_anomalies.csv: {len(anomalies)}",
        f"Backup path: {backup_path}",
    ]

    with open(AUDIT_TXT, "w", encoding="utf-8") as f:
        f.write("\n".join(audit_lines) + "\n")
    print(f"Audit written: {AUDIT_TXT}")

    # Print audit to console too
    print()
    for line in audit_lines:
        print(line)


if __name__ == "__main__":
    main()
