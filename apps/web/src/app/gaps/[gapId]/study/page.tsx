import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { AttemptForm, type AttemptQuestion } from '../../../../components/attempt-form';
import { AudioPlayer } from '../../../../components/audio-player';
import { EmptyState } from '../../../../components/empty-state';
import { ExportControls } from '../../../../components/export-controls';
import { NotebookSection } from '../../../../components/notebook-section';
import { SourceLinks } from '../../../../components/source-links';
import { WorkspaceTabs } from '../../../../components/workspace-tabs';
import {
  getLesson,
  listAnnotations,
  listSources,
  nextLesson,
  todayView,
} from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { formatDuration } from '../../../../lib/audio';
import { notebookToHtml } from '../../../../lib/notebook';
import { viewerOwner } from '../../../../lib/viewer';

export const dynamic = 'force-dynamic';

interface ArtefactView {
  id: string;
  kind: 'audio' | 'transcript' | 'visual';
  mediaType: string;
  durationSeconds?: number;
  segmentOrdinal?: number;
}

interface LessonQuestionView {
  id: string;
  objectiveId: string;
  payload: {
    prompt: string;
    options?: string[];
    hint?: string;
    evidence: {
      basis: string;
      locators: readonly { sourceId: string; chunkId: string; locator: string }[];
    };
  };
}

interface LessonView {
  id: string;
  day: number;
  title: string;
  estimatedMinutes?: number;
  objectiveIds?: string[];
  questions: LessonQuestionView[];
  artefacts: ArtefactView[];
  package: {
    transcript: string;
    notebook?: string;
    pausePrompts?: { atSecond: number; prompt: string; expectedAnswer: string }[];
    evidence?: {
      basis: string;
      locators: readonly { sourceId: string; chunkId: string; locator: string }[];
    };
  };
}

export default async function StudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ gapId: string }>;
  searchParams?: Promise<{ lesson?: string }>;
}) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();
  const resolvedSearch = searchParams
    ? await searchParams.catch(() => ({ lesson: undefined }))
    : { lesson: undefined };
  const explicitLessonId = resolvedSearch.lesson;

  const { today } = (await todayView(context, owner, gapId)) as {
    today: { lesson?: { lessonId: string } };
  };
  const lessonIdForPage = explicitLessonId ?? today.lesson?.lessonId;
  if (!lessonIdForPage) {
    return (
      <main>
        <Link href={`/gaps/${gapId}`} className="back-link">
          ← Workspace
        </Link>
        <WorkspaceTabs gapId={gapId} active="learn" />
        <header className="page-head">
          <h1>Nothing due today</h1>
          <p className="page-head__meta">Come back when a lesson is scheduled.</p>
        </header>
        <EmptyState
          title="Nothing is due right now."
          body="The review queue fills as your course publishes — check back later or keep practising."
          action={
            <Link href={`/gaps/${gapId}`} className="btn">
              Open the workspace
            </Link>
          }
        />
      </main>
    );
  }

  const { lesson } = (await getLesson(context, owner, gapId, lessonIdForPage)) as {
    lesson: LessonView;
  };
  const { annotations } = (await listAnnotations(context, owner, lesson.id)) as {
    annotations: {
      id: string;
      lessonId: string;
      selection: string;
      explanation: string;
    }[];
  };
  const { next } = (await nextLesson(context, owner, gapId, lesson.id)) as {
    next: { day: number; lessonId: string; title: string } | undefined;
  };

  const { sources } = (await listSources(context, owner, gapId)) as {
    sources: { id: string; filename: string }[];
  };
  const sourceNames = new Map(sources.map((source) => [source.id, source.filename]));

  // The verified solution and its source locators are resolved server-side; only the feedback
  // surface ever shows them, after the attempt is graded. Questions are stored as envelopes
  // with a `payload` — the fields the practice form needs live inside it.
  const questions: AttemptQuestion[] = lesson.questions.map((question) => ({
    id: question.id,
    objectiveId: question.objectiveId,
    prompt: question.payload.prompt,
    ...(question.payload.options ? { options: question.payload.options } : {}),
    ...(question.payload.hint ? { hint: question.payload.hint } : {}),
    locators: question.payload.evidence.locators.map((locator) => ({
      sourceId: locator.sourceId,
      chunkId: locator.chunkId,
      locator: locator.locator,
      sourceName: sourceNames.get(locator.sourceId),
    })),
  }));

  const sessionId = `web-${gapId}-${randomUUID().slice(0, 8)}`;
  // Audio artefacts are per-segment; order them by their position in the lesson so the player
  // can auto-advance, scroll-sync the transcript and seek across the whole lesson (GAP-038).
  const audio = lesson.artefacts
    .filter((a) => a.kind === 'audio')
    .sort((a, b) => (a.segmentOrdinal ?? 0) - (b.segmentOrdinal ?? 0));
  const audioDurationLabel = formatDuration(
    audio.reduce((sum, artefact) => sum + (artefact.durationSeconds ?? 0), 0),
  );
  // The transcript ships inside the lesson package (it is never uploaded as a byte artefact) —
  // this is what the audio fallback points at when a segment cannot play.
  const transcriptText = lesson.package.transcript;

  // The checkpoint questions pause the audio until the learner responds (E24 US1, FR-004); the
  // correction surface shows the lesson's own source locators behind the expected answer.
  const pausePrompts = lesson.package.pausePrompts ?? [];
  const checkpointLocators = (lesson.package.evidence?.locators ?? []).map((locator) => ({
    sourceId: locator.sourceId,
    chunkId: locator.chunkId,
    locator: locator.locator,
    sourceName: sourceNames.get(locator.sourceId),
  }));

  return (
    <main>
      <Link href={`/gaps/${gapId}`} className="back-link">
        ← Workspace
      </Link>
      <WorkspaceTabs gapId={gapId} active="learn" />

      <header className="page-head">
        <p className="today__date">Day {lesson.day}</p>
        <h1>{lesson.title}</h1>
        {typeof lesson.estimatedMinutes === 'number' && (
          <p className="page-head__meta">
            ~{lesson.estimatedMinutes} minutes
            {audioDurationLabel ? ` · ${audioDurationLabel} audio` : ''}
          </p>
        )}
        <ExportControls gapId={gapId} lessonId={lesson.id} />
      </header>

      {/* The notebook is always on screen (GAP-091): no Listen/Read toggle. Audio lives in
          the floating dock below, and practice items open from the dock's Questions sheet —
          the learner never scrolls away from the lesson. */}
      <section className="card study-surface" aria-labelledby="study-heading">
        <h2 id="study-heading">Lesson</h2>
        <NotebookSection
          notebookHtml={lesson.package.notebook ? notebookToHtml(lesson.package.notebook) : ''}
          transcript={transcriptText}
          explain={{
            gapId,
            lessonId: lesson.id,
          }}
        />
        {pausePrompts.length > 0 && (
          <p className="muted checkpoint-note">
            <strong>Checkpoint:</strong> the lesson pauses at the question —{' '}
            {pausePrompts[0]!.prompt}
          </p>
        )}
        {/* Traceability is user-visible (E24 US2, C-07): the locators behind this lesson,
            one step from the source. A general-knowledge lesson carries the label. */}
        <SourceLinks
          gapId={gapId}
          basis={
            lesson.package.evidence?.basis === 'general_knowledge' ? 'general_knowledge' : 'source'
          }
          locators={checkpointLocators}
        />
        {annotations.length > 0 && (
          <div className="notebook-annotations" aria-label="Your pinned notes">
            <h3 className="notebook-annotations__title">Your notes</h3>
            {annotations.map((annotation) => (
              <blockquote key={annotation.id} className="notebook-annotation">
                <p className="notebook-annotation__selection">“{annotation.selection}”</p>
                <p className="notebook-annotation__body">{annotation.explanation}</p>
              </blockquote>
            ))}
          </div>
        )}
      </section>

      {audio.length > 0 ? (
        <AudioPlayer
          gapId={gapId}
          segments={audio.map((artefact) => ({
            artefactId: artefact.id,
            durationSeconds: artefact.durationSeconds,
          }))}
          transcript={transcriptText}
          pausePrompts={pausePrompts}
          checkpointLocators={checkpointLocators}
          questions={
            questions.length > 0
              ? {
                  count: questions.length,
                  children: questions.map((question) => (
                    <AttemptForm
                      key={question.id}
                      gapId={gapId}
                      sessionId={sessionId}
                      question={question}
                    />
                  )),
                }
              : undefined
          }
        />
      ) : (
        <section className="card" aria-labelledby="questions-heading">
          <h2 id="questions-heading">Questions</h2>
          {questions.length === 0 ? (
            <EmptyState
              title="No practice items yet."
              body="Compile the gap — verified practice items appear here once the course is published."
              action={
                <Link href={`/gaps/${gapId}`} className="btn">
                  Open the workspace
                </Link>
              }
            />
          ) : (
            questions.map((question) => (
              <AttemptForm
                key={question.id}
                gapId={gapId}
                sessionId={sessionId}
                question={question}
              />
            ))
          )}
        </section>
      )}

      {next && (
        <nav className="next-lesson" aria-label="Continue">
          <p className="next-lesson__meta">Up next · Day {next.day}</p>
          <Link
            href={`/gaps/${gapId}/study?lesson=${encodeURIComponent(next.lessonId)}`}
            className="btn"
          >
            Next: {next.title} →
          </Link>
        </nav>
      )}
    </main>
  );
}
