"""
build_write_manifest.py
Reads the normalized enrichment CSV and produces a JSON manifest for sheet import.

Target fields (10):
  Industry, CompanySizeNorm, CompanyRevenueNorm, Sub-Industry,
  Last Funding Type, Last Funding Date, Last Funding Amount,
  Number of Funding Rounds, Total Funding Amount, Growth Stage
"""

import csv
import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
CSV_PATH = Path(
    r"C:\AG_Work\04_BizDev_Bot\tempFiles\Data Enrichment"
    r"\full Company_Master data set Post Antigravity enrichment.csv"
)
OUTPUT_PATH = Path(r"C:\AG_Work\04_BizDev_Bot\enrichment\output\write_manifest.json")

# ---------------------------------------------------------------------------
# Target fields and special exclusion rules
# ---------------------------------------------------------------------------
TARGET_FIELDS = [
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

# Fields where "0" is treated as empty (no data)
EXCLUDE_ZERO_FIELDS = {"Total Funding Amount"}


def is_empty(field_name: str, value: str) -> bool:
    """Return True if the value should be treated as missing."""
    stripped = value.strip()
    if not stripped:
        return True
    if field_name in EXCLUDE_ZERO_FIELDS and stripped == "0":
        return True
    return False


# ---------------------------------------------------------------------------
# Build manifest
# ---------------------------------------------------------------------------
domain_to_fields: dict[str, dict[str, str]] = {}
fields_by_column: dict[str, int] = {f: 0 for f in TARGET_FIELDS}
total_rows = 0
rows_with_any_data = 0
skipped_no_domain = 0

with open(CSV_PATH, encoding="utf-8", newline="") as fh:
    reader = csv.DictReader(fh)
    for row in reader:
        total_rows += 1

        domain_raw = row.get("Company Domain", "")
        domain = domain_raw.strip().lower()
        if not domain:
            skipped_no_domain += 1
            continue

        field_data: dict[str, str] = {}
        for field in TARGET_FIELDS:
            raw = row.get(field, "")
            if not is_empty(field, raw):
                field_data[field] = raw.strip()
                fields_by_column[field] += 1

        if field_data:
            rows_with_any_data += 1
            domain_to_fields[domain] = field_data

# ---------------------------------------------------------------------------
# Assemble output
# ---------------------------------------------------------------------------
manifest = {
    "domain_to_fields": domain_to_fields,
    "stats": {
        "total_rows": total_rows,
        "skipped_no_domain": skipped_no_domain,
        "rows_with_any_data": rows_with_any_data,
        "fields_by_column": fields_by_column,
    },
}

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT_PATH, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2, ensure_ascii=False)

# ---------------------------------------------------------------------------
# Print stats to stdout
# ---------------------------------------------------------------------------
stats = manifest["stats"]
print("=== write_manifest.json stats ===")
print(f"  total_rows          : {stats['total_rows']}")
print(f"  skipped_no_domain   : {stats['skipped_no_domain']}")
print(f"  rows_with_any_data  : {stats['rows_with_any_data']}")
print(f"  unique domains      : {len(domain_to_fields)}")
print()
print("  fields_by_column:")
for field, count in stats["fields_by_column"].items():
    print(f"    {field:<30} {count}")
print()
print(f"Output written to: {OUTPUT_PATH}")
