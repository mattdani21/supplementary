import Link from 'next/link';
import { EmptyState } from '../../components/empty-state';
import { ReviewButtons } from '../../components/review-buttons';
import { reviewQueue } from '../../server/api';
import { getServerContext } from '../../server/bootstrap';
import { viewerOwner } from '../../lib/viewer';

export const dynamic = 'force-dynamic';

const SEVERITY_CHIP: Record<string, string> = {
  critical: 'severity-chip severity-chip--critical',
  high: 'severity-chip severity-chip--high',
  medium: 'severity-chip severity-chip--medium',
  low: 'severity-chip severity-chip--low',
};

export default async function ReviewPage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { items } = await reviewQueue(context, owner);

  const pending = items.filter((item) => !item.reviewStatus);
  const decided = items.filter((item) => item.reviewStatus);

  return (
    <main>
      <Link href="/gaps" className="back-link">
        ← Gaps
      </Link>
      <header className="page-head">
        <h1>Review queue</h1>
        <p className="page-head__meta">
          {pending.length} lesson{pending.length === 1 ? '' : 's'} flagged by audit findings.
        </p>
      </header>

      {pending.map((item) => (
        <section key={item.lessonId} className="card review-card">
          <div className="row">
            <h2>
              Day {item.day}: {item.lessonTitle}
            </h2>
          </div>
          <p className="muted">
            {item.gapTitle} · <Link href={`/gaps/${item.gapId}/study`}>open lesson</Link>
          </p>
          <ul className="findings">
            {item.findings.map((finding, index) => (
              <li key={index} className="finding">
                <span className={SEVERITY_CHIP[finding.severity] ?? SEVERITY_CHIP.low}>
                  {finding.severity} · {finding.category}
                </span>
                <span>{finding.finding}</span>
              </li>
            ))}
          </ul>
          <ReviewButtons lessonId={item.lessonId} />
        </section>
      ))}

      {pending.length === 0 && (
        <EmptyState
          title="Queue is clear."
          body="Nothing waiting — every lesson is clean or decided."
          action={
            <Link href="/gaps" className="btn">
              Back to gaps
            </Link>
          }
        />
      )}

      {decided.length > 0 && (
        <>
          <h2>Decided</h2>
          <ul className="review-schedule">
            {decided.map((item) => (
              <li key={item.lessonId} className="card decided-row">
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
