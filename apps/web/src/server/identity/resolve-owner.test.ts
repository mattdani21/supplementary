import { afterEach, describe, expect, it } from 'vitest';
import { createFakeIdentityVerifier } from './fake-verifier.js';
import {
  configureIdentityRuntime,
  identityRuntimeFromEnv,
  resetIdentityRuntime,
  resolveOwner,
} from './resolve-owner.js';

const ALICE = 'user_alice';
const MALLORY = 'user_mallory';

afterEach(() => {
  resetIdentityRuntime();
});

describe('GAPX-02 trusted identity boundary', () => {
  it('rejects a forged header when a verified session is present', async () => {
    const verifier = createFakeIdentityVerifier({
      alice_session: {
        subject: 'alice@example.com',
        ownerId: ALICE,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    });
    configureIdentityRuntime({ mode: 'protected', verifier });

    await expect(
      resolveOwner({
        headers: new Headers({
          authorization: 'Bearer alice_session',
          'x-owner-id': MALLORY,
        }),
      }),
    ).rejects.toMatchObject({ status: 409, code: 'identity_conflict' });
  });

  it('rejects a forged gapos_owner cookie against a verified subject', async () => {
    const verifier = createFakeIdentityVerifier({
      alice_session: {
        subject: 'alice@example.com',
        ownerId: ALICE,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    });

    await expect(
      resolveOwner(
        {
          headers: new Headers({
            cookie: 'gapos_session=alice_session; gapos_owner=user_mallory',
          }),
        },
        { mode: 'protected', verifier },
      ),
    ).rejects.toMatchObject({ status: 409, code: 'identity_conflict' });
  });

  it('returns 401 for a missing or expired session in protected mode', async () => {
    const verifier = createFakeIdentityVerifier({
      stale: {
        subject: 'alice@example.com',
        ownerId: ALICE,
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      },
    });

    await expect(
      resolveOwner({ headers: new Headers() }, { mode: 'protected', verifier }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });

    await expect(
      resolveOwner(
        { headers: new Headers({ authorization: 'Bearer stale' }) },
        { mode: 'protected', verifier },
      ),
    ).rejects.toMatchObject({ status: 401, code: 'session_expired' });
  });

  it('fails protected configuration without a verifier or AUTH_SECRET', () => {
    expect(() => identityRuntimeFromEnv({ GAPOS_IDENTITY_MODE: 'protected' })).toThrow(/verifier/);
    expect(() =>
      identityRuntimeFromEnv({ GAPOS_IDENTITY_MODE: 'protected' }, createFakeIdentityVerifier({})),
    ).toThrow(/AUTH_SECRET/);
  });

  it('keeps two verified owners isolated', async () => {
    const verifier = createFakeIdentityVerifier({
      alice: {
        subject: 'alice@example.com',
        ownerId: ALICE,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
      mallory: {
        subject: 'mallory@example.com',
        ownerId: MALLORY,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    });

    await expect(
      resolveOwner(
        { headers: new Headers({ authorization: 'Bearer alice' }) },
        { mode: 'protected', verifier },
      ),
    ).resolves.toBe(ALICE);
    await expect(
      resolveOwner(
        { headers: new Headers({ authorization: 'Bearer mallory' }) },
        { mode: 'protected', verifier },
      ),
    ).resolves.toBe(MALLORY);
  });

  it('still requires X-Owner-Id in explicit demo mode', async () => {
    await expect(resolveOwner({ headers: new Headers() }, { mode: 'demo' })).rejects.toMatchObject({
      status: 401,
      code: 'owner_required',
    });
    await expect(
      resolveOwner({ headers: new Headers({ 'x-owner-id': ALICE }) }, { mode: 'demo' }),
    ).resolves.toBe(ALICE);
  });
});
