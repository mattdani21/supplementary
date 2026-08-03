/**
 * The SigV4 client against a real S3-compatible endpoint (GAP-024).
 *
 * The in-process mock proves the client's wire format and the reference vector pins the signing
 * math; this proves the client against a real S3 server — MinIO in CI (the workflow's
 * `minio` service). Skipped loudly without the GAPOS_S3_* env, exactly like the Postgres
 * suites, so a CI misconfiguration can never pass silently.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3ObjectStore } from '../../packages/database/src/storage-s3.js';

const endpoint = process.env.GAPOS_S3_ENDPOINT;
const bucket = process.env.GAPOS_S3_BUCKET;
const accessKeyId = process.env.GAPOS_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.GAPOS_S3_SECRET_ACCESS_KEY;

const describeIfConfigured =
  endpoint && bucket && accessKeyId && secretAccessKey ? describe : describe.skip;

describeIfConfigured('the S3 object store against a real endpoint (GAP-024)', () => {
  // The describe only runs when every env var is set (see the guard above); the store is
  // built in beforeAll so a skipped suite never constructs it.
  let store: ReturnType<typeof createS3ObjectStore>;
  const bytes = new Uint8Array([9, 8, 7, 6, 5]);

  beforeAll(() => {
    store = createS3ObjectStore({
      endpoint: endpoint!,
      region: process.env.GAPOS_S3_REGION ?? 'us-east-1',
      bucket: bucket!,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    });
  });

  beforeAll(async () => {
    await store.put('smoke_owner', 'roundtrip.bin', bytes, 'application/octet-stream');
  });

  afterAll(async () => {
    await store.deleteOwnedBy('smoke_owner');
  });

  it('round-trips an object', async () => {
    const stored = await store.get('smoke_owner', 'roundtrip.bin');
    expect(stored).toBeDefined();
    expect(new Uint8Array(stored!.bytes)).toEqual(bytes);
  });

  it('issues a presigned URL that the server serves', async () => {
    const signed = await store.signedUrl('smoke_owner', 'roundtrip.bin', 60);
    expect(signed).toBeDefined();
    const response = await fetch(signed!.url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('scopes by owner and key', async () => {
    expect(await store.get('someone_else', 'roundtrip.bin')).toBeUndefined();
    expect(await store.get('smoke_owner', 'missing.bin')).toBeUndefined();
  });

  it('deletes and cleans up everything an owner owns', async () => {
    await store.put('smoke_owner', 'extra.bin', bytes, 'application/octet-stream');
    await store.delete('smoke_owner', 'roundtrip.bin');
    expect(await store.get('smoke_owner', 'roundtrip.bin')).toBeUndefined();
    await store.deleteOwnedBy('smoke_owner');
    expect(await store.get('smoke_owner', 'extra.bin')).toBeUndefined();
  });
});

if (!endpoint) {
  describe('the S3 smoke test (GAP-024)', () => {
    it.skip('was not exercised: set GAPOS_S3_ENDPOINT, GAPOS_S3_BUCKET, GAPOS_S3_ACCESS_KEY_ID and GAPOS_S3_SECRET_ACCESS_KEY to run against a real endpoint', () => {
      expect.unreachable();
    });
  });
}
