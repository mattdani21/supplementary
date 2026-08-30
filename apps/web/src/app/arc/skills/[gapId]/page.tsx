import Link from 'next/link';
import { arcMapHandler } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { viewerOwner } from '../../../../lib/viewer';
import { ProgressRing } from '../../../../components/arc/progress-ring';

export const dynamic = 'force-dynamic';

interface MapView {
  gap: { id: string; title: string; status: string };
  progress: { percent: number; cleared: number; total: number };
  hero?: {
    objectiveId: string;
    capabilityStatement: string;
    etaMinutes: number;
    lessonDay?: number;
    lessonId?: string;
  };
  sequence: {
    objectiveId: string;
    capabilityStatement: string;
    state: 'cleared' | 'current' | 'later';
    lessonDay?: number;
  }[];
}

export default async function ArcSkillMapPage({ params }: { params: Promise<{ gapId: string }> }) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { map } = (await arcMapHandler(context, owner, gapId)) as { map: MapView };

  const current = map.sequence.find((item) => item.state === 'current');
  const currentIndex = map.sequence.findIndex((item) => item.state === 'current');

  return (
    <>
      <div className="arc-head">
        <Link className="arc-icon-button" href="/arc" aria-label="Go home">
          ←
        </Link>
        <div className="arc-head-copy">
          <p className="arc-eyebrow">Skill map</p>
          <h1>{map.gap.title}</h1>
        </div>
      </div>

      <div className="arc-map-intro">
        <ProgressRing percent={map.progress.percent} label="Skill map" size="large" />
        <div>
          <h2>Clear the gaps in order.</h2>
          <p>
            {map.progress.cleared} of {map.progress.total} objectives cleared — progress is earned
            by proof, never by listening alone.
          </p>
        </div>
      </div>

      {map.hero && (
        <div className="arc-next-gap">
          <p className="arc-eyebrow">
            {map.hero.lessonDay ? `Gap ${map.hero.lessonDay} · up next` : 'Up next'}
          </p>
          <h2>{map.hero.capabilityStatement}</h2>
          <p>Hear the idea, then make it tangible in a notebook proof.</p>
          <div className="arc-gap-eta">{map.hero.etaMinutes} min total · audio + notebook</div>
          <Link
            className="arc-primary"
            href={
              map.hero.lessonId ? `/arc/skills/${map.gap.id}/lesson` : `/arc/skills/${map.gap.id}`
            }
          >
            Start the proof →
          </Link>
        </div>
      )}

      <div className="arc-map-title">
        <h3>Your sequence</h3>
        <span>
          {map.progress.cleared} cleared · {map.progress.total} gaps
        </span>
      </div>

      <div className="arc-gap-list">
        {map.sequence.map((item, index) => (
          <button
            key={item.objectiveId}
            type="button"
            className={`arc-gap-item is-${item.state}`}
            onClick={() => {
              if (item.state === 'cleared' || item.state === 'current') {
                window.location.href = `/arc/skills/${map.gap.id}/lesson`;
              }
            }}
            disabled={item.state === 'later'}
          >
            <span className="arc-gap-marker">{item.state === 'cleared' ? '✓' : index + 1}</span>
            <span>
              <h4>{item.capabilityStatement}</h4>
              <p>
                {item.state === 'cleared'
                  ? 'Demonstrated with a proof'
                  : item.state === 'current'
                    ? 'Audio + notebook proof'
                    : 'Ready after the gap above'}
              </p>
            </span>
            <span className="arc-gap-status">
              {item.state === 'cleared'
                ? 'Cleared'
                : item.state === 'current'
                  ? currentIndex === index
                    ? 'Up next'
                    : 'In progress'
                  : 'Later'}
            </span>
          </button>
        ))}
      </div>

      {current === undefined && map.sequence.length > 0 && (
        <p className="arc-theory-text" style={{ marginTop: 18 }}>
          Every objective is cleared. Your proof ledger says it all — this skill is done.
        </p>
      )}
    </>
  );
}
