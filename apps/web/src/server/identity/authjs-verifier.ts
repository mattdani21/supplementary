import { createHash } from 'node:crypto';
import type { OwnerId } from '@gapos/database';
import type { IdentityRequest, IdentityVerifier, VerifiedIdentity } from './port.js';

export const ownerIdFromSubject = (subject: string): OwnerId =>
  `usr_${createHash('sha256').update(subject).digest('hex').slice(0, 16)}` as OwnerId;

export const subjectIsInvited = (
  subject: string,
  env: Record<string, string | undefined> = process.env,
): boolean => {
  const allow = (env.GAPOS_INVITE_SUBJECTS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (allow.length === 0) return false;
  return allow.includes(subject);
};

/**
 * Auth.js session adapter. Reads the already-verified session from the Auth.js `auth()` helper.
 * The helper is injected so this module does not import NextAuth at test load time.
 */
export const createAuthJsVerifier = (
  readSession: () => Promise<{
    subject?: string | null;
    expires?: string | Date | null;
  } | null>,
  env: Record<string, string | undefined> = process.env,
): IdentityVerifier => ({
  async verify(_request: IdentityRequest): Promise<VerifiedIdentity | undefined> {
    const session = await readSession();
    const subject = session?.subject?.trim();
    if (!subject || !session?.expires) return undefined;
    if (!subjectIsInvited(subject, env)) return undefined;
    const expiresAt = session.expires instanceof Date ? session.expires : new Date(session.expires);
    return {
      subject,
      ownerId: ownerIdFromSubject(subject),
      expiresAt,
    };
  },
});
