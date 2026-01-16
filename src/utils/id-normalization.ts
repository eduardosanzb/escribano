/**
 * ID Normalization Utilities
 */

/**
 * Normalizes a raw ID (e.g. from a folder name) by removing spaces and special characters.
 */
export function normalizeSessionId(rawId: string): string {
  return rawId
    .replace(/\s+/g, '-') // Spaces → hyphens
    .replace(/[()[\]{}]/g, '') // Remove brackets
    .replace(/—/g, '-') // Em-dash → hyphen
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
    .replace(/\.cap$/i, ''); // Remove .cap extension
}
