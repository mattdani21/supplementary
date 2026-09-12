import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { RegisterServiceWorker } from '../components/register-sw';
import './globals.css';

export const metadata: Metadata = {
  title: 'GapOS — close the gap',
  description: 'A gap-to-mastery learning companion.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#111419' },
  ],
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
