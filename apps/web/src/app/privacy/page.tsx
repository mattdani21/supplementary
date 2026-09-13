import Link from 'next/link';

/**
 * Invited private-beta privacy notice, aligned with docs/SECURITY.md.
 */
export default function PrivacyPage() {
  return (
    <main>
      <h1>Arc private-beta privacy</h1>
      <p>Last updated 13 September 2026. This notice applies only to the invited private beta.</p>

      <h2>What we store</h2>
      <p>
        For each owner we may store uploaded sources, extracted chunks, generated lessons and audio,
        attempts, mastery evidence, review schedule, and provider-call records that do not include
        prompt bodies or user content beyond a hash.
      </p>

      <h2>How it is kept</h2>
      <ul>
        <li>Every learner record is owner-scoped. There is no fetch-by-id that skips ownership.</li>
        <li>Object storage is private. Audio uses short-lived signed URLs.</li>
        <li>
          Retrieved source text is passed to models inside an evidence envelope, never as
          instructions.
        </li>
        <li>We do not train models on your private content unless you explicitly opt in.</li>
      </ul>

      <h2>Providers</h2>
      <p>
        Generation on the production configuration is sent to DeepSeek through GapOS adapters.
        Provider credentials never appear in the API or the generation log. The log shows stage
        names, timings and recoverable errors only.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Sources and artefacts stay until you delete the gap or the account, or until the beta
        instance is retired. Provider-call records are kept for 90 days. Account deletion removes
        learner rows, storage objects and derived indexes, and writes an audit record. Export can
        produce your gaps, curricula, artefacts, attempts and evidence.
      </p>

      <h2>This is not a public launch</h2>
      <p>
        Access is invite-only. The current cohort is five named agent learners. We do not sell
        learner data. Changing this retention notice for a later public release requires a separate
        human review.
      </p>

      <p>
        <Link href="/terms">Terms</Link>
        {' · '}
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
