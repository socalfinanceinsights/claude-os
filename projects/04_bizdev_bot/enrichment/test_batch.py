"""
test_batch.py — Quick inline batch test with 5 rows.

Validates:
  - Batch API accepts system_instruction + google_search tools
  - Polling works
  - Response format (so collect parser can be written correctly)

Usage:
    python test_batch.py
"""

import csv
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(r"C:\AG_Work\05_Candidate_Master\pipeline\.env"))

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
FULL_CM_FILE = Path(__file__).parent.parent / "tempFiles" / "Data Enrichment" / \
               "full Company_Master data set Post Antigravity enrichment.csv"

STAGE2_SYSTEM = """You are a Financial Data Enrichment Specialist finding detailed firmographic and funding data for companies.

RULES:
1. Search the web thoroughly for each company's financial and organizational data.
2. Use Crunchbase, PitchBook, LinkedIn, SEC filings, and news articles as sources.
3. THE SOCAL PRIORITY: If a company name has multiple entities, ALWAYS choose the Southern California entity.
4. For company size, use standardized ranges: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10001+
5. For revenue, use standardized ranges: <$1M, $1M-$10M, $10M-$50M, $50M-$100M, $100M-$500M, $500M-$1B, $1B+
6. Growth Stage: Pre-Seed, Seed, Early Stage, Growth, Late Stage, Mature, Public, Acquired, Defunct
7. If you truly cannot find data, return empty strings — do NOT guess.

RESPONSE FORMAT — respond with ONLY a JSON object, no markdown:
{
    "company_size": "range or empty string",
    "revenue": "range or empty string",
    "sub_industry": "specific label or empty string",
    "last_funding_type": "type or empty string",
    "last_funding_date": "YYYY-MM-DD or empty string",
    "last_funding_amount": "numeric string or empty string",
    "num_funding_rounds": "number as string or empty string",
    "total_funding": "numeric string or empty string",
    "growth_stage": "stage or empty string",
    "confidence": "high/medium/low"
}"""

STAGE2_FIELDS = [
    "CompanySizeNorm", "CompanyRevenueNorm", "Sub-Industry",
    "Last Funding Type", "Last Funding Date", "Last Funding Amount",
    "Number of Funding Rounds", "Total Funding Amount", "Growth Stage",
]


def build_prompt(item):
    desc = item.get("Company Description", "")
    desc_short = (desc[:500] + "...") if len(desc) > 500 else desc
    company = item.get("Company", "")
    domain = item.get("Company Domain", "")
    industry = item.get("Industry", "")
    hq = f"{item.get('HQ City', '')}, {item.get('HQ State', '')}".strip(", ")
    context_parts = []
    if industry:
        context_parts.append(f"Industry: {industry}")
    if hq:
        context_parts.append(f"HQ: {hq}")
    year = item.get("Company_Year_Founded", "")
    if year:
        context_parts.append(f"Founded: {year}")
    context = "\n".join(context_parts)
    return (
        f"Find detailed financial and organizational data for this company:\n\n"
        f"Company: {company}\n"
        f"Domain: {domain}\n"
        f"Description: {desc_short}\n"
        f"{context}\n\n"
        f'Search for: "{company} funding crunchbase revenue employees {domain}"\n'
        f'Also try: "{company} series funding round pitchbook"\n\n'
        f"Return JSON only."
    )


def main():
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY not set.")
        sys.exit(1)

    # Load 5 rows that need Stage 2 enrichment
    print("Loading CSV...")
    with open(FULL_CM_FILE, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    needs_work = [r for r in rows if any(not r.get(f, "").strip() for f in STAGE2_FIELDS)]
    test_rows = needs_work[:5]

    print(f"Test rows:")
    for r in test_rows:
        print(f"  {r.get('Company', '?')} ({r.get('Company Domain', '?')})")

    # Build inline requests using SDK types (InlinedRequest + GenerateContentConfig)
    inline_requests = []
    for item in test_rows:
        inline_requests.append(
            types.InlinedRequest(
                contents=build_prompt(item),
                config=types.GenerateContentConfig(
                    system_instruction=STAGE2_SYSTEM,
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.1,
                ),
            )
        )

    print(f"\nSubmitting {len(inline_requests)} inline batch requests...")
    client = genai.Client(api_key=GEMINI_API_KEY)

    job = client.batches.create(
        model="models/gemini-2.5-pro",
        src=inline_requests,
        config={"display_name": "test_batch_5rows"},
    )

    print(f"Job name:  {job.name}")
    print(f"State:     {job.state.name}")

    # Poll until done
    print("\nPolling...")
    done_states = {"JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}
    poll_interval = 15
    while job.state.name not in done_states:
        time.sleep(poll_interval)
        job = client.batches.get(name=job.name)
        print(f"  {job.state.name}")
        poll_interval = min(poll_interval * 2, 120)  # Back off up to 2 min

    print(f"\nFinal state: {job.state.name}")

    if job.state.name != "JOB_STATE_SUCCEEDED":
        print("Job did not succeed.")
        print(f"Full job object: {job}")
        sys.exit(1)

    # Print raw response structure so we know how to parse it
    print("\n--- RAW JOB OBJECT (for parser design) ---")
    print(f"Type: {type(job)}")
    print(f"Attributes: {[a for a in dir(job) if not a.startswith('_')]}")
    print()

    # Try to access responses
    if hasattr(job, "responses"):
        print(f"job.responses type: {type(job.responses)}")
        print(f"Count: {len(job.responses)}")
        print("\nFirst response (raw):")
        print(json.dumps(str(job.responses[0]), indent=2))
        print()
        for i, resp in enumerate(job.responses):
            company = test_rows[i].get("Company", f"row_{i}")
            print(f"\n=== {company} ===")
            print(f"Type: {type(resp)}")
            print(f"Attrs: {[a for a in dir(resp) if not a.startswith('_')]}")
            if hasattr(resp, "response"):
                inner = resp.response
                print(f"  .response type: {type(inner)}")
                if hasattr(inner, "text"):
                    print(f"  .response.text: {inner.text[:300]}")
            if hasattr(resp, "text"):
                print(f"  .text: {resp.text[:300]}")
    elif hasattr(job, "dest"):
        print(f"job.dest: {job.dest}")
        print(f"job.dest type: {type(job.dest)}")
    else:
        print("No 'responses' or 'dest' attribute found.")
        print(f"Full job: {job}")


if __name__ == "__main__":
    main()
