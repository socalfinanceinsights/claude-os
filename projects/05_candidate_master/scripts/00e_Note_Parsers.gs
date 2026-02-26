/**
 * 00e_Note_Parsers.gs
 * Extract structured data from Bullhorn note bodies (email, phone)
 *
 * PURPOSE: Regex-based extraction of candidate contact info from free-text notes
 * DEPENDENCIES: None
 *
 * NOTE: parseCompFromNote() and parseLocationFromNote() were removed 2026-02-08.
 * Comp and location extraction moved to Gemini enrichment (00f_Gemini_API.gs)
 * to eliminate false positives from recruiter signatures and HTML junk.
 */

/**
 * Parse email from note body
 * @param {string} noteBody - Text of note
 * @returns {string|null} - Email address or null
 */
function parseEmailFromNote(noteBody) {
  if (!noteBody) return null;

  // Standard email regex pattern
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

  // Find all emails in the note body
  const matches = noteBody.match(emailPattern);
  if (!matches) return null;

  // Excluded domains (internal/recruiter emails)
  const excludedDomains = ['bullhorn.com'];

  // Find first email that's NOT from excluded domains
  for (const email of matches) {
    const domain = email.toLowerCase().split('@')[1];
    if (!excludedDomains.includes(domain)) {
      return email.toLowerCase();
    }
  }

  return null; // All emails were from excluded domains
}

/**
 * Parse phone number from note body
 * @param {string} noteBody - Text of note
 * @returns {string|null} - Phone number or null
 */
function parsePhoneFromNote(noteBody) {
  if (!noteBody) return null;

  // Excluded phone numbers (internal/recruiter phones)
  const excludedPhones = [
    // Add phone numbers to exclude from parsing (e.g. your own numbers)
    // Format: '10digitnumber' (no dashes or spaces)
    // 'XXXXXXXXXX',
  ];

  // Phone number patterns (US format)
  const phonePatterns = [
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,           // 555-555-5555 or 5555555555
    /\(\d{3}\)\s?\d{3}[-.]?\d{4}/,             // (949) 428-0664
    /\b\d{3}\s\d{3}\s\d{4}\b/                  // 949 428 0664
  ];

  for (const pattern of phonePatterns) {
    const match = noteBody.match(pattern);
    if (match) {
      // Normalize to digits only
      const digits = match[0].replace(/\D/g, '');

      if (digits.length === 10 && !excludedPhones.includes(digits)) {
        // Format as XXX-XXX-XXXX
        return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
      }
    }
  }

  return null;
}
