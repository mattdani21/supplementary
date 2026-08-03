/**
 * An S3-compatible object store behind the `ObjectStore` interface (GAP-006).
 *
 * The in-memory store backs tests and local development; this is the production backend for
 * MinIO (infra/local/docker-compose.yml) or any S3 endpoint. It speaks AWS Signature Version 4
 * over plain fetch — no SDK, matching the live provider adapters' no-dependency rule.
 *
 * Ownership is enforced by key convention: every object is stored under `<owner>/<key>`, and
 * every operation scopes to that prefix, so a guessed key or another owner's prefix is not a
 * data leak. Signed URLs are presigned GETs with a short expiry (docs/SECURITY.md).
 */

import { createHash, createHmac } from 'node:crypto';
import type { ObjectStore } from './storage.js';

export interface S3ObjectStoreOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
}

const SERVICE = 's3';
const PAYLOAD_HASH_EMPTY = createHash('sha256').update('').digest('hex');

const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

const hmacBytes = (key: Uint8Array | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

/** ISO8601 basic: 20260802T090000Z — the format SigV4 signs. */
const amzDateOf = (date: Date): string =>
  date
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '');

/** Percent-encode per RFC 3986, the way SigV4 requires (spaces as %20, not +). */
const uriEncode = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const canonicalUri = (path: string): string =>
  path
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/');

const canonicalQuery = (query: URLSearchParams): string =>
  [...query.entries()]
    .filter(([key]) => key !== 'X-Amz-Signature')
    .map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`)
    .sort()
    .join('&');

interface SignInput {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadHash: string;
  readonly date: Date;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/**
 * Sign a request with AWS Signature Version 4 and return the hex signature.
 * Exported for the reference-vector test, which pins the algorithm against the published AWS
 * example; production callers use `createS3ObjectStore`.
 */
export const sign = (input: SignInput): string => {
  const amzDate = amzDateOf(input.date);
  const dateStamp = amzDate.slice(0, 8);

  const signedHeaderNames = Object.keys(input.headers)
    .map((name) => name.toLowerCase())
    .sort()
    .join(';');
  const canonicalHeaders = Object.keys(input.headers)
    .map((name) => `${name.toLowerCase()}:${(input.headers[name] ?? '').trim()}\n`)
    .sort()
    .join('');

  const canonicalRequest = [
    input.method,
    canonicalUri(input.path),
    canonicalQuery(input.query),
    canonicalHeaders,
    signedHeaderNames,
    input.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmacBytes(
    hmacBytes(
      hmacBytes(hmacBytes(`AWS4${input.secretAccessKey}`, dateStamp), input.region),
      SERVICE,
    ),
    'aws4_request',
  );
  return hmacBytes(signingKey, stringToSign).toString('hex');
};

const scopedKey = (owner: string, key: string): string => `${owner}/${key}`;

export const createS3ObjectStore = (options: S3ObjectStoreOptions): ObjectStore => {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = options;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = `${endpoint.replace(/\/+$/, '')}/${bucket}`;

  const authHeaders = (method: string, path: string, body: Uint8Array | undefined) => {
    const date = now();
    const payloadHash = body ? sha256Hex(body) : PAYLOAD_HASH_EMPTY;
    const host = new URL(baseUrl).host;
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDateOf(date),
    };
    const signature = sign({
      method,
      path,
      query: new URLSearchParams(),
      headers,
      payloadHash,
      date,
      region,
      accessKeyId,
      secretAccessKey,
    });
    headers.Authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${amzDateOf(date).slice(0, 8)}/${region}/${SERVICE}/aws4_request, ` +
      `SignedHeaders=${Object.keys(headers)
        .map((name) => name.toLowerCase())
        .sort()
        .join(';')}, ` +
      `Signature=${signature}`;
    return { headers, payloadHash };
  };

  return {
    async put(owner, key, bytes, mediaType) {
      const fullKey = scopedKey(owner, key);
      const { headers } = authHeaders('PUT', `/${bucket}/${fullKey}`, bytes);
      const response = await fetchImpl(`${baseUrl}/${fullKey}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': mediaType },
        // A fresh ArrayBuffer-backed copy satisfies both the node and DOM fetch typings.
        body: new Uint8Array(bytes),
      });
      if (!response.ok) {
        throw new Error(`S3 put failed: ${response.status} ${await response.text()}`);
      }
      return {
        key,
        ownerId: owner,
        mediaType,
        bytes,
        checksum: sha256Hex(bytes),
      };
    },

    async get(owner, key) {
      const fullKey = scopedKey(owner, key);
      const { headers } = authHeaders('GET', `/${bucket}/${fullKey}`, undefined);
      const response = await fetchImpl(`${baseUrl}/${fullKey}`, { headers });
      if (response.status === 404) return undefined;
      if (!response.ok) {
        throw new Error(`S3 get failed: ${response.status} ${await response.text()}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        key,
        ownerId: owner,
        mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
        bytes,
        checksum: sha256Hex(bytes),
      };
    },

    async signedUrl(owner, key, ttlSeconds = 300) {
      const fullKey = scopedKey(owner, key);
      // Parity with the memory store: no URL for an object the caller does not own. A HEAD
      // probe is the cheap way to know without downloading anything; presigning blindly would
      // hand out URLs for keys the caller has no claim on.
      const probe = authHeaders('HEAD', `/${bucket}/${fullKey}`, undefined).headers;
      const probeResponse = await fetchImpl(`${baseUrl}/${fullKey}`, {
        method: 'HEAD',
        headers: probe,
      });
      if (probeResponse.status === 404) return undefined;
      if (!probeResponse.ok) {
        throw new Error(`S3 head failed: ${probeResponse.status} ${await probeResponse.text()}`);
      }

      const date = now();
      const expires = ttlSeconds;
      const query = new URLSearchParams({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${accessKeyId}/${amzDateOf(date).slice(0, 8)}/${region}/${SERVICE}/aws4_request`,
        'X-Amz-Date': amzDateOf(date),
        'X-Amz-Expires': String(expires),
        'X-Amz-SignedHeaders': 'host',
      });
      const signature = sign({
        method: 'GET',
        path: `/${bucket}/${fullKey}`,
        query,
        headers: { host: new URL(baseUrl).host },
        payloadHash: 'UNSIGNED-PAYLOAD',
        date,
        region,
        accessKeyId,
        secretAccessKey,
      });
      query.set('X-Amz-Signature', signature);
      return {
        url: `${baseUrl}/${fullKey}?${query.toString()}`,
        expiresAt: new Date(date.getTime() + expires * 1000),
      };
    },

    async delete(owner, key) {
      const fullKey = scopedKey(owner, key);
      const { headers } = authHeaders('DELETE', `/${bucket}/${fullKey}`, undefined);
      const response = await fetchImpl(`${baseUrl}/${fullKey}`, { method: 'DELETE', headers });
      if (!response.ok && response.status !== 404) {
        throw new Error(`S3 delete failed: ${response.status} ${await response.text()}`);
      }
    },

    async deleteOwnedBy(owner) {
      const prefix = `${owner}/`;
      const { headers } = authHeaders(
        'GET',
        `/?list-type=2&prefix=${uriEncode(prefix)}`,
        undefined,
      );
      const response = await fetchImpl(`${baseUrl}?list-type=2&prefix=${uriEncode(prefix)}`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`S3 list failed: ${response.status} ${await response.text()}`);
      }
      const xml = await response.text();
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]!);
      await Promise.all(
        keys.map(async (fullKey) => {
          const delHeaders = authHeaders('DELETE', `/${fullKey}`, undefined).headers;
          await fetchImpl(`${baseUrl}/${fullKey}`, { method: 'DELETE', headers: delHeaders });
        }),
      );
    },
  };
};
