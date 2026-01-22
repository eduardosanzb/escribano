import { describe, expect, it } from 'vitest';
import { cleanOcrText, isOcrMeaningful } from '../../utils/ocr.js';

describe('OCR Cleanup Utilities', () => {
  describe('cleanOcrText', () => {
    it('preserves valid content and short commands', () => {
      const input = 'git status\nnpm install\nThis is a valid sentence.';
      const output = cleanOcrText(input);
      expect(output).toContain('git status');
      expect(output).toContain('npm install');
      expect(output).toContain('This is a valid sentence.');
    });

    it('filters out system clock artifacts', () => {
      const input = '© 15/01 Thu 12:12\nActual Content';
      const output = cleanOcrText(input);
      expect(output).not.toContain('© 15/01');
      expect(output).toContain('Actual Content');
    });

    it('filters out window title artifacts', () => {
      const input = '> Google Chrome\nSome webpage content';
      const output = cleanOcrText(input);
      expect(output).not.toContain('> Google Chrome');
      expect(output).toContain('Some webpage content');
    });

    it('filters out repeated character garbage', () => {
      const input = 'eee\nGPassssss\nValid text';
      const output = cleanOcrText(input);
      expect(output).not.toContain('eee');
      expect(output).not.toContain('GPassssss');
      expect(output).toContain('Valid text');
    });

    it('filters out common UI bookmarks and status lines', () => {
      const input = 'All Bookmarks\nZoho Mail\nProject code here';
      const output = cleanOcrText(input);
      expect(output).not.toContain('All Bookmarks');
      expect(output).not.toContain('Zoho Mail');
      expect(output).toContain('Project code here');
    });

    it('filters out UI separators and indicators', () => {
      const input =
        '| BSI - Bundesamt f.\nDetected Language\nEnglish\nActual information';
      const output = cleanOcrText(input);
      expect(output).not.toContain('BSI - Bundesamt');
      expect(output).not.toContain('Detected Language');
      expect(output).not.toContain('English');
      expect(output).toContain('Actual information');
    });

    it('removes duplicate consecutive lines', () => {
      const input = 'Line 1\nLine 1\nLine 2\nLine 1';
      const output = cleanOcrText(input);
      const lines = output.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('Line 1');
      expect(lines[1]).toBe('Line 2');
      expect(lines[2]).toBe('Line 1');
    });

    it('filters out short garbage fragments while keeping short commands', () => {
      // 'cid' was found in DB, should be filtered if it doesn't look like a word
      // 'git' should be kept.
      const input = 'cid\ngit\nnpm\nsh Twelv';
      const output = cleanOcrText(input);
      expect(output).not.toContain('cid');
      expect(output).not.toContain('sh Twelv');
      expect(output).toContain('git');
      expect(output).toContain('npm');
    });
  });

  describe('isOcrMeaningful', () => {
    it('returns false for empty or very short text', () => {
      expect(isOcrMeaningful('')).toBe(false);
      expect(isOcrMeaningful('Too short')).toBe(false);
    });

    it('returns true for substantial content', () => {
      const content =
        'Line one of content\nLine two of content\nLine three of content';
      expect(isOcrMeaningful(content)).toBe(true);
    });
  });
});
