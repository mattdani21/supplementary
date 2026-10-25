import Link from 'next/link';
import { arcCatalogHandler } from '../../../server/api';
import { CatalogPanel } from '../../../components/arc/catalog-panel';

export const dynamic = 'force-dynamic';

export default function ArcCatalogPage() {
  const { syllabi } = arcCatalogHandler();

  return (
    <>
      <div className="arc-head">
        <div className="arc-head-copy">
          <p className="arc-eyebrow">Catalog</p>
          <h1>Libraries</h1>
          <p>Place into a designed syllabus, or import your own outline.</p>
        </div>
        <Link className="arc-icon-button" href="/arc/skills" aria-label="Back to skills">
          ←
        </Link>
      </div>
      <CatalogPanel syllabi={syllabi} />
    </>
  );
}
