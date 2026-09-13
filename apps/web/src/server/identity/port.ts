/**
 * Trusted identity port (GAPX-02).
 *
 * Domain never sees cookies or OAuth tokens. Application code asks this port for an OwnerId.
 * Protected mode receives identity only from an injected session verifier.
 */

import type { OwnerId } from '@gapos/database';

export type IdentityMode = 'demo' | 'protected';

export interface IdentityRequest {
  readonly headers: Headers;
}

export interface VerifiedIdentity {
  readonly subject: string;
  readonly ownerId: OwnerId;
  readonly expiresAt: Date;
}

export interface IdentityVerifier {
  verify(request: IdentityRequest): Promise<VerifiedIdentity | undefined>;
}

export interface IdentityRuntime {
  readonly mode: IdentityMode;
  readonly verifier?: IdentityVerifier;
}

export type EnvMap = Record<string, string | undefined>;

export const identityModeFromEnv = (env: EnvMap = process.env): IdentityMode => {
  if (env.GAPOS_IDENTITY_MODE === 'protected') return 'protected';
  if (env.GAPOS_IDENTITY_MODE === 'demo') return 'demo';
  return 'demo';
};

export const parseCookieValue = (cookieHeader: string | null, name: string): string | undefined => {
  if (!cookieHeader) return undefined;
  const prefix = `${name}=`;
  const part = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  if (!part) return undefined;
  return decodeURIComponent(part.slice(prefix.length));
};
