import Link from 'next/link';
import { identityModeFromEnv } from '../server/identity/port';

/**
 * Invited-beta landing (GAPX-05). The product object is the gap, not a chat thread.
 */
export default function HomePage() {
  const protectedMode = identityModeFromEnv() === 'protected';

  return (
    <main>
      <p className="eyebrow">Arc on GapOS — invited private beta</p>
      <h1>Learn the gap. Prove the skill.</h1>
      <p>
        Define a noticed knowledge gap, attach sources, compile a short audio-first course, then
        practise until mastery evidence — not consumption — fills the gap.
      </p>
      <ol>
        <li>Define the gap</li>
        <li>Attach sources</li>
        <li>Listen and practise</li>
        <li>Prove mastery</li>
        <li>Keep the capability</li>
      </ol>
      <p>
        {protectedMode ? (
          <Link href="/sign-in">Sign in (invited beta)</Link>
        ) : (
          <Link href="/arc">Continue to Arc</Link>
        )}
      </p>
      <p>
        <Link href="/privacy">Privacy</Link>
        {' · '}
        <Link href="/terms">Terms</Link>
      </p>
    </main>
  );
}
