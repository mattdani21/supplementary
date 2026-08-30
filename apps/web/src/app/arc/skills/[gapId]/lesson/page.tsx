import { randomUUID } from 'node:crypto';
import { arcLessonHandler } from '../../../../../server/api';
import { getServerContext } from '../../../../../server/bootstrap';
import { viewerOwner } from '../../../../../lib/viewer';
import { LessonTabs } from '../../../../../components/arc/lesson-tabs';

export const dynamic = 'force-dynamic';

interface LessonView {
  gap: { id: string; title: string };
  lesson: {
    lessonId: string;
    day: number;
    title: string;
    summary: string;
    script: string;
    estimatedMinutes: number;
    totalDays: number;
  };
  audio?: { artefactId: string; durationSeconds: number };
  transcript: string;
  notebook?: {
    questionId: string;
    prompt: string;
    starterCode: string;
    hint?: string;
  };
}

export default async function ArcLessonPage({ params }: { params: Promise<{ gapId: string }> }) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { lesson } = (await arcLessonHandler(context, owner, gapId)) as { lesson: LessonView };

  const sessionId = `arc-${gapId}-${randomUUID().slice(0, 8)}`;

  return (
    <LessonTabs
      gapId={gapId}
      sessionId={sessionId}
      gapTitle={lesson.gap.title}
      lesson={lesson.lesson}
      audio={lesson.audio}
      transcript={lesson.transcript}
      notebook={lesson.notebook}
      backHref={`/arc/skills/${gapId}`}
    />
  );
}
