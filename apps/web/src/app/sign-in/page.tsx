import Link from 'next/link';

/**
 * Invite-only sign-in (GAPX-02 / GAPX-05). Auth.js owns the OAuth handshake.
 */
export default function SignInPage() {
  return (
    <main>
      <h1>Sign in to Arc</h1>
      <p>
        This is an invited private beta. Demo identity (`X-Owner-Id`) is disabled in protected mode.
        Only subjects listed in <code>GAPOS_INVITE_SUBJECTS</code> can start a session.
      </p>
      <p>
        <a href="/api/auth/signin/github">Continue with GitHub</a>
      </p>
      <p>
        <Link href="/">Back to the product</Link>
      </p>
    </main>
  );
}
