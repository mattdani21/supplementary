import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { AttemptForm, type AttemptQuestion } from '../../../../components/attempt-form';
import { AudioPlayer } from '../../../../components/audio-player';
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
        <p>
          <Link href={`/gaps/${gapId}`}>← gap</Link>
        </p>
        <h1>Nothing due today</h1>
        <p className="muted">Come back when a lesson is scheduled.</p>
      </main>
    );
  }

  const { lesson } = (await getLesson(context, owner, gapId, today.lesson.lessonId)) as {
    lesson: LessonView;
  };

  const sessionId = `web-${gapId}-${randomUUID().slice(0, 8)}`;

  return (
    <main>
      <p>
        <Link href={`/gaps/${gapId}`}>← gap</Link>
      </p>
      <h1>
        Day {lesson.day}: {lesson.title}
      </h1>
      {typeof lesson.estimatedMinutes === 'number' && (
        <p className="muted">~{lesson.estimatedMinutes} minutes</p>
      )}

      <section>
        <h2>Listen</h2>
        {lesson.artefacts
          .filter((a) => a.kind === 'audio')
          .map((artefact) => (
            <AudioPlayer key={artefact.id} gapId={gapId} artefactId={artefact.id} />
          ))}
        {lesson.artefacts.filter((a) => a.kind === 'audio').length === 0 && (
          <p className="muted">No audio for this lesson.</p>
        )}
      </section>

      {lesson.artefacts
        .filter((a) => a.kind === 'transcript')
        .map((artefact) => (
          <section key={artefact.id} className="card">
            <h2>Transcript</h2>
            <p className="muted">{artefact.id} — playback text</p>
          </section>
        ))}

      <section>
        <h2>Questions</h2>
        {lesson.questions.map((question) => (
          <AttemptForm key={question.id} gapId={gapId} sessionId={sessionId} question={question} />
        ))}
        {lesson.questions.length === 0 && <p className="muted">No questions in this lesson.</p>}
      </section>
    </main>
  );
}
