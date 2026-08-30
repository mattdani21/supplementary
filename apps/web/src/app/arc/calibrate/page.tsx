import Link from 'next/link';
import { CalibrationFlow } from '../../../components/arc/calibration-flow';

export const dynamic = 'force-dynamic';

export default async function ArcCalibratePage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject } = await searchParams;
  const initialSubject = subject ?? 'Python for data work';

  return (
    <>
      <div className="arc-head">
        <Link className="arc-icon-button" href="/arc/skills" aria-label="Go back to skills">
          ←
        </Link>
        <div className="arc-head-copy">
          <p className="arc-eyebrow">AI calibration</p>
          <h1>Find your route</h1>
        </div>
      </div>
      <CalibrationFlow initialSubject={initialSubject} />
    </>
  );
}
