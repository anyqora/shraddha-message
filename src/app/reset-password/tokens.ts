import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { authTokens } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { appUrl } from "@/lib/mailer";

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
export const INVITE_TTL_MS = 7 * 864e5; // 7 days

export async function createAuthToken(opts: {
  kind: "reset" | "invite";
  email: string;
  userId?: string | null;
  role?: "admin" | "agent";
}): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (opts.kind === "reset" ? RESET_TTL_MS : INVITE_TTL_MS));
  await db.insert(authTokens).values({
    id: sha256(token),
    kind: opts.kind,
    userId: opts.userId ?? null,
    email: opts.email,
    role: opts.role ?? "agent",
    expiresAt,
  });
  const url = opts.kind === "reset" ? `${appUrl()}/reset-password?token=${token}` : `${appUrl()}/invite/${token}`;
  return { token, url, expiresAt };
}

/** A token that exists, is of the right kind, unused and not expired. */
export async function findValidToken(token: string, kind: "reset" | "invite") {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.id, sha256(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Atomically mark a token used. Returns false if someone else used it first. */
export async function consumeToken(id: string): Promise<boolean> {
  const r: any = await db.update(authTokens).set({ usedAt: new Date() }).where(and(eq(authTokens.id, id), isNull(authTokens.usedAt)));
  const affected = r?.[0]?.affectedRows ?? r?.affectedRows;
  return affected === undefined ? true : affected > 0;
}
