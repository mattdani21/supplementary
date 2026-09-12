import Link from 'next/link';
import { arcMapHandler } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { viewerOwner } from '../../../../lib/viewer';
import { ProgressRing } from '../../../../components/arc/progress-ring';
import { EmptyState, StatusMessage } from '@gapos/ui';

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
    missing: string[];
  }[];
}

export default async function ArcSkillMapPage({ params }: { params: Promise<{ gapId: string }> }) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { map } = (await arcMapHandler(context, owner, gapId)) as { map: MapView };

  const current = map.sequence.find((item) => item.state === 'current');
  const currentIndex = map.sequence.findIndex((item) => item.state === 'current');
  const repairPending = map.sequence.some(
    (item) => item.state !== 'cleared' && item.lessonDay === undefined,
  );

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

      {map.sequence.length === 0 && (
        <EmptyState
          eyebrow={
            map.gap.status === 'compiling'
              ? 'Compilation in progress'
              : map.gap.status === 'failed'
                ? 'Compilation stopped'
                : map.gap.status === 'archived'
                  ? 'Archived skill'
                  : 'Route setup'
          }
          title={
            map.gap.status === 'compiling'
              ? 'Arc is building the first verified lesson.'
              : map.gap.status === 'failed'
                ? 'Day 1 was not publishable yet.'
                : map.gap.status === 'archived'
                  ? 'This skill is no longer active.'
                  : 'This skill needs sources before the map can open.'
          }
          action={
            <Link
              className="arc-primary"
              href={
                map.gap.status === 'archived'
                  ? '/arc/skills'
                  : `/arc/skills/${map.gap.id}/setup`
              }
            >
              {map.gap.status === 'compiling'
                ? 'Check compile status'
                : map.gap.status === 'failed'
                  ? 'Review and retry'
                  : map.gap.status === 'archived'
                    ? 'Return to Skills'
                    : 'Review sources and compile'}
            </Link>
          }
        >
          {map.gap.status === 'compiling'
            ? 'The map appears as soon as Day 1 passes validation.'
            : map.gap.status === 'failed'
              ? 'Your brief and accepted sources are saved for a fresh attempt.'
              : map.gap.status === 'archived'
                ? 'Archived skills stay out of the active library and cannot be recompiled.'
                : 'Confirm the learning brief, choose the evidence boundary, and compile the route.'}
        </EmptyState>
      )}

      {map.sequence.length > 0 && (
        <>
          {map.gap.status === 'archived' && (
            <StatusMessage
              tone="warning"
              title="This skill is archived."
              action={
                <Link className="arc-secondary" href="/arc/skills">
                  Return to Skills
                </Link>
              }
            >
              The existing proof record is read-only.
            </StatusMessage>
          )}

          {repairPending && map.gap.status !== 'archived' && (
            <StatusMessage
              tone="warning"
              title="Part of this route still needs repair."
              action={
                <Link
                  className="arc-secondary"
                  href={
                    map.hero?.lessonId
                      ? `/arc/skills/${map.gap.id}/lesson`
                      : `/arc/skills/${map.gap.id}/setup`
                  }
                >
                  {map.hero?.lessonId ? 'Continue verified lesson' : 'Repair route'}
                </Link>
              }
            >
              Published lessons remain usable. Arc does not count unpublished objectives as
              mastery evidence.
            </StatusMessage>
          )}

          <div className="arc-map-intro">
            <ProgressRing percent={map.progress.percent} label="Skill map" size="large" />
            <div>
              <h2>Clear the gaps in order.</h2>
              <p>
                {map.progress.cleared} of {map.progress.total} objectives cleared — progress is
                earned by proof, never by listening alone.
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
                  map.hero.lessonId
                    ? `/arc/skills/${map.gap.id}/lesson`
                    : `/arc/skills/${map.gap.id}`
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
            {map.sequence.map((item, index) => {
              const contents = (
                <>
                  <span className="arc-gap-marker">
                    {item.state === 'cleared' ? '✓' : index + 1}
                  </span>
                  <span>
                    <h4>{item.capabilityStatement}</h4>
                    <p>
                      {item.state === 'cleared'
                        ? 'Demonstrated with a proof'
                        : item.state === 'current'
                          ? 'Audio + notebook proof'
                          : 'Ready after the gap above'}
                    </p>
                    {item.state === 'current' && item.missing.length > 0 && (
                      <ul className="arc-mastery-needs" aria-label="Evidence still needed">
                        {item.missing.slice(0, 2).map((requirement) => (
                          <li key={requirement}>{requirement}</li>
                        ))}
                      </ul>
                    )}
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
                </>
              );

              return item.state === 'later' ? (
                <div
                  key={item.objectiveId}
                  className={`arc-gap-item is-${item.state}`}
                  aria-label={`${item.capabilityStatement}. Available after the previous objective.`}
                >
                  {contents}
                </div>
              ) : (
                <Link
                  key={item.objectiveId}
                  className={`arc-gap-item is-${item.state}`}
                  href={`/arc/skills/${map.gap.id}/lesson`}
                  aria-label={`${item.capabilityStatement}. ${
                    item.state === 'cleared' ? 'Review lesson' : 'Start proof'
                  }.`}
                >
                  {contents}
                </Link>
              );
            })}
          </div>

          {current === undefined && map.sequence.length > 0 && (
            <StatusMessage
              tone="success"
              title="Every objective is cleared."
              action={
                <Link className="arc-primary" href="/arc/progress">
                  Open proof ledger →
                </Link>
              }
            >
              Your proof ledger says it all — this skill is filled and retained.
            </StatusMessage>
          )}
        </>
      )}
    </>
  );
}
