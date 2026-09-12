import Link from 'next/link';
import { arcProgressHandler } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';
import { viewerOwner } from '../../../lib/viewer';
import { ProgressRing } from '../../../components/arc/progress-ring';

export const dynamic = 'force-dynamic';

interface ProgressView {
  percent: number;
  filledGaps: number;
  totalGaps: number;
  weeklyMinutes: number;
  momentumDays: number;
  proofs: {
    objectiveId: string;
    capabilityStatement: string;
    gapId: string;
    gapTitle: string;
    recordedAt: Date;
  }[];
  needs: {
    gapId: string;
    gapTitle: string;
    objectiveId: string;
    capabilityStatement: string;
    missing: string[];
  }[];
}

const formatDate = (date: Date): string => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfToday - startOfDay) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default async function ArcProgressPage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { progress } = (await arcProgressHandler(context, owner)) as { progress: ProgressView };

  return (
    <>
      <div className="arc-head">
        <div className="arc-head-copy">
          <p className="arc-eyebrow">Your evidence</p>
          <h1>Progress</h1>
          <p>What you can demonstrate keeps growing.</p>
        </div>
        <Link className="arc-icon-button" href="/arc/profile" aria-label="Open profile">
          •••
        </Link>
      </div>

      <div className="arc-progress-hero">
        <ProgressRing percent={progress.percent} label="Overall" size="hero" />
        <div>
          <h2>Steady, useful progress.</h2>
          <p>Demonstrated proofs are worth more than a hundred passive lessons.</p>
        </div>
      </div>

      <div className="arc-stats">
        <div className="arc-stat">
          <strong>{progress.filledGaps}</strong>
          <span>gap{progress.filledGaps === 1 ? '' : 's'} filled</span>
        </div>
        <div className="arc-stat">
          <strong>{progress.weeklyMinutes}m</strong>
          <span>focused this week</span>
        </div>
        <div className="arc-stat">
          <strong>{progress.momentumDays}</strong>
          <span>days in motion</span>
        </div>
      </div>

      <div className="arc-progress-message">
        Progress is counted in gaps filled, with a proof behind each one. Arc keeps the next
        decision visible.
      </div>

      {progress.needs.length > 0 && (
        <section className="arc-progress-needs" aria-labelledby="arc-progress-needs-title">
          <div className="arc-section-heading">
            <h2 id="arc-progress-needs-title">Evidence still needed</h2>
            <span>next actions</span>
          </div>
          <div className="arc-proof-list">
            {progress.needs.map((need) => (
              <Link
                key={`${need.gapId}-${need.objectiveId}`}
                className="arc-proof-row"
                href={`/arc/skills/${need.gapId}`}
              >
                <span className="arc-proof-icon" aria-hidden="true">
                  →
                </span>
                <span>
                  <strong>{need.capabilityStatement}</strong>
                  <span>
                    {need.gapTitle}: {need.missing.join(' ')}
                  </span>
                </span>
                <span>Open map</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="arc-section-heading">
        <h2>Recent proofs</h2>
        <span className="arc-text-button">by evidence</span>
      </div>

      <div className="arc-proof-list">
        {progress.proofs.map((proof) => (
          <Link
            key={`${proof.objectiveId}-${proof.recordedAt.getTime()}`}
            className="arc-proof-row"
            href={`/arc/skills/${proof.gapId}`}
          >
            <span className="arc-proof-icon">✓</span>
            <span>
              <strong>{proof.capabilityStatement}</strong>
              <span>{proof.gapTitle}</span>
            </span>
            <time>{formatDate(new Date(proof.recordedAt))}</time>
          </Link>
        ))}
        {progress.proofs.length === 0 && (
          <p className="arc-theory-text">
            No proofs yet. Calibrate a skill and fill your first gap — the ledger starts there.
          </p>
        )}
      </div>
    </>
  );
}
