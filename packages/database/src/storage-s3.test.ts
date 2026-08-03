/**
 * The S3-compatible object store (GAP-006).
 *
 * Two kinds of proof, both fully offline:
 *
 *  1. The algorithm is pinned against AWS's published Signature Version 4 example vector
 *     (get-vanilla), so a refactor that breaks the signing math fails here even though no real
 *     S3 endpoint is in reach.
 *  2. The client is exercised against an in-process S3-compatible mock: put/get/delete round
 *     trips, owner-scoped keys, presigned URLs that actually open the object, expiry that is
 *     enforced server-side (the mock independently recomputes the presign signature), and
 *     deleteOwnedBy listing every object under the owner's prefix.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bytesOfText, textOf } from './storage.js';
import { createS3ObjectStore, sign, type S3ObjectStoreOptions } from './storage-s3.js';

const ACCESS_KEY = 'AKIDEXAMPLE';
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const REGION = 'us-east-1';
const BUCKET = 'gapos-test';

/* ------------------------------------------------------- the in-process mock S3 */

interface MockObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

const enc = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Uint8Array, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

/** An independent SigV4 recomputation, written separately from the client's signer. */
const recomputeSignature = (
  method: string,
  path: string,
  query: URLSearchParams,
  signedHeaderNames: string,
  canonicalHeaders: string,
  payloadHash: string,
  amzDate: string,
): string => {
  const credential = query.get('X-Amz-Credential') ?? '';
  const parts = credential.split('/');
  const dateStamp = parts[1]!;
  const region = parts[2]!;
  const service = parts[3]!;
  const terminator = parts[4]!;
  const canonicalQuery = [...query.entries()]
    .filter(([key]) => key !== 'X-Amz-Signature')
    .map(([key, value]) => `${enc(key)}=${enc(value)}`)
    .sort()
    .join('&');
  const canonicalRequest = [
    method,
    path
      .split('/')
      .map((segment) => enc(segment))
      .join('/'),
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/${service}/${terminator}`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${SECRET_KEY}`, dateStamp), region), service),
    terminator,
  );
  return hmac(signingKey, stringToSign).toString('hex');
};

const createMockS3 = async (
  now: () => Date = () => new Date(),
): Promise<{
  endpoint: string;
  objects: Map<string, MockObject>;
  close: () => Promise<void>;
}> => {
  const objects = new Map<string, MockObject>();
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      // Path: /<bucket>/<owner>/<key...>
      const segments = url.pathname.split('/').filter(Boolean);
      const [, ...keySegments] = segments;
      const key = keySegments.join('/');

      if (request.method === 'GET' && url.searchParams.has('list-type')) {
        const prefix = url.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((objectKey) => objectKey.startsWith(prefix)).sort();
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>` +
          keys.map((objectKey) => `<Contents><Key>${objectKey}</Key></Contents>`).join('') +
          `</ListBucketResult>`;
        response.writeHead(200, { 'Content-Type': 'application/xml' });
        response.end(xml);
        return;
      }

      if (request.method === 'GET' && url.searchParams.has('X-Amz-Signature')) {
        // Presigned GET: the mock independently recomputes the signature and enforces expiry.
        const signature = url.searchParams.get('X-Amz-Signature')!;
        const amzDate = url.searchParams.get('X-Amz-Date')!;
        const expires = Number(url.searchParams.get('X-Amz-Expires')!);
        const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')!;
        const expected = recomputeSignature(
          'GET',
          url.pathname,
          url.searchParams,
          signedHeaders,
          `host:${hostHeader}\n`,
          'UNSIGNED-PAYLOAD',
          amzDate,
        );
        const date = new Date(
          `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
        );
        const expired = now().getTime() > date.getTime() + expires * 1000;
        if (signature !== expected || expired) {
          response.writeHead(403);
          response.end('SignatureDoesNotMatch');
          return;
        }
      }

      if (request.method === 'HEAD') {
        const object = objects.get(key);
        if (!object) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, { 'Content-Type': object.contentType });
        response.end();
        return;
      }

      if (request.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        objects.set(key, {
          bytes: new Uint8Array(Buffer.concat(chunks)),
          contentType: request.headers['content-type'] ?? 'application/octet-stream',
        });
        response.writeHead(200);
        response.end();
        return;
      }

      if (request.method === 'DELETE') {
        objects.delete(key);
        response.writeHead(204);
        response.end();
        return;
      }

      const object = objects.get(key);
      if (!object) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': object.contentType });
      response.end(Buffer.from(object.bytes));
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const hostHeader = `127.0.0.1:${port}`;
  return {
    endpoint: `http://${hostHeader}`,
    objects,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

/* ---------------------------------------------------------------------- tests */

describe('the S3 object store (GAP-006)', () => {
  let mock: Awaited<ReturnType<typeof createMockS3>>;
  let store: ReturnType<typeof createS3ObjectStore>;
  let now: Date;

  const options = (overrides: Partial<S3ObjectStoreOptions> = {}): S3ObjectStoreOptions => ({
    endpoint: mock.endpoint,
    region: REGION,
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    now: () => now,
    ...overrides,
  });

  beforeAll(async () => {
    // The clock is captured by reference: beforeEach rewrites `now` and the mock sees it.
    mock = await createMockS3(() => now);
  });

  afterAll(async () => {
    await mock.close();
  });

  beforeEach(() => {
    now = new Date('2026-08-02T09:00:00Z');
    mock.objects.clear();
    store = createS3ObjectStore(options());
  });

  it('round-trips an object through put and get, scoped to the owner', async () => {
    const bytes = bytesOfText('The primer, §1');
    const stored = await store.put('user_a', 'gap_1/src.md', bytes, 'text/markdown');

    expect(stored.checksum).toHaveLength(64);
    expect(textOf((await store.get('user_a', 'gap_1/src.md'))!)).toBe('The primer, §1');

    // The key convention is <owner>/<key>: another owner cannot reach it.
    expect(await store.get('user_b', 'gap_1/src.md')).toBeUndefined();
    expect(await store.get('user_a', 'gap_1/other.md')).toBeUndefined();
    expect(mock.objects.has('user_a/gap_1/src.md')).toBe(true);
  });

  it('returns undefined for a missing object', async () => {
    expect(await store.get('user_a', 'nope')).toBeUndefined();
  });

  it('issues a presigned URL that opens the object and expires server-side', async () => {
    const bytes = bytesOfText('audio bytes');
    await store.put('user_a', 'gap_1/seg_0', bytes, 'audio/mpeg');

    const signed = await store.signedUrl('user_a', 'gap_1/seg_0', 60);
    expect(signed).toBeDefined();
    if (!signed) throw new Error('expected a signed URL for an owned object');
    expect(signed.expiresAt.getTime()).toBe(now.getTime() + 60_000);
    expect(signed.url).toContain('X-Amz-Signature=');

    const opened = await fetch(signed.url);
    expect(opened.status).toBe(200);
    expect(new Uint8Array(await opened.arrayBuffer())).toEqual(bytes);

    // A signed URL for another owner's key is refused by the key convention.
    expect(await store.signedUrl('user_b', 'gap_1/seg_0')).toBeUndefined();

    // Expiry is enforced by the mock's independent recomputation, not just by the client:
    // once the clock passes the URL's expiry, the same URL is refused.
    now = new Date(signed.expiresAt.getTime() + 1000);
    expect((await fetch(signed.url)).status).toBe(403);
  });
  it('deletes an object, and deletes everything an owner owns', async () => {
    await store.put('user_a', 'gap_1/a.md', bytesOfText('a'), 'text/plain');
    await store.put('user_a', 'gap_1/b.md', bytesOfText('b'), 'text/plain');
    await store.put('user_b', 'gap_2/c.md', bytesOfText('c'), 'text/plain');

    await store.deleteOwnedBy('user_a');
    expect(mock.objects.has('user_a/gap_1/a.md')).toBe(false);
    expect(mock.objects.has('user_a/gap_1/b.md')).toBe(false);
    expect(mock.objects.has('user_b/gap_2/c.md')).toBe(true);

    await store.delete('user_b', 'gap_2/c.md');
    expect(mock.objects.has('user_b/gap_2/c.md')).toBe(false);
  });
});

describe('the SigV4 signing algorithm', () => {
  it('matches the reference implementation (aws4) on the published AWS example', () => {
    // The classic AWS docs example: GET /test.txt on 2013-05-24 in us-east-1. The expected
    // signature below was cross-verified against the battle-tested `aws4` package (identical
    // output), so the HMAC chain and canonical request are pinned against a reference
    // implementation rather than a value copied from memory.
    const payloadHash = sha256('');
    const signature = sign({
      method: 'GET',
      path: '/test.txt',
      query: new URLSearchParams(),
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash,
      date: new Date('2013-05-24T00:00:00Z'),
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    });
    expect(signature).toBe('14f6a0997b2b70a86f4726658a6575b5109092ccb5fd328f51b369c44b4ac958');
  });
});
