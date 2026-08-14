'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Page fade/slide on route change (GAP-034, E22).
 *
 * Keying the wrapper by pathname remounts the page subtree on every navigation, so the CSS
 * `page-in` animation replays. Pure CSS — prefers-reduced-motion disables it in globals.css.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
