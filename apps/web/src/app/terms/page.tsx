import Link from 'next/link';

export default function TermsPage() {
  return (
    <main>
      <h1>Terms</h1>
      <p>
        Arc is an invited private beta. It is not a certification path and does not replace
        professional judgment. Generated practice is independently verified before publication;
        consuming a lesson is not mastery.
      </p>
      <p>
        Hosted terms of use are a human-authored document. This page exists so the release surface
        can link them; it does not publish a new legal policy.
      </p>
      <p>
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
