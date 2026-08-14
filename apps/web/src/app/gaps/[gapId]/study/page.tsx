import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { AttemptForm, type AttemptQuestion } from '../../../../components/attempt-form';
import { AudioPlayer } from '../../../../components/audio-player';
import { WorkspaceTabs } from '../../../../components/workspace-tabs';
import { getLesson, todayView } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { viewerOwner } from '../../../../lib/viewer';

export const dynamic = 'force-dynamic';

interface ArtefactView {
  id: string;
  kind: 'audio' | 'transcript' | 'visual';
  mediaType: string;
}

interface LessonView {
  id: string;
  day: number;
  title: string;
  estimatedMinutes?: number;
  objectiveIds?: string[];
  questions: (AttemptQuestion & { answer?: string })[];
  artefacts: ArtefactView[];
}

export default async function StudyPage({ params }: { params: Promise<{ gapId: string }> }) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();

  const { today } = (await todayView(context, owner, gapId)) as {
    today: { lesson?: { lessonId: string } };
  };
  if (!today.lesson) {
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
      </main>
    );
  }

  const { lesson } = (await getLesson(context, owner, gapId, today.lesson.lessonId)) as {
    lesson: LessonView;
  };

  const sessionId = `web-${gapId}-${randomUUID().slice(0, 8)}`;
  const audio = lesson.artefacts.filter((a) => a.kind === 'audio');
  const transcripts = lesson.artefacts.filter((a) => a.kind === 'transcript');

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
          <p className="page-head__meta">~{lesson.estimatedMinutes} minutes</p>
        )}
      </header>

      <section className="card player-surface" aria-labelledby="listen-heading">
        <h2 id="listen-heading">Listen</h2>
        {audio.map((artefact) => (
          <AudioPlayer key={artefact.id} gapId={gapId} artefactId={artefact.id} />
        ))}
        {audio.length === 0 && <p className="muted">No audio for this lesson.</p>}
      </section>

      {transcripts.map((artefact) => (
        <section key={artefact.id} className="card" aria-labelledby="transcript-heading">
          <h2 id="transcript-heading">Transcript</h2>
          <p className="muted">Playback text</p>
          <p className="transcript__id">{artefact.id}</p>
        </section>
      ))}

      <section id="questions" className="practice-section" aria-labelledby="questions-heading">
        <h2 id="questions-heading">Questions</h2>
        {lesson.questions.map((question) => (
          <AttemptForm key={question.id} gapId={gapId} sessionId={sessionId} question={question} />
        ))}
        {lesson.questions.length === 0 && <p className="muted">No questions in this lesson.</p>}
      </section>
    </main>
  );
}
