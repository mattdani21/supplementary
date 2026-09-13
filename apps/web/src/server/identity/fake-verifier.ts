import type { OwnerId } from '@gapos/database';
import type { IdentityRequest, IdentityVerifier, VerifiedIdentity } from './port.js';

export interface FakeIdentity {
  readonly subject: string;
  readonly ownerId: OwnerId;
  readonly expiresAt: Date;
}

/**
 * Deterministic verifier for tests. Looks up a bearer token or `gapos_session` cookie
 * against a scripted map. Proves the port, not Auth.js.
 */
export const createFakeIdentityVerifier = (
  sessions: Readonly<Record<string, FakeIdentity>>,
): IdentityVerifier => ({
  async verify(request: IdentityRequest): Promise<VerifiedIdentity | undefined> {
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const cookie = request.headers
      .get('cookie')
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('gapos_session='))
      ?.slice('gapos_session='.length);
    const token = bearer ?? cookie;
    if (!token) return undefined;
    return sessions[token];
  },
});
