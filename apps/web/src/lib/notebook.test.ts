/**
 * Notebook rendering (E25 / GAP-083): parse + render tests.
 *
 * Pure-function tests in the repo's deterministic pattern (renderToStaticMarkup / string
 * assertions, no browser). Covers the acceptance criteria:
 *  - a LaTeX expression renders as math, not raw text;
 *  - a diagram block renders an SVG;
 *  - headings, lists and paragraphs parse to the expected blocks.
 */

import { describe, expect, it } from 'vitest';
import { notebookToHtml, parseNotebook, renderDiagramSvg, renderInline } from './notebook';

describe('parseNotebook', () => {
  it('parses headings, paragraphs, lists and display math into blocks', () => {
    const blocks = parseNotebook(
      [
        '# Attention',
        '',
        'The scaling factor matters.',
        '',
        '$$\\\\sqrt{d_k}$$',
        '',
        '- first',
        '- second',
        '',
        'Plain paragraph.',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'displayMath',
      'list',
      'paragraph',
    ]);
    const heading = blocks[0];
    expect(heading?.kind).toBe('heading');
    if (heading?.kind === 'heading') expect(heading.level).toBe(1);
  });

  it('parses a fenced diagram block', () => {
    const blocks = parseNotebook(['```diagram', 'Input -> Q', 'Input -> K', '```'].join('\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('diagram');
    if (blocks[0]!.kind === 'diagram') {
      expect(blocks[0]!.spec).toContain('Input -> Q');
    }
  });

  it('treats a lesson without notebook (transcript fallback) as plain text', () => {
    // The fallback path renders the transcript as a single paragraph — no math pass.
    const html = notebookToHtml('Today we look at relations.');
    expect(html).toContain('Today we look at relations.');
    expect(html).not.toContain('katex');
  });
});

describe('renderInline', () => {
  it('renders LaTeX math instead of raw text', () => {
    const html = renderInline('The scaling factor is $\\sqrt{d_k}$ here.');
    expect(html).toContain('katex');
    expect(html).toContain('sqrt');
    expect(html).not.toContain('$\\sqrt{d_k}$');
  });

  it('escapes plain HTML in non-math segments', () => {
    const html = renderInline('Use <b>not</b> & keep &amp; safe.');
    expect(html).not.toContain('<b>not</b>');
    expect(html).toContain('&lt;b&gt;not&lt;/b&gt;');
  });

  it('leaves text with no math untouched (escaped)', () => {
    const html = renderInline('plain words only');
    expect(html).toContain('plain words only');
  });
});

describe('notebookToHtml', () => {
  it('renders a full notebook with heading, math, diagram and list', () => {
    const markdown = [
      '# Attention',
      '',
      'Scale by $\\sqrt{d_k}$ so variance stays constant.',
      '',
      '$$\\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$',
      '',
      '```diagram',
      'Q -> Scores',
      'K -> Scores',
      '```',
      '',
      '- one',
      '- two',
    ].join('\n');
    const html = notebookToHtml(markdown);
    expect(html).toContain('class="notebook__heading');
    expect(html).toContain('class="notebook__math"');
    expect(html).toContain('class="notebook__diagram"');
    expect(html).toContain('<svg');
    expect(html).toContain('class="notebook__list"');
    expect(html).toContain('katex');
  });
});

describe('renderDiagramSvg', () => {
  it('renders nodes and edges as svg', () => {
    const svg = renderDiagramSvg('Input -> Q\nInput -> K\nQ -> Scores');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<line');
    expect(svg).toContain('Scores');
    expect(svg).toContain('role="img"');
  });
});
