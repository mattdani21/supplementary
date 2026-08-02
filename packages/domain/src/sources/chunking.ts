/**
 * Source extraction and chunking.
 *
 * Chunking is by semantic section, not by character count. The reason is traceability: a lesson
 * claim must be traceable back to a page, heading, slide or timestamp in the original document,
 * and an arbitrary 1000-character window has no such address. A chunk that spans two sections
 * would cite the wrong one.
 *
 * Pure text in, chunks out — no I/O, so it is fully testable and cacheable by checksum.
 */

import { DomainError } from '../errors.js';

export interface ExtractedChunk {
  readonly ordinal: number;
  readonly text: string;
  /** Human-meaningful address: "§2 Subsets and set equality", "p. 12", "slide 4". */
  readonly locator: string;
  readonly extractionConfidence: number;
  readonly tokenEstimate: number;
}

export interface ChunkingOptions {
  /** Sections longer than this are split, keeping the section locator with a part suffix. */
  readonly maxCharacters?: number;
  /** Sections shorter than this are merged forward, to avoid a chunk that is only a heading. */
  readonly minCharacters?: number;
}

/** A byte that never appears in a real text document; its presence means binary or encrypted. */
const NULL_BYTE = String.fromCharCode(0);

const DEFAULTS = { maxCharacters: 1800, minCharacters: 120 } as const;

/** Rough token estimate. Only used for budgeting, so approximate is fine. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const SUPPORTED_MEDIA_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown'] as const;

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export type SourceRejection =
  | { code: 'unsupported_media_type'; message: string }
  | { code: 'file_too_large'; message: string }
  | { code: 'encrypted_or_unreadable'; message: string }
  | { code: 'empty_document'; message: string };

/**
 * Accept or reject an upload before any work is done on it. The rejection carries a stable code
 * so the client can show a specific message rather than "something went wrong".
 */
export const screenSource = (source: {
  mediaType: string;
  byteSize: number;
  text: string;
}): SourceRejection | undefined => {
  if (!(SUPPORTED_MEDIA_TYPES as readonly string[]).includes(source.mediaType)) {
    return {
      code: 'unsupported_media_type',
      message:
        `GapOS cannot read ${source.mediaType} yet. Supported types: ` +
        `${SUPPORTED_MEDIA_TYPES.join(', ')}.`,
    };
  }
  if (source.byteSize > MAX_SOURCE_BYTES) {
    return {
      code: 'file_too_large',
      message: `The file is ${Math.round(source.byteSize / 1_048_576)} MB; the limit is 10 MB.`,
    };
  }
  // A binary blob mislabelled as text: null bytes never appear in real text documents.
  if (source.text.includes(NULL_BYTE)) {
    return {
      code: 'encrypted_or_unreadable',
      message: 'The file appears to be encrypted or is not readable as text.',
    };
  }
  if (source.text.trim().length === 0) {
    return { code: 'empty_document', message: 'The file contains no extractable text.' };
  }
  return undefined;
};

interface Section {
  readonly heading: string;
  readonly text: string;
}

/**
 * Split on markdown headings. A document with no headings becomes one section addressed by
 * paragraph range, which is still a real locator — just a coarser one.
 */
const splitIntoSections = (text: string): Section[] => {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let heading = 'Document';
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body.length > 0) sections.push({ heading, text: body });
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
};

/**
 * Split an oversized paragraph at sentence boundaries.
 *
 * Needed because a source is not obliged to have paragraph breaks: a single unbroken wall of
 * text would otherwise produce one chunk far over the limit, which breaks token budgeting and
 * makes the citation useless. A sentence is the smallest unit that still reads as a claim, so
 * that is where the cut goes.
 */
const splitBySentence = (text: string, maxCharacters: number): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [text];
  const parts: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.length > maxCharacters) {
      parts.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim().length > 0) parts.push(current.trim());

  return parts;
};

/** Split a long section at paragraph boundaries, falling back to sentences, never mid-sentence. */
const splitLongSection = (text: string, maxCharacters: number): string[] => {
  if (text.length <= maxCharacters) return [text];

  const paragraphs = text.split(/\n\s*\n/);
  const parts: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) parts.push(trimmed);
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      flush();
      parts.push(...splitBySentence(paragraph, maxCharacters));
      continue;
    }
    if (current.length > 0 && current.length + paragraph.length + 2 > maxCharacters) {
      flush();
      current = paragraph;
    } else {
      current = current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  flush();

  return parts;
};

export const chunkDocument = (text: string, options: ChunkingOptions = {}): ExtractedChunk[] => {
  const maxCharacters = options.maxCharacters ?? DEFAULTS.maxCharacters;
  const minCharacters = options.minCharacters ?? DEFAULTS.minCharacters;

  if (text.trim().length === 0) {
    throw new DomainError('unsupported_source', 'Cannot chunk an empty document.');
  }

  const sections = splitIntoSections(text);

  // Merge a section too short to stand alone into the next one, keeping the earlier locator so
  // the citation still points at where the material starts.
  const merged: Section[] = [];
  for (const section of sections) {
    const previous = merged[merged.length - 1];
    if (previous && previous.text.length < minCharacters) {
      merged[merged.length - 1] = {
        heading: previous.heading,
        text: `${previous.text}\n\n${section.text}`,
      };
    } else {
      merged.push(section);
    }
  }

  const chunks: ExtractedChunk[] = [];
  for (const section of merged) {
    const parts = splitLongSection(section.text, maxCharacters);
    parts.forEach((part, index) => {
      chunks.push({
        ordinal: chunks.length,
        text: part,
        locator:
          parts.length > 1 ? `§ ${section.heading} (part ${index + 1})` : `§ ${section.heading}`,
        // A split section is a slightly less precise citation, and says so.
        extractionConfidence: parts.length > 1 ? 0.9 : 1,
        tokenEstimate: estimateTokens(part),
      });
    });
  }

  return chunks;
};

/**
 * A coverage summary the learner sees on the Sources tab: how much of the supplied material the
 * curriculum actually drew on. Low coverage is not an error, but it should be visible.
 */
export interface CoverageSummary {
  readonly totalChunks: number;
  readonly citedChunks: number;
  readonly coverageRatio: number;
  readonly uncitedLocators: readonly string[];
}

export const summariseCoverage = (
  chunks: readonly ExtractedChunk[],
  citedChunkOrdinals: readonly number[],
): CoverageSummary => {
  const cited = new Set(citedChunkOrdinals);
  const uncited = chunks.filter((c) => !cited.has(c.ordinal));
  return {
    totalChunks: chunks.length,
    citedChunks: chunks.length - uncited.length,
    coverageRatio:
      chunks.length === 0
        ? 0
        : Number(((chunks.length - uncited.length) / chunks.length).toFixed(4)),
    uncitedLocators: uncited.map((c) => c.locator),
  };
};
