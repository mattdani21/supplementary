import Link from 'next/link';
import type { Gap } from '@gapos/database';
import { GapForm } from '../../components/gap-form';
import { OwnerSwitcher } from '../../components/owner-switcher';
import { VoiceCapture } from '../../components/voice-capture';
import { listGaps } from '../../server/api';
import { getServerContext } from '../../server/bootstrap';
import { viewerOwner } from '../../lib/viewer';

export const dynamic = 'force-dynamic';

export default async function GapsPage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { gaps } = (await listGaps(context, owner)) as { gaps: Gap[] };

  return (
    <main>
      <header className="row">
        <h1>GapOS</h1>
        <span className="actions">
          <Link href="/review">Review queue</Link>
          <OwnerSwitcher />
        </span>
      </header>

      {gaps.length === 0 ? (
        <p>No gaps yet. Name the thing you want to be able to do.</p>
      ) : (
        <ul className="gaps">
          {gaps.map((gap) => (
            <li key={gap.id} className="card">
              <Link href={`/gaps/${gap.id}`}>
                <strong>{gap.title}</strong>
              </Link>
              <p className="muted">
                {gap.status} · {gap.dailyMinutes} min/day
              </p>
            </li>
          ))}
        </ul>
      )}

      <GapForm />
      <VoiceCapture />
    </main>
  );
}
