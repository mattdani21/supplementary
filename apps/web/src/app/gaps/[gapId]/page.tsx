import Link from 'next/link';
import type { Gap } from '@gapos/database';
import { SourceForm } from '../../../components/source-form';
import { TransitionButtons } from '../../../components/transition-buttons';
import { WorkspaceTabs, type WorkspaceTab } from '../../../components/workspace-tabs';
import { pillClass } from '../../../lib/status-pill';
import {
  ApiError,
  generationLog,
  getCurriculum,
  getGap,
  listSources,
  todayView,
} from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';
import { viewerOwner } from '../../../lib/viewer';

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

/** Sections that live on this page; the other workspace tabs are dedicated routes. */
const SECTION_TABS: Record<string, Extract<WorkspaceTab, 'sources' | 'curriculum'>> = {
  sources: 'sources',
  curriculum: 'curriculum',
};

const RUN_TONE: Record<string, string> = {
  complete: 'pill--ok',
  partial: 'pill--warn',
  failed: 'pill--error',
};

interface CurriculumLessonView {
  id: string;
  day: number;
  title: string;
  estimatedMinutes: number;
  publicationStatus: string;
  questions: { id: string }[];
  artefacts: { id: string }[];
}

interface CurriculumView {
  id: string;
  plan: {
    objectives: {
      id: string;
      capabilityStatement: string;
      required: boolean;
      prerequisiteObjectiveIds: string[];
    }[];
  };
}

export default async function GapDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ gapId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gapId } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = SECTION_TABS[String(tabParam ?? '')] ?? 'overview';

  const owner = await viewerOwner();
  const context = await getServerContext();

  const { gap } = (await getGap(context, owner, gapId)) as { gap: Gap };
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

  // Overview carries the generation log; the Curriculum tab loads the compiled plan. Each is
  // fetched only when its tab is open, so a draft gap never crashes the workspace.
  const { log } =
    tab === 'overview'
      ? await generationLog(context, owner, gapId)
      : { log: { run: undefined, steps: [], findings: [] } };

  const curriculumData =
    tab === 'curriculum'
      ? await getCurriculum(context, owner, gapId).catch((error: unknown) =>
          error instanceof ApiError && error.status === 404 ? null : Promise.reject(error),
        )
      : null;
  const curriculum = curriculumData as {
    curriculum: CurriculumView;
    lessons: CurriculumLessonView[];
  } | null;

  const transitions = TRANSITIONS[gap.status] ?? [];

  return (
    <main>
      <Link href="/gaps" className="back-link">
        ← Gaps
      </Link>
      <WorkspaceTabs gapId={gapId} active={tab} />

      {tab === 'overview' && (
        <>
          <header className="page-head">
            <div className="row page-head__row">
              <h1>{gap.title}</h1>
              <TransitionButtons gapId={gapId} available={transitions} />
            </div>
            <p className="page-head__meta">
              <span className={pillClass(gap.status)}>{gap.status}</span>
            </p>
          </header>

          <p className="statement">{gap.rawStatement}</p>

          {today.lesson ? (
            <Link href={`/gaps/${gapId}/study`} className="continue-card">
              <span className="continue-card__body">
                <span className="continue-card__kicker">Today</span>
                <span className="continue-card__title">
                  Day {today.lesson.day} — {today.lesson.title}
                </span>
                <span className="continue-card__meta">{today.totalItems} items</span>
              </span>
              <span className="continue-card__chevron" aria-hidden="true">
                →
              </span>
            </Link>
          ) : (
            gap.status === 'active' && <p className="muted">No lesson due today.</p>
          )}

          <p className="muted">
            <Link href={`/gaps/${gapId}/mastery`}>Mastery</Link> ·{' '}
            <Link href={`/gaps/${gapId}/map`}>Knowledge map</Link>
          </p>

          <section className="card log-card" aria-labelledby="log-heading">
            <div className="log-card__head">
              <h2 id="log-heading">Generation log</h2>
              {log.run && (
                <span className={`pill ${RUN_TONE[log.run.status] ?? ''}`}>{log.run.status}</span>
              )}
            </div>
            {!log.run ? (
              <p className="muted">
                Not compiled yet — add sources and compile the gap to see the pipeline here.
              </p>
            ) : (
              <ul className="log">
                {log.steps.map((step) => (
                  <li key={`${step.step}-${step.attempt}`} className="log-line">
                    <span className="log-line__step">{step.step}</span>
                    <span
                      className={
                        step.error ? 'log-line__state log-line__state--error' : 'log-line__state'
                      }
                    >
                      {step.state}
                      {step.attempt > 1 ? ` (attempt ${step.attempt})` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {log.findings.length > 0 && (
              <p className="muted">
                {log.findings.length} audit finding{log.findings.length === 1 ? '' : 's'} — see the
                review queue.
              </p>
            )}
          </section>
        </>
      )}

      {tab === 'sources' && (
        <>
          <header className="page-head">
            <h1>Sources</h1>
            <p className="page-head__meta">Material the planner builds from.</p>
          </header>

          {sources.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state__title">No sources yet.</p>
              <p className="empty-state__body">
                The planner needs material to build from — paste notes, a chapter or a transcript
                below.
              </p>
            </div>
          ) : (
            <ul className="source-list">
              {sources.map((source) => (
                <li key={source.id} className="card source-row">
                  <div className="source-row__head">
                    <strong>{source.filename}</strong>
                    <span
                      className={source.processingStatus === 'ready' ? 'chip chip--accent' : 'chip'}
                    >
                      {source.processingStatus}
                    </span>
                  </div>
                  <div className="source-row__chips">
                    <span className="chip">{source.chunks.length} chunks</span>
                    {source.chunks.slice(0, 4).map((chunk) => (
                      <span key={chunk.id} className="chip">
                        {chunk.id}
                      </span>
                    ))}
                  </div>
                  {source.chunks.length > 0 && (
                    <details className="source-row__chunks">
                      <summary>Preview chunks</summary>
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
          )}

          <SourceForm gapId={gapId} />
        </>
      )}

      {tab === 'curriculum' && (
        <>
          <header className="page-head">
            <h1>Curriculum</h1>
            <p className="page-head__meta">The compiled plan for this gap.</p>
          </header>

          {!curriculum ? (
            <div className="empty-state">
              <p className="empty-state__title">No curriculum yet.</p>
              <p className="empty-state__body">
                Compile the gap first — the plan, lessons and practice items appear here.
              </p>
            </div>
          ) : (
            <>
              <h2>Objectives</h2>
              <ul className="objective-list">
                {curriculum.curriculum.plan.objectives.map((objective) => (
                  <li key={objective.id} className="card objective-row">
                    <div className="objective-row__head">
                      <span className="objective-row__label">{objective.capabilityStatement}</span>
                      {objective.required && <span className="pill pill--accent">required</span>}
                    </div>
                    {objective.prerequisiteObjectiveIds.length > 0 && (
                      <p className="objective-row__missing">
                        Needs: {objective.prerequisiteObjectiveIds.join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              <h2>Lessons</h2>
              <ul className="track-list">
                {curriculum.lessons.map((lesson) => (
                  <li key={lesson.id}>
                    <Link href={`/gaps/${gapId}/study`} className="track-row">
                      <span className="track-row__main">
                        <span className="track-row__title">
                          Day {lesson.day} — {lesson.title}
                        </span>
                        <span className="track-row__capability">
                          {lesson.questions.length} questions · {lesson.artefacts.length} artefacts
                          · ~{lesson.estimatedMinutes} min
                        </span>
                      </span>
                      <span className="track-row__meta">
                        <span
                          className={
                            lesson.publicationStatus === 'published' ? 'pill pill--ok' : 'pill'
                          }
                        >
                          {lesson.publicationStatus}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
