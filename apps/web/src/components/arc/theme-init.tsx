'use client';

import { useEffect } from 'react';

/**
 * Applies the server-known theme to <html> on first paint. The server reads the persisted
 * dark-mode preference, so the page never flashes the wrong theme; toggling in Profile updates
 * the attribute immediately and persists through the API.
 */
export function ThemeInit({ theme }: { theme: 'light' | 'dark' }) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return null;
}
