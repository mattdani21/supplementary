import Link from 'next/link';

/**
 * Invited private-beta terms. This is not a public launch and is not a certification path.
 */
export default function TermsPage() {
  return (
    <main>
      <h1>Arc private-beta terms</h1>
      <p>Last updated 13 September 2026. These terms apply only to the invited private beta.</p>

      <h2>1. What this is</h2>
      <p>
        Arc is a GapOS learning tool. You define a knowledge gap, attach sources, receive a short
        audio-first course, and practise until mastery evidence — not consumption — can fill the
        gap. This beta is invite-only. It is not a public product, not accredited, and not a
        certification or professional-advice service.
      </p>

      <h2>2. Who may use it</h2>
      <p>
        Only invited testers may use a hosted instance. The current private-beta cohort is five
        named agent learners operated by the maintainers (see the pilot roster). Accounts are
        owner-scoped. You must not attempt to access another learner&apos;s gaps, sources, or
        evidence.
      </p>

      <h2>3. Your sources and practice</h2>
      <p>
        You are responsible for having the right to upload material you attach. Uploaded text is
        treated as evidence for generation, never as instructions to the model. Generated practice
        is independently checked before publication. Completing a lesson or listening to audio does
        not mean you have mastered the objective.
      </p>

      <h2>4. Providers and limits</h2>
      <p>
        Lesson generation on the production configuration uses a DeepSeek language model through
        GapOS provider adapters. Audio uses the configured text-to-speech engine. Calls are
        budgeted. Uploads, compiles and proof runs may be rate-limited. The service may degrade to
        text-only rather than overspend.
      </p>

      <h2>5. Availability</h2>
      <p>
        The beta may be paused, reset, or withdrawn without notice. Notebook proof execution may be
        disabled on a deployment. There is no uptime commitment and no warranty that a compile will
        finish for every topic.
      </p>

      <h2>6. Ending the beta</h2>
      <p>
        You may stop using the service at any time. Account deletion removes learner rows, storage
        objects and derived indexes. We may delete beta data when the instance is retired.
      </p>

      <h2>7. Liability</h2>
      <p>
        The software is provided as-is for private evaluation. GapOS is not liable for decisions you
        make from generated lessons, or for third-party provider outages.
      </p>

      <p>
        <Link href="/privacy">Privacy</Link>
        {' · '}
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
