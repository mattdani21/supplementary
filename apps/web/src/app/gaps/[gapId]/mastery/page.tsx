import Link from 'next/link';
import { masteryView } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { viewerOwner } from '../../../../lib/viewer';

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

  const { mastery } = (await masteryView(context, owner, gapId)) as { mastery: MasterySummary };

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
