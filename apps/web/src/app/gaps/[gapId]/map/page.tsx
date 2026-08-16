import Link from 'next/link';
import { EmptyState } from '../../../../components/empty-state';
import { GapNotFound } from '../../../../components/gap-not-found';
import { isGapNotFoundError } from '../../../../lib/gap-visibility';
import { knowledgeMap, type KnowledgeEdgeView, type KnowledgeNode } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { viewerOwner } from '../../../../lib/viewer';

export const dynamic = 'force-dynamic';

/**
 * Deterministic radial layout: the gap at the centre, capabilities in rings by BFS depth,
 * prerequisites upstream and taught capabilities downstream. Pure — the same inputs always
 * produce the same SVG, which keeps the map stable between renders.
 */
const layout = (
  nodes: KnowledgeNode[],
  edges: KnowledgeEdgeView[],
  centreId: string,
): Map<string, { x: number; y: number }> => {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(centreId, { x: 0, y: 0 });

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
  }

  const seen = new Set([centreId]);
  let ring = [centreId];
  const ringGap = 90;
  let depth = 0;
  while (ring.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const id of ring) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    const radius = depth * ringGap;
    next.forEach((id, index) => {
      const angle = (index / Math.max(next.length, 1)) * Math.PI * 2 - Math.PI / 2;
      positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    ring = next;
  }
  return positions;
};

export default async function KnowledgeMapPage({ params }: { params: Promise<{ gapId: string }> }) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();

  // A stale learner cookie (or a deleted gap) must never crash the map with a raw server
  // error — the designed not-found surface offers a one-tap reset (GAP-095).
  let nodes: KnowledgeNode[];
  let edges: KnowledgeEdgeView[];
  try {
    ({ nodes, edges } = await knowledgeMap(context, owner, gapId));
  } catch (error) {
    if (isGapNotFoundError(error)) {
      return (
        <main>
          <Link href={`/gaps/${gapId}`} className="back-link">
            ← Workspace
          </Link>
          <GapNotFound />
        </main>
      );
    }
    throw error;
  }

  const positions = layout(nodes, edges, gapId);
  const gapNode = nodes.find((node) => node.id === gapId);

  // A gap with no curriculum yet is a lone node with no links — a map with nothing to show.
  const isEmpty = nodes.length === 1 && edges.length === 0;

  return (
    <main>
      <Link href={`/gaps/${gapId}`} className="back-link">
        ← Workspace
      </Link>
      <header className="page-head">
        <h1>Knowledge map</h1>
        <p className="page-head__meta">
          {gapNode?.label} — {nodes.length} nodes, {edges.length} links. Click a gap node to open
          it.
        </p>
      </header>

      {isEmpty ? (
        <EmptyState
          title="No map yet."
          body="Compile the gap first — the capabilities it teaches and their prerequisites grow into this map."
          action={
            <Link href={`/gaps/${gapId}`} className="btn btn--primary">
              Open the workspace
            </Link>
          }
        />
      ) : (
        <svg viewBox="-400 -400 800 800" className="map" role="img" aria-label="Knowledge map">
          {edges.map((edge, index) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            return (
              <line
                key={index}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={
                  edge.relationship === 'prerequisite_of' ? 'var(--warn)' : 'var(--hairline-strong)'
                }
                strokeWidth="1.5"
              />
            );
          })}
          {nodes.map((node) => {
            const position = positions.get(node.id) ?? { x: 0, y: 0 };
            const isGap = node.kind === 'gap';
            return (
              <g key={node.id} transform={`translate(${position.x} ${position.y})`}>
                {isGap ? (
                  <a href={`/gaps/${node.id}`}>
                    <circle
                      r="14"
                      fill="var(--accent)"
                      stroke="var(--accent-hover)"
                      strokeWidth="1.5"
                    />
                    <title>{node.label}</title>
                  </a>
                ) : (
                  <circle
                    r="9"
                    fill="var(--surface-2)"
                    stroke="var(--hairline-strong)"
                    strokeWidth="1.5"
                  >
                    <title>{node.label}</title>
                  </circle>
                )}
                <text y="30" textAnchor="middle" fontSize="10" fill="var(--text-tertiary)">
                  {node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </main>
  );
}
