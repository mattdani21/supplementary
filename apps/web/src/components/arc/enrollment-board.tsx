'use client';

/**
 * Enrollment home: unlocked modules, spawned remediations, and the re-sit gate.
 */

import Link from 'next/link';

interface EnrollmentView {
  id: string;
  title: string;
  description: string;
  status: string;
  unlockedModuleIds: readonly string[];
  canResit: boolean;
  modules: readonly {
    id: string;
    title: string;
    order: number;
    unlocked: boolean;
    objectiveIds: readonly string[];
  }[];
  objectives: readonly {
    id: string;
    statement: string;
    required: boolean;
    placement?: 'placed' | 'unmet';
  }[];
  remediations: readonly {
    objectiveId: string;
    gapId: string;
    gapStatus: string;
    title: string;
  }[];
  latestPlacement?: {
    placedObjectiveIds: readonly string[];
    unmetObjectiveIds: readonly string[];
    unlockedModuleIds: readonly string[];
  };
}

export function EnrollmentBoard({ enrollment }: { enrollment: EnrollmentView }) {
  const unfinished = enrollment.remediations.filter((row) => row.gapStatus !== 'filled');
  const canOpenPlacement = unfinished.length === 0;

  return (
    <div className="arc-stack">
      <div className="arc-brief">
        <p className="arc-eyebrow">Syllabus</p>
        <h1>{enrollment.title}</h1>
        <p>{enrollment.description}</p>
      </div>

      <section className="arc-panel">
        <p className="arc-eyebrow">Next step</p>
        {unfinished.length > 0 ? (
          <>
            <h2>Clear these courses first</h2>
            <p className="arc-muted">
              Placement opens again when every supplementary course is filled on evidence.
            </p>
            <ul className="arc-skill-list">
              {unfinished.map((row) => (
                <li key={row.gapId} className="arc-skill-row">
                  <div className="arc-skill-copy">
                    <strong>{row.title}</strong>
                    <p className="arc-muted">Status: {row.gapStatus}</p>
                  </div>
                  <Link className="arc-primary" href={`/arc/skills/${row.gapId}/setup`}>
                    Open course
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2>{enrollment.latestPlacement ? 'Re-sit placement' : 'Take placement'}</h2>
            <p className="arc-muted">
              {enrollment.latestPlacement
                ? 'Supplementary courses are clear. Sit the exam again to unlock the next modules.'
                : 'A short exam finds what you already know before any course is compiled.'}
            </p>
            {canOpenPlacement ? (
              <Link className="arc-primary" href={`/arc/enrollments/${enrollment.id}/placement`}>
                {enrollment.latestPlacement ? 'Re-sit now' : 'Start placement'}
              </Link>
            ) : null}
          </>
        )}
      </section>

      <section className="arc-panel" aria-labelledby="modules-heading">
        <p className="arc-eyebrow">Path</p>
        <h2 id="modules-heading">Modules</h2>
        <ol className="arc-module-list">
          {enrollment.modules.map((module) => (
            <li key={module.id} className={module.unlocked ? 'is-unlocked' : 'is-locked'}>
              <strong>{module.title}</strong>
              <span className="arc-muted">
                {module.unlocked ? 'Unlocked' : 'Locked until placed'}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {enrollment.objectives.some((objective) => objective.placement) ? (
        <section className="arc-panel" aria-labelledby="objectives-heading">
          <p className="arc-eyebrow">Latest placement</p>
          <h2 id="objectives-heading">Objectives</h2>
          <ul className="arc-objective-list">
            {enrollment.objectives.map((objective) => (
              <li key={objective.id}>
                <span
                  className={
                    objective.placement === 'placed'
                      ? 'arc-tag arc-tag-mint'
                      : 'arc-tag arc-tag-amber'
                  }
                >
                  {objective.placement ?? 'pending'}
                </span>{' '}
                {objective.statement}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
