"""
enrich.py — Two-stage Company Master Enrichment via Gemini + Search Grounding.

Stage 1 (Flash):  HQ City/State/Country, Year Founded, Industry
Stage 2 (Pro):    CompanySizeNorm, CompanyRevenueNorm, Funding fields, Growth Stage, Sub-Industry

Both stages read from CSV, write to CSV. Stage 1 merges results into the full
Company_Master CSV. Stage 2 reads that merged file and fills remaining gaps.

Usage:
    python enrich.py stage1              # Run Stage 1 (Flash — easy fields)
    python enrich.py stage2              # Run Stage 2 (Pro — hard fields, interactive)
    python enrich.py stage2 --batch      # Run Stage 2 (Pro — submit as batch job)
    python enrich.py collect             # Check batch job status + apply results
    python enrich.py stage1 --limit 10   # Test with first 10 rows
    python enrich.py stage2 --limit 10

Prerequisites:
    - .env file with GEMINI_API_KEY=your_key (in enrichment/ or 04_BizDev_Bot/)
    - Source CSVs in ../tempFiles/Data Enrichment/
"""

import csv
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

# Fix Windows console encoding for Unicode company names
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')


# ─── CONFIG ───────────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(r"C:\AG_Work\05_Candidate_Master\pipeline\.env"))  # Shared key

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Models (defaults — can be overridden with --model)
FLASH_MODEL = "gemini-2.5-flash"
PRO_MODEL = "gemini-2.5-pro"

# File paths
DATA_DIR = Path(__file__).parent.parent / "tempFiles" / "Data Enrichment"
STAGE1_SOURCE = DATA_DIR / "Data Set 2 row 963 and on.csv"
FULL_CM_FILE = DATA_DIR / "full Company_Master data set Post Antigravity enrichment.csv"
OUTPUT_DIR = Path(__file__).parent / "output"

# Rate limiting (interactive mode only)
PAUSE_BETWEEN_CALLS = 1.0
BATCH_LOG_INTERVAL = 25
PAUSE_BETWEEN_BATCHES = 3.0

# Checkpoint / batch job storage
CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"

# Stage 1 fields (easy — Flash can handle)
STAGE1_FIELDS = ["HQ City", "HQ State", "HQ Country", "Company_Year_Founded", "Industry"]

# Stage 2 fields (harder — Pro for better reasoning)
STAGE2_FIELDS = [
    "CompanySizeNorm", "CompanyRevenueNorm", "Sub-Industry",
    "Last Funding Type", "Last Funding Date", "Last Funding Amount",
    "Number of Funding Rounds", "Total Funding Amount", "Growth Stage",
]


# ─── SYSTEM PROMPTS ──────────────────────────────────────────────────────────

STAGE1_SYSTEM = """You are a Data Enrichment Specialist finding basic firmographic data for companies.

RULES:
1. For every company, search the web for its headquarters location, year founded, and industry.
2. Look for the Global Headquarters or Corporate HQ — not satellite offices.
3. THE SOCAL PRIORITY: If a company name has multiple entities (e.g., one in London and one in Irvine, CA), ALWAYS choose the Southern California entity. This is a recruiting dataset focused on SoCal.
4. For Industry, use the company description as context. Keep industry labels concise (2-4 words max).
5. If a company has merged or been acquired, note the current parent/status.
6. If you truly cannot find data, return empty strings — do NOT guess.

RESPONSE FORMAT — respond with ONLY a JSON object, no markdown, no explanation:
{
    "hq_city": "city name or empty string",
    "hq_state": "full state name or empty string",
    "hq_country": "country or empty string",
    "year_founded": "4-digit year as string or empty string",
    "industry": "concise 2-4 word industry label or empty string",
    "notes": "mergers, ambiguity, or other context — or empty string",
    "confidence": "high/medium/low"
}"""

STAGE2_SYSTEM = """You are a Financial Data Enrichment Specialist finding detailed firmographic and funding data for companies.

RULES:
1. Search the web thoroughly for each company's financial and organizational data.
2. Use Crunchbase, PitchBook, LinkedIn, SEC filings, and news articles as sources.
3. THE SOCAL PRIORITY: If a company name has multiple entities, ALWAYS choose the Southern California entity.
4. For company size, use standardized ranges: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10001+
5. For revenue, use standardized ranges: <$1M, $1M-$10M, $10M-$50M, $50M-$100M, $100M-$500M, $500M-$1B, $1B+
6. Growth Stage should be one of: Pre-Seed, Seed, Early Stage, Growth, Late Stage, Mature, Public, Acquired, Defunct
7. Sub-Industry should be more specific than Industry (e.g., Industry="Technology & Software", Sub-Industry="Cloud Infrastructure")
8. For funding fields, use the MOST RECENT round data for "Last Funding" fields.
9. Amounts should be plain numbers (no $ or commas): e.g., "50000000" not "$50M"
10. If you truly cannot find data, return empty strings — do NOT guess.

RESPONSE FORMAT — respond with ONLY a JSON object, no markdown, no explanation:
{
    "company_size": "standardized range or empty string",
    "revenue": "standardized range or empty string",
    "sub_industry": "specific sub-industry label or empty string",
    "last_funding_type": "Series A, Series B, Seed, IPO, etc. or empty string",
    "last_funding_date": "YYYY-MM-DD or empty string",
    "last_funding_amount": "numeric string or empty string",
    "num_funding_rounds": "number as string or empty string",
    "total_funding": "numeric string or empty string",
    "growth_stage": "one of the standardized stages or empty string",
    "notes": "any relevant context or empty string",
    "confidence": "high/medium/low"
}"""


# ─── PROMPT BUILDERS (module-level for batch reuse) ───────────────────────────

def build_stage1_prompt(item):
    desc = item.get("Company Description", "")
    desc_short = (desc[:500] + "...") if len(desc) > 500 else desc
    company = item.get("Company", "")
    domain = item.get("Company Domain", "")
    return (
        f"Find firmographic data for this company:\n\n"
        f"Company: {company}\n"
        f"Domain: {domain}\n"
        f"Description: {desc_short}\n\n"
        f'Search for: "{company} headquarters location year founded {domain}"\n\n'
        f"Return JSON only."
    )


def build_stage2_prompt(item):
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


# ─── RESULT APPLIERS (module-level for batch reuse) ───────────────────────────

def apply_stage1_result(item, result):
    """Fill Stage 1 fields from Gemini result. Only fills blanks — preserves existing data."""
    if not item.get("HQ City", "").strip():
        item["HQ City"] = result.get("hq_city", "")
    if not item.get("HQ State", "").strip():
        item["HQ State"] = result.get("hq_state", "")
    if not item.get("HQ Country", "").strip():
        item["HQ Country"] = result.get("hq_country", "")
    if not item.get("Company_Year_Founded", "").strip():
        item["Company_Year_Founded"] = result.get("year_founded", "")
    if not item.get("Industry", "").strip():
        item["Industry"] = result.get("industry", "")


def apply_stage2_result(item, result):
    """Fill Stage 2 fields from Gemini result. Only fills blanks — preserves existing data."""
    if not item.get("CompanySizeNorm", "").strip():
        item["CompanySizeNorm"] = result.get("company_size", "")
    if not item.get("CompanyRevenueNorm", "").strip():
        item["CompanyRevenueNorm"] = result.get("revenue", "")
    if not item.get("Sub-Industry", "").strip():
        item["Sub-Industry"] = result.get("sub_industry", "")
    if not item.get("Last Funding Type", "").strip():
        item["Last Funding Type"] = result.get("last_funding_type", "")
    if not item.get("Last Funding Date", "").strip():
        item["Last Funding Date"] = result.get("last_funding_date", "")
    if not item.get("Last Funding Amount", "").strip():
        item["Last Funding Amount"] = result.get("last_funding_amount", "")
    if not item.get("Number of Funding Rounds", "").strip():
        item["Number of Funding Rounds"] = result.get("num_funding_rounds", "")
    if not item.get("Total Funding Amount", "").strip():
        item["Total Funding Amount"] = result.get("total_funding", "")
    if not item.get("Growth Stage", "").strip():
        item["Growth Stage"] = result.get("growth_stage", "")


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def read_csv(filepath):
    """Read CSV, return (headers, rows_as_dicts)."""
    with open(filepath, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        rows = list(reader)
    return headers, rows


def write_csv(filepath, headers, rows):
    """Write list of dicts to CSV."""
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def strip_json_fences(text):
    """Remove markdown code fences from Gemini response text."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def call_gemini(client, model, system_prompt, prompt, max_retries=3, grounding=True):
    """Call Gemini with optional search grounding. Retries on 429 with exponential backoff."""
    for attempt in range(max_retries + 1):
        try:
            config_kwargs = dict(
                system_instruction=system_prompt,
                temperature=0.1,
            )
            if grounding:
                config_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(**config_kwargs),
            )
            text = strip_json_fences(response.text)
            return json.loads(text)

        except json.JSONDecodeError as e:
            return {"error": f"JSON parse: {e}", "raw": text[:300]}
        except Exception as e:
            err_str = str(e)
            if "429" in err_str and attempt < max_retries:
                wait = 30 * (2 ** attempt)  # 30s, 60s, 120s
                print(f"RATE LIMITED — waiting {wait}s (retry {attempt + 1}/{max_retries})...", end=" ", flush=True)
                time.sleep(wait)
                continue
            return {"error": err_str}


def load_checkpoint(stage_label):
    """Load set of already-processed domains from checkpoint file."""
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    cp_file = CHECKPOINT_DIR / f"{stage_label}_progress.json"
    if cp_file.exists():
        with open(cp_file, "r") as f:
            data = json.load(f)
        return set(data.get("processed_domains", [])), data.get("results", [])
    return set(), []


def save_checkpoint(stage_label, processed_domains, results):
    """Save processed domains and results to checkpoint file."""
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    cp_file = CHECKPOINT_DIR / f"{stage_label}_progress.json"
    with open(cp_file, "w") as f:
        json.dump({
            "processed_domains": list(processed_domains),
            "results": results,
            "last_updated": datetime.now().isoformat(),
            "count": len(processed_domains),
        }, f)


def clear_checkpoint(stage_label):
    """Remove checkpoint file after successful completion."""
    cp_file = CHECKPOINT_DIR / f"{stage_label}_progress.json"
    if cp_file.exists():
        cp_file.unlink()


def run_enrichment(items, client, model, system_prompt, build_prompt_fn, apply_result_fn, stage_label, grounding=True):
    """Generic enrichment loop with checkpoint/resume. Returns (enriched_items, error_items)."""
    already_done, saved_results = load_checkpoint(stage_label)
    if already_done:
        print(f"  Resuming from checkpoint: {len(already_done)} already processed")
        remaining = [it for it in items if it.get("Company Domain", "").strip().lower() not in already_done]
        print(f"  Remaining: {len(remaining)} of {len(items)}")
    else:
        remaining = items

    enriched = []
    errors = []
    processed_domains = set(already_done)
    checkpoint_results = list(saved_results)
    start_time = time.time()

    print(f"\nStarting {stage_label}: {len(remaining)} companies...\n")

    for i, item in enumerate(remaining):
        if i > 0 and i % BATCH_LOG_INTERVAL == 0:
            elapsed = time.time() - start_time
            rate = i / elapsed * 60
            remaining_count = len(remaining) - i
            remaining_time = remaining_count / (rate / 60) if rate > 0 else 0
            print(f"\n  --- [{i + len(already_done)}/{len(items)}] "
                  f"{rate:.0f}/min — ~{remaining_time/60:.0f}m remaining — "
                  f"pausing {PAUSE_BETWEEN_BATCHES}s ---\n")
            time.sleep(PAUSE_BETWEEN_BATCHES)

        company = item.get("Company", "?")
        domain = item.get("Company Domain", "?")
        total_progress = i + len(already_done) + 1

        print(f"  [{total_progress}/{len(items)}] {company} ({domain})...", end=" ", flush=True)

        prompt = build_prompt_fn(item)
        result = call_gemini(client, model, system_prompt, prompt, grounding=grounding)

        if "error" in result:
            print(f"ERROR: {result['error'][:60]}")
            errors.append({"domain": domain, "company": company, **result})
        else:
            confidence = result.get("confidence", "unknown")
            print(f"OK ({confidence})")
            apply_result_fn(item, result)
            enriched.append(item)
            checkpoint_results.append({"domain": domain, "company": company, **result})
            processed_domains.add(domain.strip().lower())
            save_checkpoint(stage_label, processed_domains, checkpoint_results)

        time.sleep(PAUSE_BETWEEN_CALLS)

    elapsed = time.time() - start_time
    total_done = len(enriched) + len(already_done)
    print(f"\n{'='*50}")
    print(f"{stage_label} COMPLETE")
    print(f"{'='*50}")
    print(f"Enriched this run: {len(enriched)}")
    print(f"Previously done:   {len(already_done)}")
    print(f"Total processed:   {total_done}")
    print(f"Errors this run:   {len(errors)}")
    print(f"Time this run:     {elapsed/60:.1f} minutes")

    if not remaining or i == len(remaining) - 1:
        clear_checkpoint(stage_label)
        print("  Checkpoint cleared (run complete)")

    return enriched, errors


# ─── BATCH API ────────────────────────────────────────────────────────────────

def submit_batch(client, model, items, system_prompt, build_prompt_fn, stage_label, grounding=True):
    """Build inline batch requests, submit job. Saves job info (with ordered domains) for collect phase."""
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    safe_label = stage_label.replace(" ", "_").replace("(", "").replace(")", "")

    # Build InlinedRequest list — system_instruction + tools go in per-request config
    print(f"Building {len(items)} inline requests...")
    inline_requests = []
    domains_ordered = []
    for item in items:
        domain = item.get("Company Domain", "").strip().lower()
        domains_ordered.append(domain)
        req_config_kwargs = dict(
            system_instruction=system_prompt,
            temperature=0.1,
        )
        if grounding:
            req_config_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
        inline_requests.append(
            types.InlinedRequest(
                contents=build_prompt_fn(item),
                config=types.GenerateContentConfig(**req_config_kwargs),
            )
        )

    # Submit batch job (inline — no file upload needed)
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    print(f"Submitting batch job ({len(inline_requests)} requests)...")
    job = client.batches.create(
        model=f"models/{model}",
        src=inline_requests,
        config={"display_name": f"enrich_{safe_label}_{ts}"},
    )
    print(f"Job name:  {job.name}")
    print(f"State:     {job.state.name}")

    # Save job info — domains list is ORDER-SENSITIVE (matches response index)
    job_info = {
        "job_name": job.name,
        "stage_label": stage_label,
        "model": model,
        "submitted_at": datetime.now().isoformat(),
        "item_count": len(items),
        "domains_ordered": domains_ordered,
    }
    job_info_path = CHECKPOINT_DIR / f"batchjob_{safe_label}.json"
    with open(job_info_path, "w") as f:
        json.dump(job_info, f, indent=2)

    print(f"\nJob info saved: {job_info_path.name}")
    print(f"Run 'python enrich.py collect' to check status and apply results.")
    return job.name


def collect_batch(client, stage_label="Stage 2"):
    """
    Poll batch job status. If succeeded, parse inline responses by index.
    Returns (results_dict, errors_list, job_info) or None if job not done yet.
    results_dict is keyed by domain (lowercase).
    """
    safe_label = stage_label.replace(" ", "_").replace("(", "").replace(")", "")
    job_info_path = CHECKPOINT_DIR / f"batchjob_{safe_label}.json"

    if not job_info_path.exists():
        candidates = sorted(CHECKPOINT_DIR.glob("batchjob_*.json"))
        if not candidates:
            print("No batch job found. Run 'python enrich.py stage2 --batch' first.")
            return None
        job_info_path = candidates[-1]
        print(f"Using: {job_info_path.name}")

    with open(job_info_path) as f:
        job_info = json.load(f)

    job_name = job_info["job_name"]
    domains_ordered = job_info.get("domains_ordered", [])
    print(f"Job:       {job_name}")
    print(f"Submitted: {job_info.get('submitted_at', 'unknown')}")
    print(f"Items:     {job_info.get('item_count', '?')}")

    batch_job = client.batches.get(name=job_name)
    state = batch_job.state.name
    print(f"State:     {state}")

    if state in ("JOB_STATE_PENDING", "JOB_STATE_RUNNING"):
        print("\nJob still in progress. Check back later.")
        return None

    if state != "JOB_STATE_SUCCEEDED":
        print(f"\nJob did not succeed: {state}")
        if hasattr(batch_job, "error"):
            print(f"Error: {batch_job.error}")
        return None

    # Parse inline responses — index matches domains_ordered
    inlined = batch_job.dest.inlined_responses
    print(f"\nParsing {len(inlined)} inline responses...")

    results = {}
    errors = []
    for i, resp in enumerate(inlined):
        domain = domains_ordered[i] if i < len(domains_ordered) else f"row_{i}"
        try:
            text = strip_json_fences(resp.response.text)
            result = json.loads(text)
            results[domain] = result
        except Exception as e:
            errors.append({"key": domain, "error": f"Parse error: {e}"})

    print(f"Parsed: {len(results)} success, {len(errors)} errors")
    return results, errors, job_info


# ─── STAGE 1: Easy Fields (Flash) ────────────────────────────────────────────

def run_stage1(limit=None, auto_yes=False, model_override=None, offset=0, batch=False, source_path=None, grounding=True):
    """Enrich Dataset 2 with HQ, Year Founded, Industry using Flash."""
    mode = "BATCH SUBMIT" if batch else "Interactive"
    print(f"=== STAGE 1: Basic Firmographics ({mode}) ===\n")

    src_file = source_path or STAGE1_SOURCE
    if not src_file.exists():
        print(f"ERROR: Source file not found: {src_file}")
        sys.exit(1)

    headers, rows = read_csv(src_file)
    print(f"Loaded {len(rows)} rows from {src_file.name}")

    needs_work = [r for r in rows if any(not r.get(f, "").strip() for f in STAGE1_FIELDS)]
    print(f"Rows needing enrichment: {len(needs_work)}")

    if offset:
        needs_work = needs_work[offset:]
        print(f"Offset: skipping first {offset} rows")
    if limit:
        needs_work = needs_work[:limit]
        print(f"Limited to {limit} rows")

    if not needs_work:
        print("Nothing to enrich!")
        return

    print("\nSample:")
    for item in needs_work[:5]:
        missing = [f for f in STAGE1_FIELDS if not item.get(f, "").strip()]
        print(f"  {item.get('Company', '?')} — missing: {', '.join(missing)}")

    model = model_override or FLASH_MODEL

    if batch:
        est_cost = len(needs_work) * 0.0015  # ~50% of Flash interactive cost
        print(f"\n~{len(needs_work)} batch requests | Est. cost: ~${est_cost:.2f} (50% off) | Model: {model}")
        if not auto_yes:
            confirm = input("Submit batch job? (y/n): ").strip().lower()
            if confirm != "y":
                print("Aborted.")
                return
        client = genai.Client(api_key=GEMINI_API_KEY)
        submit_batch(client, model, needs_work, STAGE1_SYSTEM, build_stage1_prompt, "Stage 1", grounding=grounding)
        return

    est_cost = len(needs_work) * 0.003
    print(f"\n~{len(needs_work)} API calls | Est. cost: ~${est_cost:.2f} | Model: {model}")
    if not auto_yes:
        confirm = input("Proceed? (y/n): ").strip().lower()
        if confirm != "y":
            print("Aborted.")
            return

    client = genai.Client(api_key=GEMINI_API_KEY)

    enriched, errors = run_enrichment(
        needs_work, client, model, STAGE1_SYSTEM,
        build_stage1_prompt, apply_stage1_result, "Stage 1",
        grounding=grounding,
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M")

    if errors:
        error_file = OUTPUT_DIR / f"stage1_errors_{ts}.csv"
        write_csv(error_file, ["domain", "company", "error", "raw"], errors)
        print(f"Errors: {error_file}")

    print(f"\nUpdating source CSV with enriched data...")
    write_csv(src_file, headers, rows)
    print(f"Source updated: {src_file}")

    if source_path is None:
        print(f"\nMerging Stage 1 results into full Company_Master CSV...")
        merge_into_full_cm(rows, headers)
        print(f"Merged: {FULL_CM_FILE}")
    else:
        print("  (--source provided — skipping merge_into_full_cm)")


def merge_into_full_cm(enriched_rows, enriched_headers):
    """Merge enriched Dataset 2 rows back into the full Company_Master CSV by domain."""
    if not FULL_CM_FILE.exists():
        print(f"ERROR: Full CM file not found: {FULL_CM_FILE}")
        return

    full_headers, full_rows = read_csv(FULL_CM_FILE)

    enriched_by_domain = {}
    for row in enriched_rows:
        domain = row.get("Company Domain", "").strip().lower()
        if domain:
            enriched_by_domain[domain] = row

    updated = 0
    for full_row in full_rows:
        domain = full_row.get("Company Domain", "").strip().lower()
        if domain in enriched_by_domain:
            enriched = enriched_by_domain[domain]
            for field in STAGE1_FIELDS:
                if not full_row.get(field, "").strip() and enriched.get(field, "").strip():
                    full_row[field] = enriched[field]
                    updated += 1

    print(f"  Updated {updated} field values across full CM")

    backup = FULL_CM_FILE.with_suffix(".backup.csv")
    if FULL_CM_FILE.exists():
        shutil.copy2(FULL_CM_FILE, backup)
        print(f"  Backup: {backup}")

    write_csv(FULL_CM_FILE, full_headers, full_rows)


# ─── STAGE 2: Hard Fields (Pro) ──────────────────────────────────────────────

def run_stage2(limit=None, auto_yes=False, model_override=None, offset=0, batch=False, source_path=None, grounding=True):
    """Enrich full Company_Master with funding, size, revenue."""
    mode = "BATCH SUBMIT" if batch else "Interactive"
    print(f"=== STAGE 2: Financial & Funding Data ({mode}) ===\n")

    src_file = source_path or FULL_CM_FILE
    if not src_file.exists():
        print(f"ERROR: Source file not found: {src_file}")
        if source_path is None:
            print("Run Stage 1 first to create the merged file.")
        sys.exit(1)

    headers, rows = read_csv(src_file)
    print(f"Loaded {len(rows)} rows from {src_file.name}")

    needs_work = [r for r in rows if any(not r.get(f, "").strip() for f in STAGE2_FIELDS)]
    print(f"Rows needing enrichment: {len(needs_work)}")

    if offset:
        needs_work = needs_work[offset:]
        print(f"Offset: skipping first {offset} rows")
    if limit:
        needs_work = needs_work[:limit]
        print(f"Limited to {limit} rows")

    if not needs_work:
        print("Nothing to enrich!")
        return

    print("\nSample:")
    for item in needs_work[:5]:
        missing = [f for f in STAGE2_FIELDS if not item.get(f, "").strip()]
        print(f"  {item.get('Company', '?')} — missing {len(missing)} fields")

    model = model_override or PRO_MODEL

    if batch:
        # Batch mode: build JSONL, upload, submit job
        est_cost = len(needs_work) * 0.0075  # ~50% of Pro+search interactive cost
        print(f"\n~{len(needs_work)} batch requests | Est. cost: ~${est_cost:.2f} (50% off) | Model: {model}")
        if not auto_yes:
            confirm = input("Submit batch job? (y/n): ").strip().lower()
            if confirm != "y":
                print("Aborted.")
                return
        client = genai.Client(api_key=GEMINI_API_KEY)
        submit_batch(client, model, needs_work, STAGE2_SYSTEM, build_stage2_prompt, "Stage 2", grounding=grounding)
        return

    # Interactive mode
    est_cost = len(needs_work) * 0.015
    print(f"\n~{len(needs_work)} API calls | Est. cost: ~${est_cost:.2f} | Model: {model}")
    if not auto_yes:
        confirm = input("Proceed? (y/n): ").strip().lower()
        if confirm != "y":
            print("Aborted.")
            return

    client = genai.Client(api_key=GEMINI_API_KEY)

    stage_label = f"Stage 2 ({model})" if not offset else f"Stage 2 ({model}) [offset={offset}]"
    enriched, errors = run_enrichment(
        needs_work, client, model, STAGE2_SYSTEM,
        build_stage2_prompt, apply_stage2_result, stage_label,
        grounding=grounding,
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M")

    if errors:
        error_file = OUTPUT_DIR / f"stage2_errors_{ts}.csv"
        write_csv(error_file, ["domain", "company", "error", "raw"], errors)
        print(f"Errors: {error_file}")

    print(f"\nWriting updated CSV...")
    write_src_file = source_path or FULL_CM_FILE
    full_headers, full_rows = read_csv(write_src_file)

    enriched_by_domain = {r.get("Company Domain", "").strip().lower(): r for r in needs_work}
    updated = 0
    for full_row in full_rows:
        domain = full_row.get("Company Domain", "").strip().lower()
        if domain in enriched_by_domain:
            src = enriched_by_domain[domain]
            for field in STAGE2_FIELDS:
                if not full_row.get(field, "").strip() and src.get(field, "").strip():
                    full_row[field] = src[field]
                    updated += 1

    ts = datetime.now().strftime("%Y%m%d_%H%M")
    backup = write_src_file.with_name(f"{write_src_file.stem}_pre_stage2_backup_{ts}.csv")
    shutil.copy2(write_src_file, backup)
    print(f"  Backup: {backup}")

    write_csv(write_src_file, full_headers, full_rows)
    print(f"  Updated {updated} field values")
    print(f"  Output: {write_src_file}")


def run_stage2_collect(source_path=None):
    """Collect Stage 2 batch results and apply to full Company_Master CSV."""
    print("=== STAGE 2: Collecting Batch Results ===\n")

    write_file = source_path or FULL_CM_FILE
    if not write_file.exists():
        print(f"ERROR: File not found: {write_file}")
        sys.exit(1)

    client = genai.Client(api_key=GEMINI_API_KEY)
    outcome = collect_batch(client, "Stage 2")
    if outcome is None:
        return

    results, errors, job_info = outcome

    if not results:
        print("No results to apply.")
        return

    headers, full_rows = read_csv(write_file)
    print(f"\nApplying results to {write_file.name} ({len(full_rows)} rows)...")

    updated_fields = 0
    updated_rows = 0
    for row in full_rows:
        domain = row.get("Company Domain", "").strip().lower()
        if domain in results:
            before = sum(1 for f in STAGE2_FIELDS if not row.get(f, "").strip())
            apply_stage2_result(row, results[domain])
            after = sum(1 for f in STAGE2_FIELDS if not row.get(f, "").strip())
            filled = before - after
            if filled > 0:
                updated_fields += filled
                updated_rows += 1

    print(f"Updated: {updated_rows} rows, {updated_fields} fields filled")

    ts = datetime.now().strftime("%Y%m%d_%H%M")
    backup = write_file.with_name(f"{write_file.stem}_pre_batch_collect_{ts}.csv")
    shutil.copy2(write_file, backup)
    print(f"Backup:  {backup}")

    write_csv(write_file, headers, full_rows)
    print(f"Written: {write_file}")

    if errors:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        error_file = OUTPUT_DIR / f"batch_stage2_errors_{ts}.csv"
        write_csv(error_file, ["key", "error"], errors)
        print(f"Errors:  {error_file} ({len(errors)} rows)")

    print("\nDone!")


def run_stage1_collect(source_path=None):
    """Collect Stage 1 batch results and apply Stage 1 fields to source CSV."""
    print("=== STAGE 1: Collecting Batch Results ===\n")

    write_file = source_path or STAGE1_SOURCE
    if not write_file.exists():
        print(f"ERROR: File not found: {write_file}")
        sys.exit(1)

    client = genai.Client(api_key=GEMINI_API_KEY)
    outcome = collect_batch(client, "Stage 1")
    if outcome is None:
        return

    results, errors, job_info = outcome

    if not results:
        print("No results to apply.")
        return

    headers, rows = read_csv(write_file)
    print(f"\nApplying results to {write_file.name} ({len(rows)} rows)...")

    updated_fields = 0
    updated_rows = 0
    for row in rows:
        domain = row.get("Company Domain", "").strip().lower()
        if domain in results:
            before = sum(1 for f in STAGE1_FIELDS if not row.get(f, "").strip())
            apply_stage1_result(row, results[domain])
            after = sum(1 for f in STAGE1_FIELDS if not row.get(f, "").strip())
            filled = before - after
            if filled > 0:
                updated_fields += filled
                updated_rows += 1

    print(f"Updated: {updated_rows} rows, {updated_fields} fields filled")

    ts = datetime.now().strftime("%Y%m%d_%H%M")
    backup = write_file.with_name(f"{write_file.stem}_pre_stage1_collect_{ts}.csv")
    shutil.copy2(write_file, backup)
    print(f"Backup:  {backup}")

    write_csv(write_file, headers, rows)
    print(f"Written: {write_file}")

    if errors:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        error_file = OUTPUT_DIR / f"batch_stage1_errors_{ts}.csv"
        write_csv(error_file, ["key", "error"], errors)
        print(f"Errors:  {error_file} ({len(errors)} rows)")

    print("\nDone!")


# ─── ENTRY POINT ──────────────────────────────────────────────────────────────

def main():
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY not set.")
        print("  Create enrichment/.env with GEMINI_API_KEY=your_key")
        print("  Or: set environment variable GEMINI_API_KEY")
        sys.exit(1)

    args = sys.argv[1:]
    if not args:
        print("Usage:")
        print("  python enrich.py stage1                              # Flash — HQ, Year, Industry")
        print("  python enrich.py stage1 --batch                      # Flash — submit as Batch API job")
        print("  python enrich.py stage2                              # Pro — Funding, Size, Revenue (interactive)")
        print("  python enrich.py stage2 --batch                      # Pro — submit as Batch API job (50% cost)")
        print("  python enrich.py collect                             # Check Stage 2 batch job + apply results")
        print("  python enrich.py collect --stage stage1              # Check Stage 1 batch job + apply results")
        print("  python enrich.py stage1 --limit 10                   # Test with 10 rows")
        print("  python enrich.py stage2 --limit 5 --batch            # Test batch with 5 rows")
        print("  python enrich.py stage1 --source /path/to/file.csv  # Override source file")
        print("  python enrich.py stage2 --source /path/to/file.csv  # Override source file")
        print("  python enrich.py stage1 --no-grounding               # Disable search grounding")
        print("  python enrich.py stage2 --no-grounding               # Disable search grounding")
        print("")
        print("Parallel workers (interactive, split rows across processes):")
        print("  python enrich.py stage2 --model gemini-2.5-flash --offset 0    --limit 675 --yes")
        print("  python enrich.py stage2 --model gemini-2.5-flash --offset 675  --limit 675 --yes")
        print("  python enrich.py stage2 --model gemini-2.5-flash --offset 1350 --limit 675 --yes")
        print("  python enrich.py stage2 --model gemini-2.5-flash --offset 2025 --limit 750 --yes")
        sys.exit(0)

    stage = args[0].lower()
    limit = None
    offset = 0
    model_override = None
    source_path = None
    collect_stage = None
    auto_yes = "--yes" in args or "-y" in args
    batch_mode = "--batch" in args
    grounding = "--no-grounding" not in args

    if "--limit" in args:
        idx = args.index("--limit")
        if idx + 1 < len(args):
            limit = int(args[idx + 1])
    if "--offset" in args:
        idx = args.index("--offset")
        if idx + 1 < len(args):
            offset = int(args[idx + 1])
    if "--model" in args:
        idx = args.index("--model")
        if idx + 1 < len(args):
            model_override = args[idx + 1]
    if "--source" in args:
        idx = args.index("--source")
        if idx + 1 < len(args):
            source_path = Path(args[idx + 1])
    if "--stage" in args:
        idx = args.index("--stage")
        if idx + 1 < len(args):
            collect_stage = args[idx + 1].lower()

    if stage == "stage1":
        run_stage1(limit, auto_yes, model_override, offset, batch=batch_mode, source_path=source_path, grounding=grounding)
    elif stage == "stage2":
        run_stage2(limit, auto_yes, model_override, offset, batch=batch_mode, source_path=source_path, grounding=grounding)
    elif stage == "collect":
        if collect_stage == "stage1":
            run_stage1_collect(source_path=source_path)
        else:
            run_stage2_collect(source_path=source_path)
    else:
        print(f"Unknown command: {stage}. Use 'stage1', 'stage2', or 'collect'.")
        sys.exit(1)


if __name__ == "__main__":
    main()
