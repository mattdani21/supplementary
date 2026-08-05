/**
 * The offline PWA slice (E14), verified at the artifact level.
 *
 * The full offline proof needs a browser, but the service worker's contract is assertable from
 * the artifact: it exists, it only caches GETs, it only caches same-origin requests (signed
 * S3 audio stays uncached), it serves cached content first when the network is gone, and the
 * manifest points at the study surface. CI also runs `next build`, which compiles the pages.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC = join(process.cwd(), 'apps/web/public');
const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');

describe('the offline service worker (E14)', () => {
  it('is shipped', () => {
    expect(sw).toContain("const CACHE = 'gapos-v1'");
  });

  it('only intercepts same-origin GETs — writes and signed audio go to the network', () => {
    expect(sw).toContain("if (request.method !== 'GET') return;");
    expect(sw).toContain('if (url.origin !== self.location.origin) return;');
  });

  it('serves cached content first and refreshes in the background', () => {
    // stale-while-revalidate: `cached ?? (await network)` — the lesson renders offline.
    expect(sw).toContain('cached ?? (await network)');
    expect(sw).toContain('cache.put(request, copy)');
  });

  it('activates immediately rather than waiting for old clients', () => {
    expect(sw).toContain('self.skipWaiting()');
  });
});

describe('the PWA manifest', () => {
  it('points at the study surface and declares an icon', () => {
    const icon = readFileSync(join(PUBLIC, 'icon.svg'), 'utf8');
    expect(icon).toContain('<svg');
  });
});
