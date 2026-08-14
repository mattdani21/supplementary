import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import type { Gap } from '@gapos/database';
import { PageTransition } from '../components/page-transition';
import { RegisterServiceWorker } from '../components/register-sw';
import { AppTabBar } from '../components/tab-bar';
import { viewerOwner } from '../lib/viewer';
import { tabBarItems } from '../lib/tab-bar-items';
import { listGaps } from '../server/api';
import { getServerContext } from '../server/bootstrap';
import './globals.css';

export const metadata: Metadata = {
  title: 'GapOS — close the gap',
  description: 'A gap-to-mastery learning companion.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0c',
  // Let the shell paint under the notch/home indicator so safe-area insets can pad it (E22).
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The tab bar's Learn/Map destinations resolve from the learner's gaps (first active gap).
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { gaps } = (await listGaps(context, owner)) as { gaps: Gap[] };

  return (
    <html lang="en">
      <body>
        <div className="app-frame">
          <PageTransition>{children}</PageTransition>
          <AppTabBar items={tabBarItems(gaps)} />
        </div>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
