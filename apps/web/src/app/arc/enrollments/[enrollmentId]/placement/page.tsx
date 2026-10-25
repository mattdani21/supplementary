import Link from 'next/link';
import { arcPlacementKitHandler } from '../../../../../server/api';
import { getServerContext } from '../../../../../server/bootstrap';
import { viewerOwner } from '../../../../../lib/viewer';
import { PlacementExam } from '../../../../../components/arc/placement-exam';
import { StatusMessage } from '@gapos/ui';
import { PlacementResitBlockedError } from '../../../../../server/services/syllabus-service';

export const dynamic = 'force-dynamic';

export default async function ArcPlacementPage({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const { enrollmentId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();

  try {
    const { placement } = await arcPlacementKitHandler(context, owner, enrollmentId);
    return (
      <>
        <div className="arc-head">
          <div className="arc-head-copy">
            <p className="arc-eyebrow">Exam</p>
            <h1>Placement</h1>
          </div>
          <Link
            className="arc-icon-button"
            href={`/arc/enrollments/${enrollmentId}`}
            aria-label="Back to enrollment"
          >
            ←
          </Link>
        </div>
        <PlacementExam enrollmentId={enrollmentId} kit={placement} />
      </>
    );
  } catch (error) {
    const message =
      error instanceof PlacementResitBlockedError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Placement is unavailable.';
    return (
      <>
        <div className="arc-head">
          <div className="arc-head-copy">
            <p className="arc-eyebrow">Exam</p>
            <h1>Placement</h1>
          </div>
          <Link
            className="arc-icon-button"
            href={`/arc/enrollments/${enrollmentId}`}
            aria-label="Back to enrollment"
          >
            ←
          </Link>
        </div>
        <StatusMessage tone="error" title="Placement is unavailable.">
          {message}
        </StatusMessage>
        <Link className="arc-primary" href={`/arc/enrollments/${enrollmentId}`}>
          Back to syllabus
        </Link>
      </>
    );
  }
}
