import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>GapOS</h1>
      <p>A gap-to-mastery learning companion. The study surface is coming next.</p>
      <p>
        <Link href="/gaps">Open your gaps</Link>
      </p>
    </main>
  );
}
