import Link from 'next/link';
import { ReviewButtons } from '../../components/review-buttons';
import { reviewQueue } from '../../server/api';
import { getServerContext } from '../../server/bootstrap';
import { viewerOwner } from '../../lib/viewer';

export const dynamic = 'force-dynamic';

const SEVERITY_COLOUR: Record<string, string> = {
  critical: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#94a3b8',
};

export default async function ReviewPage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { items } = await reviewQueue(context, owner);

  const pending = items.filter((item) => !item.reviewStatus);
  const decided = items.filter((item) => item.reviewStatus);

  return (
    <main>
      <p>
        <Link href="/gaps">← all gaps</Link>
      </p>
      <h1>Review queue</h1>
      <p className="muted">
        {pending.length} lesson{pending.length === 1 ? '' : 's'} flagged by audit findings.
      </p>

      {pending.map((item) => (
        <section key={item.lessonId} className="card">
          <h2>
            Day {item.day}: {item.lessonTitle}
          </h2>
          <p className="muted">
            {item.gapTitle} · <Link href={`/gaps/${item.gapId}/study`}>open lesson</Link>
          </p>
          <ul>
            {item.findings.map((finding, index) => (
              <li key={index} style={{ color: SEVERITY_COLOUR[finding.severity] ?? undefined }}>
                [{finding.severity} · {finding.category}] {finding.finding}
              </li>
            ))}
          </ul>
          <ReviewButtons lessonId={item.lessonId} />
        </section>
      ))}

      {pending.length === 0 && (
        <p className="muted">Nothing waiting — every lesson is clean or decided.</p>
      )}

      {decided.length > 0 && (
        <>
          <h2>Decided</h2>
          <ul>
            {decided.map((item) => (
              <li key={item.lessonId} className="card">
                <span className={item.reviewStatus === 'approved' ? 'ok' : 'error'}>
                  {item.reviewStatus === 'approved' ? '✓ approved' : '✗ rejected'}
                </span>{' '}
                Day {item.day}: {item.lessonTitle}
                {item.reviewNote && <p className="muted">Note: {item.reviewNote}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
