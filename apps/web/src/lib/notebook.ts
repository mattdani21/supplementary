/**
 * Notebook rendering (E25 / GAP-083).
 *
 * The lesson package's `notebook` field is textbook-style markdown: headings, prose,
 * LaTeX math (inline `$...$`, display `$$...$$`), and at most one fenced ```diagram
 * block. This module parses it into a small block tree and renders each block to HTML
 * with `katex.renderToString` — pure, deterministic, server-safe, no browser APIs —
 * matching the repo's renderToStaticMarkup test pattern.
 *
 * A lesson without a `notebook` falls back to its `transcript` (plain text, no math
 * pass) — old 1.0.0 lessons keep working unchanged.
 */

import katex from 'katex';

export type NotebookBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly kind: 'paragraph'; readonly html: string }
  | { readonly kind: 'displayMath'; readonly tex: string }
  | { readonly kind: 'diagram'; readonly spec: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: string[] };

/** Split a text run into alternating plain and LaTeX segments on `$...$`. */
const splitInlineMath = (text: string): { readonly plain: string; readonly tex: string }[] => {
  const parts: { plain: string; tex: string }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\$([^$\n]+)\$/g)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ plain: text.slice(cursor, index), tex: '' });
    parts.push({ plain: '', tex: match[1] ?? '' });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ plain: text.slice(cursor), tex: '' });
  if (parts.length === 0) parts.push({ plain: text, tex: '' });
  return parts;
};

/** Render inline segments: plain text as-is, LaTeX through KaTeX. */
export const renderInline = (text: string): string =>
  splitInlineMath(text)
    .map((part) =>
      part.tex
        ? katex.renderToString(part.tex, { throwOnError: false })
        : part.plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    )
    .join('');

/** A diagram spec line: `A -> B` or `A - B` (simple two-node edges). */
const parseDiagram = (
  spec: string,
): { readonly nodes: string[]; readonly edges: [string, string][] } => {
  const nodes = new Set<string>();
  const edges: [string, string][] = [];
  for (const line of spec.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)\s*(->|→|-)\s*(.+)$/);
    if (match) {
      const from = match[1]!.trim();
      const to = match[3]!.trim();
      if (from && to) {
        nodes.add(from);
        nodes.add(to);
        edges.push([from, to]);
      }
    } else if (trimmed.length <= 40) {
      nodes.add(trimmed);
    }
  }
  return { nodes: [...nodes], edges };
};

/**
 * Render a simple token diagram as inline SVG (dark-theme friendly).
 *
 * Layout: nodes flow left-to-right in rows of at most NODES_PER_ROW (a long one-row strip
 * scales the whole viewBox down to unreadable on phones — the attention pipeline with 8
 * nodes used to render at ~3px effective text). Bigger boxes and a wider font keep the
 * diagram legible when the figure scales to the container.
 */
export const renderDiagramSvg = (spec: string): string => {
  const { nodes, edges } = parseDiagram(spec);
  const nodesPerRow = 4;
  const boxWidth = 150;
  const boxHeight = 46;
  const colGap = 160;
  const rowGap = 110;
  const margin = 60;
  const cols = Math.min(nodes.length, nodesPerRow);
  const rows = Math.max(1, Math.ceil(nodes.length / nodesPerRow));
  const width = Math.max(340, cols * colGap + margin + 25);
  const height = rows * rowGap + 30;
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const col = i % nodesPerRow;
    const row = Math.floor(i / nodesPerRow);
    positions.set(node, { x: margin + col * colGap, y: 40 + row * rowGap });
  });
  const edgeSvg = edges
    .map(([from, to]) => {
      const a = positions.get(from);
      const b = positions.get(to);
      if (!a || !b) return '';
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>`;
    })
    .join('');
  const nodeSvg = nodes
    .map((node) => {
      const p = positions.get(node);
      if (!p) return '';
      const escaped = node.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return (
        `<rect x="${p.x - boxWidth / 2}" y="${p.y - boxHeight / 2}" width="${boxWidth}" ` +
        `height="${boxHeight}" rx="10" fill="#121214" stroke="rgba(255,255,255,0.12)"/>` +
        `<text x="${p.x}" y="${p.y + 5}" text-anchor="middle" fill="rgba(255,255,255,0.85)" ` +
        `font-size="15" font-family="system-ui">${escaped}</text>`
      );
    })
    .join('');
  return (
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="diagram" xmlns="http://www.w3.org/2000/svg">` +
    edgeSvg +
    nodeSvg +
    `</svg>`
  );
};

/**
 * Parse notebook markdown into blocks. Handles `#`/`##`/`###` headings, blank-line
 * separated paragraphs, `$$...$$` display math, `- ` / `1. ` lists, and fenced
 * ```diagram blocks. Everything else is a paragraph.
 */
export const parseNotebook = (markdown: string): NotebookBlock[] => {
  const blocks: NotebookBlock[] = [];
  const lines = markdown.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Display math: $$...$$ on one or more lines
    if (trimmed.startsWith('$$')) {
      let tex = trimmed.slice(2);
      if (!tex.endsWith('$$')) {
        const rest: string[] = [];
        while (i + 1 < lines.length && !lines[i + 1]!.trim().endsWith('$$')) {
          rest.push(lines[i + 1]!);
          i += 1;
        }
        if (i + 1 < lines.length) {
          rest.push(lines[i + 1]!.trim().replace(/\$\$$/, ''));
          i += 1;
        }
        tex = [tex, ...rest].join('\n');
      } else {
        tex = tex.replace(/\$\$$/, '');
      }
      blocks.push({ kind: 'displayMath', tex: tex.trim() });
      i += 1;
      continue;
    }

    // Headings
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      });
      i += 1;
      continue;
    }

    // Fenced diagram
    if (trimmed.startsWith('```diagram')) {
      const spec: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        spec.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ kind: 'diagram', spec: spec.join('\n') });
      continue;
    }

    // Lists
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: false, items });
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: true, items });
      continue;
    }

    // Paragraph: collect until a blank line or a new structural marker
    const para: string[] = [trimmed];
    i += 1;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,3})\s+/.test(lines[i]!) &&
      !lines[i]!.trim().startsWith('$$') &&
      !lines[i]!.trim().startsWith('```') &&
      !/^[-*]\s+/.test(lines[i]!) &&
      !/^\d+\.\s+/.test(lines[i]!)
    ) {
      para.push(lines[i]!.trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', html: renderInline(para.join(' ')) });
  }
  return blocks;
};

/** Full notebook to HTML (server-renderable; the study page embeds it). */
export const notebookToHtml = (markdown: string): string => {
  const blocks = parseNotebook(markdown);
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return `<h${block.level} class="notebook__heading notebook__h${block.level}">${renderInline(block.text)}</h${block.level}>`;
        case 'paragraph':
          return `<p class="notebook__paragraph">${block.html}</p>`;
        case 'displayMath':
          return `<div class="notebook__math">${katex.renderToString(block.tex, { throwOnError: false, displayMode: true })}</div>`;
        case 'diagram':
          return `<figure class="notebook__diagram">${renderDiagramSvg(block.spec)}</figure>`;
        case 'list':
          return block.ordered
            ? `<ol class="notebook__list">${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`
            : `<ul class="notebook__list">${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`;
      }
    })
    .join('\n');
};
