import Link from 'next/link';

export default function GapNotFound() {
  return (
    <main>
      <p>
        <Link href="/gaps">← all gaps</Link>
      </p>
      <h1>We couldn&apos;t find that gap</h1>
      <p className="muted">
        It may have been removed, or it belongs to someone else. Head back to your gaps to keep
        going.
      </p>
    </main>
  );
}
