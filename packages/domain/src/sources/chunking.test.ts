import { describe, expect, it } from 'vitest';
import { SET_THEORY_SECTIONS, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import {
  MAX_SOURCE_BYTES,
  chunkDocument,
  estimateTokens,
  screenSource,
  summariseCoverage,
} from './chunking.js';

const validUpload = {
  mediaType: 'text/markdown',
  byteSize: SET_THEORY_SOURCE.length,
  text: SET_THEORY_SOURCE,
};

describe('source screening', () => {
  it('accepts a supported text document', () => {
    expect(screenSource(validUpload)).toBeUndefined();
  });

  it('rejects an unsupported type with a code the client can act on', () => {
    const rejection = screenSource({ ...validUpload, mediaType: 'application/pdf' });
    expect(rejection?.code).toBe('unsupported_media_type');
    expect(rejection?.message).toContain('application/pdf');
  });

  it('rejects a file over the size limit', () => {
    expect(screenSource({ ...validUpload, byteSize: MAX_SOURCE_BYTES + 1 })?.code).toBe(
      'file_too_large',
    );
  });

  it('rejects a binary or encrypted file mislabelled as text', () => {
    const binary = `PK${String.fromCharCode(0)}${String.fromCharCode(3)}`;
    expect(screenSource({ ...validUpload, text: binary })?.code).toBe('encrypted_or_unreadable');
  });

  it('rejects a document with no extractable text', () => {
    expect(screenSource({ ...validUpload, text: '   \n\n  ' })?.code).toBe('empty_document');
  });
});

describe('chunking', () => {
  const chunks = chunkDocument(SET_THEORY_SOURCE);

  it('gives every chunk a locator that names where it came from', () => {
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.locator).toMatch(/^§ /);
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('preserves the document’s section structure in the locators', () => {
    const locators = chunks.map((c) => c.locator).join(' | ');
    for (const section of SET_THEORY_SECTIONS) {
      expect(locators, `section "${section}" should be addressable`).toContain(section);
    }
  });

  it('numbers chunks contiguously from zero', () => {
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it('does not split mid-sentence when a section must be divided', () => {
    const long = `# One long section\n\n${'A sentence about relations. '.repeat(200)}`;
    const split = chunkDocument(long, { maxCharacters: 500 });
    expect(split.length).toBeGreaterThan(1);
    for (const chunk of split) {
      expect(chunk.text.trim().endsWith('.')).toBe(true);
    }
  });

  it('marks a split section as a slightly less precise citation', () => {
    const long = `# Long\n\n${'Paragraph text here.\n\n'.repeat(100)}`;
    const split = chunkDocument(long, { maxCharacters: 400 });
    expect(split.every((c) => c.locator.includes('part'))).toBe(true);
    expect(split.every((c) => c.extractionConfidence < 1)).toBe(true);
  });

  it('merges a section too short to stand alone into the next', () => {
    const document = '# Tiny\n\nShort.\n\n# Substantial\n\n' + 'Real content follows. '.repeat(20);
    const merged = chunkDocument(document);
    expect(merged).toHaveLength(1);
    // The earlier locator is kept, because that is where the material starts.
    expect(merged[0]?.locator).toBe('§ Tiny');
    expect(merged[0]?.text).toContain('Short.');
    expect(merged[0]?.text).toContain('Real content follows.');
  });

  it('addresses a document with no headings rather than refusing it', () => {
    const plain = 'Just some prose with no headings at all, long enough to stand on its own.';
    const [chunk] = chunkDocument(plain);
    expect(chunk?.locator).toBe('§ Document');
  });

  it('refuses to chunk an empty document', () => {
    expect(() => chunkDocument('   ')).toThrow(/empty document/i);
  });

  it('is deterministic, so extraction can be cached by checksum', () => {
    expect(chunkDocument(SET_THEORY_SOURCE)).toEqual(chunkDocument(SET_THEORY_SOURCE));
  });

  it('estimates tokens for budgeting', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('coverage summary', () => {
  const chunks = chunkDocument(SET_THEORY_SOURCE);

  it('reports which parts of the source the curriculum never drew on', () => {
    const summary = summariseCoverage(chunks, [0, 1, 2]);
    expect(summary.totalChunks).toBe(chunks.length);
    expect(summary.citedChunks).toBe(3);
    expect(summary.coverageRatio).toBeCloseTo(3 / chunks.length, 4);
    expect(summary.uncitedLocators).not.toHaveLength(0);
  });

  it('reports full coverage when everything was cited', () => {
    const summary = summariseCoverage(
      chunks,
      chunks.map((c) => c.ordinal),
    );
    expect(summary.coverageRatio).toBe(1);
    expect(summary.uncitedLocators).toEqual([]);
  });
});
