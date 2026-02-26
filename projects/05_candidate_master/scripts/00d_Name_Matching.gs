/**
 * 00d_Name_Matching.gs
 * Name normalization, fuzzy matching, UID generation, and string similarity
 *
 * PURPOSE: All name-related logic used across import, dedup, folder linking, and resume matching
 * DEPENDENCIES: None
 */

/**
 * Generate unique identifier for candidate
 * Priority: Email -> LinkedIn URL -> Name Hash
 * @param {Object} candidate - Candidate object with email, linkedin_url, full_name
 * @returns {string} - Unique identifier
 */
function generateUID(candidate) {
  if (candidate.email && candidate.email.trim() !== '') {
    return cleanId(candidate.email);
  }
  if (candidate.linkedin_url && candidate.linkedin_url.trim() !== '') {
    return cleanId(candidate.linkedin_url);
  }
  // Fallback to name hash
  const cleanName = candidate.full_name.toLowerCase().replace(/[^a-z]/g, '');
  const hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    cleanName,
    Utilities.Charset.US_ASCII
  );
  return hash
    .map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2))
    .join('')
    .substring(0, 16);
}

/**
 * Clean and normalize ID (email or URL)
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
function cleanId(text) {
  if (!text) return "";
  return text.trim().toLowerCase();
}

/**
 * Normalize name for matching (remove credentials, special chars)
 * @param {string} text - Name to normalize
 * @returns {string} - Normalized name
 */
function normalizeName(text) {
  if (!text) return "";

  // Remove credentials
  let cleaned = text
    .replace(/,?\s*(CPA|MBA|CMA|MPAc|ACCA|CIA|CFE|CFA)\s*/gi, '')
    .replace(/\([^)]*\)/g, '') // Remove anything in parentheses
    .trim();

  // Convert to lowercase, remove special chars
  cleaned = cleaned.toLowerCase().replace(/[^a-z\s]/g, '').trim();

  return cleaned;
}

/**
 * Normalize diacritics/accents in text (e.g., "Ozgec" from "Ozgec")
 * @param {string} text - Text with possible diacritics
 * @returns {string} - ASCII-normalized text
 */
function normalizeDiacritics(text) {
  if (!text) return '';

  return String(text)
    .normalize('NFD') // Decompose combined characters
    .replace(/[\u0300-\u036f]/g, ''); // Remove diacritical marks
}

/**
 * Fuzzy match two names using Levenshtein distance
 * Requires at least 2 DISTINCT candidate name parts to each match a folder name part.
 * Distance threshold scales with part length to prevent short-part false positives.
 * @param {string} candidateName - First name to match
 * @param {string} folderName - Second name to match
 * @returns {Object} - {match: boolean, score: number}
 */
function fuzzyMatchName(candidateName, folderName) {
  const cleanCandidate = normalizeName(candidateName);
  const cleanFolder = normalizeName(folderName);

  // Split into parts
  const candidateParts = cleanCandidate.split(/\s+/).filter(p => p.length > 0);
  const folderParts = cleanFolder.split(/\s+/).filter(p => p.length > 0);

  // Need at least 2 candidate parts to do part-based matching
  if (candidateParts.length < 2) {
    // Fall through to full-string comparison below
  } else {
    // Count how many DISTINCT candidate parts match at least one folder part.
    // Each cPart gets one vote max. Each fPart can only be claimed once.
    const usedFolderParts = new Set();
    let matchedCPartCount = 0;

    for (const cPart of candidateParts) {
      // Distance threshold scales with part length:
      // 1-3 chars: exact only (distance 0)
      // 4 chars: distance <= 1
      // 5+ chars: distance <= 2
      const maxDist = cPart.length <= 3 ? 0 : (cPart.length === 4 ? 1 : 2);

      let bestDist = Infinity;
      let bestIdx = -1;

      for (let fi = 0; fi < folderParts.length; fi++) {
        if (usedFolderParts.has(fi)) continue;
        const fPart = folderParts[fi];
        // Also apply length-based threshold to the folder part
        const fMaxDist = fPart.length <= 3 ? 0 : (fPart.length === 4 ? 1 : 2);
        const threshold = Math.min(maxDist, fMaxDist);

        const dist = levenshteinDistance(cPart, fPart);
        if (dist <= threshold && dist < bestDist) {
          bestDist = dist;
          bestIdx = fi;
        }
      }

      if (bestIdx >= 0) {
        usedFolderParts.add(bestIdx);
        matchedCPartCount++;
      }
    }

    if (matchedCPartCount >= 2) {
      return { match: true, score: 95 };
    }
  }

  // Fallback to full string comparison
  const distance = levenshteinDistance(cleanCandidate, cleanFolder);
  const maxLength = Math.max(cleanCandidate.length, cleanFolder.length);
  const score = maxLength > 0 ? ((maxLength - distance) / maxLength) * 100 : 0;

  return { match: score >= 85, score: Math.round(score) };
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate similarity score between two strings (0-1)
 * Uses Levenshtein distance ratio
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score (0 to 1)
 */
function calculateSimilarity(str1, str2) {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  if (maxLength === 0) return 1.0;

  return 1 - (distance / maxLength);
}
