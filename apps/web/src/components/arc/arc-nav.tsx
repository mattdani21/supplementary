'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/arc', label: 'Today', icon: '⌂' },
  { href: '/arc/skills', label: 'Skills', icon: '⌁' },
  { href: '/arc/progress', label: 'Progress', icon: '↗' },
  { href: '/arc/profile', label: 'Profile', icon: '○' },
] as const;

export function ArcNav() {
  const pathname = usePathname();
  return (
    <nav className="arc-nav" aria-label="Main navigation">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`arc-nav-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="arc-nav-icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
