"""
Reusable utility to cancel a hung Gemini batch job.

Usage:
  1. Set JOB_NAME below to the job ID from the batch submission output
     (format: "batches/XXXXXXXXXX")
  2. Run: python enrichment/cancel_batch.py

When to use:
  If a batch job stays in JOB_STATE_PENDING for more than 1-2 hours,
  the model string is likely invalid for the Batch API. Cancel, fix the
  model string, and resubmit. Only confirmed working batch model: gemini-2.5-pro.
"""
import io
import os
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from dotenv import load_dotenv
from google import genai

load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
JOB_NAME = "batches/YOUR_BATCH_JOB_ID"  # Replace with your actual batch job ID from the Gemini API

client = genai.Client(api_key=GEMINI_API_KEY)

print(f"Cancelling: {JOB_NAME}")
client.batches.cancel(name=JOB_NAME)
print("Done.")
