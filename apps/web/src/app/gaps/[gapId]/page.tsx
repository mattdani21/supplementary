import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Gap } from '@gapos/database';
import { SourceForm } from '../../../components/source-form';
import { TransitionButtons } from '../../../components/transition-buttons';
import { getGap, listSources, todayView } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';
import { viewerOwner } from '../../../lib/viewer';
import { isNotFoundError } from './error-guards';

export const dynamic = 'force-dynamic';

const TRANSITIONS: Record<string, { type: string; label: string }[]> = {
  draft: [{ type: 'define', label: 'Start' }],
  ready: [{ type: 'compile', label: 'Compile' }],
  compiling: [],
  active: [
    { type: 'request_mastery_check', label: 'Check mastery' },
    { type: 'archive', label: 'Archive' },
  ],
  failed: [{ type: 'retry_compilation', label: 'Retry compile' }],
  mastered: [{ type: 'reopen', label: 'Reopen' }],
};

export default async function GapDetailPage({ params }: { params: Promise<{ gapId: string }> }) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();

  let gap: Gap;
  try {
    ({ gap } = (await getGap(context, owner, gapId)) as { gap: Gap });
  } catch (error) {
    if (isNotFoundError(error)) notFound();
    throw error;
  }

  const { sources } = (await listSources(context, owner, gapId)) as {
    sources: {
      id: string;
      filename: string;
      processingStatus: string;
      chunks: { id: string; text: string }[];
    }[];
  };
  const { today } = (await todayView(context, owner, gapId)) as {
    today: { totalItems: number; lesson?: { lessonId: string; title: string; day: number } };
  };

  const transitions = TRANSITIONS[gap.status] ?? [];

  return (
    <main>
      <p>
        <Link href="/gaps">← all gaps</Link>
      </p>
      <header className="row">
        <h1>{gap.title}</h1>
        <TransitionButtons gapId={gapId} available={transitions} />
      </header>
      <p className="muted">Status: {gap.status}</p>
      <p className="statement">{gap.rawStatement}</p>

      {today.lesson && (
        <p>
          Today:{' '}
          <Link href={`/gaps/${gapId}/study`}>
            Day {today.lesson.day} — {today.lesson.title}
          </Link>{' '}
          · {today.totalItems} items
        </p>
      )}
      {!today.lesson && gap.status === 'active' && <p className="muted">No lesson due today.</p>}

      <p>
        <Link href={`/gaps/${gapId}/mastery`}>Mastery</Link> ·{' '}
        <Link href={`/gaps/${gapId}/map`}>Knowledge map</Link>
      </p>

      <h2>Sources</h2>
      {sources.length === 0 && (
        <p className="muted">No sources yet — the planner needs material.</p>
      )}
      <ul>
        {sources.map((source) => (
          <li key={source.id} className="card">
            <strong>{source.filename}</strong>{' '}
            <span className="muted">· {source.processingStatus}</span>
            {source.chunks.length > 0 && (
              <details>
                <summary>{source.chunks.length} chunks</summary>
                {source.chunks.slice(0, 6).map((chunk) => (
                  <p key={chunk.id} className="chunk">
                    {chunk.text}
                  </p>
                ))}
              </details>
            )}
          </li>
        ))}
      </ul>

      <SourceForm gapId={gapId} />
    </main>
  );
}
