import Link from 'next/link';
import { arcEnrollmentHandler } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { viewerOwner } from '../../../../lib/viewer';
import { EnrollmentBoard } from '../../../../components/arc/enrollment-board';

export const dynamic = 'force-dynamic';

export default async function ArcEnrollmentPage({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const { enrollmentId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { enrollment } = await arcEnrollmentHandler(context, owner, enrollmentId);

  return (
    <>
      <div className="arc-head">
        <div className="arc-head-copy">
          <p className="arc-eyebrow">Enrollment</p>
          <h1>{enrollment.title}</h1>
        </div>
        <Link className="arc-icon-button" href="/arc/catalog" aria-label="Back to catalog">
          ←
        </Link>
      </div>
      <EnrollmentBoard enrollment={enrollment} />
    </>
  );
}
