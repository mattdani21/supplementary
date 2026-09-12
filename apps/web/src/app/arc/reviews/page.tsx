import Link from 'next/link';
import { arcReviewsHandler } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';
import { viewerOwner } from '../../../lib/viewer';
import { ReviewQueue, type ArcReviewItem } from '../../../components/arc/review-queue';

export const dynamic = 'force-dynamic';

type ServerReview = Omit<ArcReviewItem, 'dueAt'> & { dueAt: Date };

export default async function ArcReviewsPage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { reviews } = (await arcReviewsHandler(context, owner)) as {
    reviews: ServerReview[];
  };

  return (
    <>
      <div className="arc-head">
        <Link className="arc-icon-button" href="/arc" aria-label="Back to Today">
          ←
        </Link>
        <div className="arc-head-copy">
          <p className="arc-eyebrow">Retrieval ladder</p>
          <h1>Due reviews</h1>
          <p>Bring the idea back without rereading it first.</p>
        </div>
      </div>
      <ReviewQueue
        initialReviews={reviews.map((review) => ({
          ...review,
          dueAt: review.dueAt.toISOString(),
        }))}
      />
    </>
  );
}
