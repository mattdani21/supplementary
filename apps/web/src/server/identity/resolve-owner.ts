import type { OwnerId } from '@gapos/database';
import { IdentityError } from './errors.js';
import {
  identityModeFromEnv,
  parseCookieValue,
  type EnvMap,
  type IdentityMode,
  type IdentityRequest,
  type IdentityRuntime,
  type IdentityVerifier,
} from './port.js';

export const OWNER_COOKIE = 'gapos_owner';
export const DEFAULT_OWNER: OwnerId = 'local-learner' as OwnerId;

let runtime: IdentityRuntime = { mode: 'demo' };

export const configureIdentityRuntime = (next: IdentityRuntime): void => {
  runtime = next;
};

export const resetIdentityRuntime = (): void => {
  runtime = { mode: 'demo' };
};

export const getIdentityRuntime = (): IdentityRuntime => runtime;

export const identityRuntimeFromEnv = (
  env: EnvMap = process.env,
  verifier?: IdentityVerifier,
): IdentityRuntime => {
  const mode: IdentityMode = identityModeFromEnv(env);
  if (mode === 'protected' && !verifier) {
    throw new IdentityError(
      500,
      'identity_misconfigured',
      'Protected mode requires an injected session verifier and AUTH_SECRET.',
    );
  }
  if (mode === 'protected' && !env.AUTH_SECRET && !env.NEXTAUTH_SECRET) {
    throw new IdentityError(
      500,
      'identity_misconfigured',
      'Protected mode refuses to boot without AUTH_SECRET.',
    );
  }
  return { mode, ...(verifier ? { verifier } : {}) };
};

export const resolveOwner = async (
  request: IdentityRequest,
  options: IdentityRuntime = runtime,
): Promise<OwnerId> => {
  const headerOwner = request.headers.get('x-owner-id')?.trim() || undefined;
  const cookieOwner = parseCookieValue(request.headers.get('cookie'), OWNER_COOKIE);

  if (options.mode === 'protected') {
    if (!options.verifier) {
      throw new IdentityError(
        500,
        'identity_misconfigured',
        'Protected boot without a verifier fails.',
      );
    }
    const identity = await options.verifier.verify(request);
    if (!identity) {
      throw new IdentityError(401, 'unauthenticated', 'Sign in required.');
    }
    if (identity.expiresAt.getTime() <= Date.now()) {
      throw new IdentityError(401, 'session_expired', 'Session expired.');
    }
    const hint = headerOwner ?? cookieOwner;
    if (hint && hint !== identity.ownerId) {
      throw new IdentityError(409, 'identity_conflict', 'Conflicting identity hints.');
    }
    return identity.ownerId;
  }

  const owner = headerOwner ?? cookieOwner;
  if (!owner) {
    throw new IdentityError(401, 'owner_required', 'Set the X-Owner-Id header.');
  }
  return owner as OwnerId;
};

export const resolveViewerOwner = async (
  cookieValue: string | undefined,
  request: IdentityRequest,
): Promise<OwnerId> => {
  const headers = new Headers(request.headers);
  if (cookieValue && !headers.get('cookie')?.includes(`${OWNER_COOKIE}=`)) {
    const existing = headers.get('cookie');
    headers.set(
      'cookie',
      existing ? `${existing}; ${OWNER_COOKIE}=${cookieValue}` : `${OWNER_COOKIE}=${cookieValue}`,
    );
  }
  if (
    runtime.mode === 'demo' &&
    !headers.get('x-owner-id') &&
    !parseCookieValue(headers.get('cookie'), OWNER_COOKIE)
  ) {
    return DEFAULT_OWNER;
  }
  return resolveOwner({ headers });
};
