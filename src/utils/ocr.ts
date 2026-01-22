/**
 * OCR Text Cleanup Utilities
 *
 * Tesseract OCR picks up menu bar icons, status indicators, and other
 * non-textual elements. This module filters that garbage.
 *
 * TODO: Tune patterns based on real data analysis after Phase 3C
 */

// Patterns that indicate garbage (icons, symbols, status bar)
const GARBAGE_PATTERNS = [
  /^[^a-zA-Z0-9]{1,10}$/, // Only symbols (@ & © ® € etc)
  /^\d+%$/, // Percentages alone (43%)
  /^[a-z]$/i, // Single letters
  /^[\s\n]+$/, // Whitespace only
  /^(.)\1{2,}$/, // Entire line is 3+ repeated chars (eee, ---)
  /(.)\1{4,}/, // Line contains 5+ repeated chars (GPassssss, =====)
  /^© \d{2}\/\d{2}/, // System Clock: © 15/01 Thu...
  /^> [a-zA-Z ]+$/, // Window Title: > Google Chrome
  /^[|>]\s+/, // Window artifacts: | BSI, > Google
];

const UI_STOPWORDS = new Set([
  'All Bookmarks',
  'Zoho Mail',
  'Detected Language',
  'English',
  'New Chat',
  'cid', // Common OCR artifact
  'sh Twelv', // Truncated "English Twelve" or similar
]);

const MIN_LINE_LENGTH = 3;
const MIN_WORD_LENGTH = 3; // Require at least 3-letter sequences

/**
 * Clean OCR text by removing garbage lines
 * @param raw - Raw OCR text from Tesseract
 * @returns Cleaned text suitable for embedding
 */
export function cleanOcrText(raw: string): string {
  if (!raw || raw.trim().length === 0) return '';

  const cleaned: string[] = [];
  let lastLine = '';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    // Skip short lines
    if (trimmed.length < MIN_LINE_LENGTH) continue;

    // Skip duplicate consecutive lines (common in static UI)
    if (trimmed === lastLine) continue;

    // Skip exact UI stopwords
    if (UI_STOPWORDS.has(trimmed)) continue;

    // Skip garbage patterns
    if (GARBAGE_PATTERNS.some((p) => p.test(trimmed))) continue;

    // Keep if has at least one word-like sequence (3+ letters)
    // We use a RegExp to find sequences of letters
    const hasWord = new RegExp(`[a-zA-Z]{${MIN_WORD_LENGTH},}`).test(trimmed);
    if (hasWord) {
      cleaned.push(trimmed);
      lastLine = trimmed;
    }
  }

  return cleaned.join('\n');
}

/**
 * Check if cleaned OCR text is meaningful enough for embedding
 * @param cleanedText - Already cleaned OCR text
 * @returns true if text has substantial content
 */
export function isOcrMeaningful(cleanedText: string): boolean {
  if (!cleanedText) return false;

  // At least 20 chars of cleaned text
  if (cleanedText.length < 20) return false;

  // At least 3 lines of content
  const lines = cleanedText.split('\n').filter((l) => l.trim().length > 0);
  return lines.length >= 3;
}
