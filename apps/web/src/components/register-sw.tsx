'use client';

import { useEffect } from 'react';

/** Registers the offline service worker (E14) once per page load. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline support is progressive; a failed registration must not break the app.
      });
    }
  }, []);
  return null;
}
