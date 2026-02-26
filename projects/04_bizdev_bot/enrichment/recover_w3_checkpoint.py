"""
recover_w3_checkpoint.py — Apply W3's killed-mid-run checkpoint data to the full CM CSV.
Uses same field mapping and "only fill blanks" logic as enrich.py.
"""
import csv
import json
import shutil
from datetime import datetime
from pathlib import Path

ENRICHDIR = Path(__file__).parent
CHECKPOINT = ENRICHDIR / "checkpoints" / "Stage 2 (gemini-2.5-flash) [offset=1350]_progress.json"
FULL_CM = ENRICHDIR.parent / "tempFiles" / "Data Enrichment" / "full Company_Master data set Post Antigravity enrichment.csv"

# Matches apply_result() in enrich.py
FIELD_MAP = {
    "company_size":      "CompanySizeNorm",
    "revenue":           "CompanyRevenueNorm",
    "sub_industry":      "Sub-Industry",
    "last_funding_type": "Last Funding Type",
    "last_funding_date": "Last Funding Date",
    "last_funding_amount": "Last Funding Amount",
    "num_funding_rounds": "Number of Funding Rounds",
    "total_funding":     "Total Funding Amount",
    "growth_stage":      "Growth Stage",
}

print(f"Loading checkpoint: {CHECKPOINT.name}")
with open(CHECKPOINT, "r") as f:
    cp = json.load(f)

results = cp.get("results", [])
print(f"  {len(results)} enriched rows in checkpoint")

by_domain = {}
for r in results:
    domain = r.get("domain", "").strip().lower()
    if domain:
        by_domain[domain] = r

print(f"\nReading CSV...")
with open(FULL_CM, "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    headers = reader.fieldnames
    rows = list(reader)
print(f"  {len(rows)} rows loaded")

matched = 0
updated = 0
for row in rows:
    domain = row.get("Company Domain", "").strip().lower()
    if domain in by_domain:
        matched += 1
        result = by_domain[domain]
        for cp_key, csv_col in FIELD_MAP.items():
            if not row.get(csv_col, "").strip() and result.get(cp_key, "").strip():
                row[csv_col] = result[cp_key]
                updated += 1

print(f"\nMatched {matched} domains, updated {updated} field values")

ts = datetime.now().strftime("%Y%m%d_%H%M")
backup = FULL_CM.with_name(f"full Company_Master pre_w3recovery_{ts}.csv")
shutil.copy2(FULL_CM, backup)
print(f"Backup: {backup.name}")

with open(FULL_CM, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    writer.writerows(rows)

print(f"Done. W3 checkpoint data applied to CSV.")
