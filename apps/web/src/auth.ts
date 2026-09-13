/**
 * Auth.js configuration (GAPX-02). Used only in protected mode.
 * Domain does not import this file.
 */

import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { subjectIsInvited } from './server/identity/authjs-verifier';

const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export const authConfigured = Boolean(secret);

const nextAuth = NextAuth({
  secret: secret ?? 'demo-only-not-valid-in-protected-mode',
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID ?? '',
      clientSecret: process.env.AUTH_GITHUB_SECRET ?? '',
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const subject = profile?.email ?? (profile as { login?: string } | undefined)?.login;
      return typeof subject === 'string' && subjectIsInvited(subject);
    },
    async session({ session, token }) {
      const subject =
        session.user?.email ?? (typeof token.email === 'string' ? token.email : undefined);
      return {
        ...session,
        subject,
      };
    },
  },
});

export const handlers = nextAuth.handlers as {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
};

export const auth: () => Promise<{
  user?: { email?: string | null };
  expires: string;
  subject?: string;
} | null> = nextAuth.auth as () => Promise<{
  user?: { email?: string | null };
  expires: string;
  subject?: string;
} | null>;
