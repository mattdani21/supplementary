/**
 * Object storage.
 *
 * Uploaded sources and generated audio live here, never in the database. The interface is
 * deliberately owner-scoped like every repository: a signed URL is issued for an object the
 * caller owns, and `get` refuses anything else, so a guessed storage key is not a data leak.
 *
 * The in-memory implementation backs tests and local development; an S3-compatible one slots in
 * behind the same interface.
 */

import { createHash } from 'node:crypto';
import type { OwnerId } from './repositories/types.js';

export interface StoredObject {
  readonly key: string;
  readonly ownerId: OwnerId;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly checksum: string;
}

export interface SignedUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface ObjectStore {
  put(owner: OwnerId, key: string, bytes: Uint8Array, mediaType: string): Promise<StoredObject>;
  get(owner: OwnerId, key: string): Promise<StoredObject | undefined>;
  /** Short-lived by construction: docs/SECURITY.md requires signed access to expire. */
  signedUrl(owner: OwnerId, key: string, ttlSeconds?: number): Promise<SignedUrl | undefined>;
  delete(owner: OwnerId, key: string): Promise<void>;
  deleteOwnedBy(owner: OwnerId): Promise<void>;
}

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

export const checksumOf = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const createMemoryObjectStore = (now: () => Date = () => new Date()): ObjectStore => {
  const objects = new Map<string, StoredObject>();

  const scoped = (owner: OwnerId, key: string) => `${owner}::${key}`;

  return {
    async put(owner, key, bytes, mediaType) {
      const object: StoredObject = {
        key,
        ownerId: owner,
        mediaType,
        bytes,
        checksum: checksumOf(bytes),
      };
      objects.set(scoped(owner, key), object);
      return object;
    },
    async get(owner, key) {
      return objects.get(scoped(owner, key));
    },
    async signedUrl(owner, key, ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) {
      const object = objects.get(scoped(owner, key));
      if (!object) return undefined;
      return {
        url: `memory://${key}?sig=${object.checksum.slice(0, 16)}`,
        expiresAt: new Date(now().getTime() + ttlSeconds * 1000),
      };
    },
    async delete(owner, key) {
      objects.delete(scoped(owner, key));
    },
    async deleteOwnedBy(owner) {
      for (const [composite, object] of objects) {
        if (object.ownerId === owner) objects.delete(composite);
      }
    },
  };
};

export const textOf = (object: StoredObject): string => new TextDecoder().decode(object.bytes);

export const bytesOfText = (text: string): Uint8Array => new TextEncoder().encode(text);
