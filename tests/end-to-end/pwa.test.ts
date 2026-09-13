/**
 * The offline PWA slice (E14), verified at the artifact level.
 *
 * Browser acceptance exercises a visited Arc lesson offline. These artifact checks keep the
 * underlying policy explicit: only same-origin GETs are cached, signed S3 audio stays on the
 * network, uncached document navigation gets a safe text fallback, and writes still fail.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC = join(process.cwd(), 'apps/web/public');
const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');

describe('the offline service worker (E14)', () => {
  it('is shipped', () => {
    expect(sw).toContain("const CACHE = 'gapos-arc-v3'");
  });

  it('only caches Arc/static GETs — writes, APIs, and signed audio use the network', () => {
    expect(sw).toContain("if (request.method !== 'GET') return;");
    expect(sw).toContain('if (url.origin !== self.location.origin) return;');
    expect(sw).toContain("if (url.pathname.startsWith('/api/')) return;");
    expect(sw).toContain('if (!isArcPage && !isStaticAsset) return;');
  });

  it('partitions private Arc documents by owner without dropping request headers', () => {
    expect(sw).toContain("request.headers.get('x-owner-id')");
    expect(sw).toContain("request.headers.get('cookie')");
    expect(sw).toContain("self.cookieStore?.get('gapos_owner')");
    expect(sw).toContain('scopedUrl.searchParams.set(OWNER_KEY, owner)');
    expect(sw).toContain('headers: request.headers');
    expect(sw).toContain('if (!cacheKey)');
  });

  it('serves cached content first and refreshes in the background', () => {
    expect(sw).toContain('if (cached)');
    expect(sw).toContain('cache.put(cacheKey, response.clone())');
  });

  it('returns a safe Arc document when an uncached navigation is offline', () => {
    expect(sw).toContain("request.mode === 'navigate'");
    expect(sw).toContain('offlineDocument()');
    expect(sw).toContain('Arc is offline');
    expect(sw).toContain('The visited lesson transcript remains available');
  });

  it('activates immediately rather than waiting for old clients', () => {
    expect(sw).toContain('self.skipWaiting()');
  });
});

describe('the PWA manifest', () => {
  it('points at Arc and declares an icon', () => {
    const icon = readFileSync(join(PUBLIC, 'icon.svg'), 'utf8');
    const manifest = readFileSync(join(process.cwd(), 'apps/web/src/app/manifest.ts'), 'utf8');
    expect(icon).toContain('<svg');
    expect(manifest).toContain("start_url: '/arc'");
  });
});
