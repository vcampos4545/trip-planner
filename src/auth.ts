import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Google from "next-auth/providers/google";

import { db } from "@/server/db";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The Prisma adapter, minus OAuth token storage. Sign-in only needs the account link, so the
 * Google access, refresh, and ID tokens are dropped instead of being kept in the database.
 */
function createAdapter(): Adapter {
  // The adapter is typed against @prisma/client; the generated client is structurally the same.
  const base = PrismaAdapter(
    db as unknown as Parameters<typeof PrismaAdapter>[0],
  );
  return {
    ...base,
    linkAccount: (account) =>
      base.linkAccount!({
        ...account,
        access_token: undefined,
        refresh_token: undefined,
        id_token: undefined,
        session_state: undefined,
      }),
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createAdapter(),
  providers: [Google],
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 24 * 60 * 60,
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});

export function isGoogleAuthConfigured() {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
