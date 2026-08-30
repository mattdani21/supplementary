import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../arc.css';
import { ArcNav } from '../../components/arc/arc-nav';
import { ThemeInit } from '../../components/arc/theme-init';
import { getServerContext } from '../../server/bootstrap';
import { getPreferences } from '../../server/services/arc-service';
import { viewerOwner } from '../../lib/viewer';

export const metadata: Metadata = {
  title: 'Arc — adaptive skill learning',
  description: 'Learn the gap. Prove the skill.',
};

export default async function ArcLayout({ children }: { children: ReactNode }) {
  const owner = await viewerOwner();
  let theme: 'light' | 'dark' = 'light';
  try {
    const context = await getServerContext();
    const preferences = await getPreferences(context, owner);
    theme = preferences.darkMode ? 'dark' : 'light';
  } catch {
    // A preference read must never block the app shell.
  }

  return (
    <>
      <ThemeInit theme={theme} />
      <div className="arc">
        <div className="arc-shell">
          <main className="arc-screen">{children}</main>
          <ArcNav />
        </div>
      </div>
    </>
  );
}
