import Link from 'next/link';

/**
 * Retention behavior is specified in docs/SECURITY.md. Legal publication is a human gate.
 */
export default function PrivacyPage() {
  return (
    <main>
      <h1>Privacy</h1>
      <p>
        GapOS stores uploaded sources, generated artefacts, attempts and mastery evidence as
        owner-scoped records. Account deletion removes learner rows and storage objects. Provider
        prompts and credentials are never returned by the API.
      </p>
      <p>
        The published privacy policy for a hosted instance is a human-authored document. This page
        wires the retention behavior already specified in the security documentation; it does not
        invent or replace that policy.
      </p>
      <p>
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
