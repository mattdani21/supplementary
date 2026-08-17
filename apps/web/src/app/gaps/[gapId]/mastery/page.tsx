import Link from 'next/link';
import { notFound } from 'next/navigation';
import { masteryView } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { viewerOwner } from '../../../../lib/viewer';
import { isMissingCurriculumError, isNotFoundError } from '../error-guards';

export const dynamic = 'force-dynamic';

interface MasteryAssessment {
  objectiveId: string;
  label?: string;
  mastered: boolean;
  confidence?: number;
  attempts?: number;
}

interface MasterySummary {
  assessments: MasteryAssessment[];
  masteredObjectiveIds: string[];
  requiredObjectiveIds: string[];
  readyToFill: boolean;
}

export default async function MasteryPage({ params }: { params: Promise<{ gapId: string }> }) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();

  let mastery: MasterySummary;
  try {
    ({ mastery } = (await masteryView(context, owner, gapId)) as { mastery: MasterySummary });
  } catch (error) {
    if (isMissingCurriculumError(error)) {
      return (
        <main>
          <p>
            <Link href={`/gaps/${gapId}`}>← gap</Link>
          </p>
          <h1>Mastery</h1>
          <p className="muted">
            This gap hasn&apos;t been compiled yet. Compile it to start measuring mastery.
          </p>
        </main>
      );
    }
    if (isNotFoundError(error)) notFound();
    throw error;
  }

  return (
    <main>
      <p>
        <Link href={`/gaps/${gapId}`}>← gap</Link>
      </p>
      <h1>Mastery</h1>

      <p>
        {mastery.readyToFill
          ? '🎉 Ready to fill — every required objective is mastered.'
          : 'Still learning — keep going.'}{' '}
        <span className="muted">
          {mastery.masteredObjectiveIds.length}/{mastery.requiredObjectiveIds.length} required
          objectives
        </span>
      </p>

      <ul>
        {mastery.assessments.map((assessment) => (
          <li key={assessment.objectiveId} className="card">
            <span className={assessment.mastered ? 'ok' : 'muted'}>
              {assessment.mastered ? '✓' : '○'} {assessment.label ?? assessment.objectiveId}
            </span>
            {typeof assessment.confidence === 'number' && (
              <span className="muted"> · {Math.round(assessment.confidence * 100)}%</span>
            )}
          </li>
        ))}
      </ul>

      {mastery.assessments.length === 0 && (
        <p className="muted">Compile the gap first — mastery is measured from lessons.</p>
      )}
    </main>
  );
}
