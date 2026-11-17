import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { IconUserPlus } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { consumeToken, findValidToken } from "@/app/reset-password/tokens";

export const dynamic = "force-dynamic";

async function acceptInvite(token: string, fd: FormData) {
  "use server";
  const name = String(fd.get("name") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const base = `/invite/${encodeURIComponent(token)}`;
  if (password.length < 8) redirect(`${base}?error=short`);
  const row = await findValidToken(token, "invite");
  if (!row) redirect(base);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, row.email.toLowerCase())).limit(1);
  if (existing) redirect(`${base}?error=dup`);
  if (!(await consumeToken(row.id))) redirect(base);
  const id = crypto.randomUUID();
  try {
    await db.insert(users).values({ id, email: row.email.toLowerCase(), name, role: row.role, passwordHash: await hashPassword(password) });
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") redirect(`${base}?error=dup`);
    throw e;
  }
  await createSession(id);
  redirect("/");
}

const ERR: Record<string, string> = {
  short: "Password must be at least 8 characters.",
  dup: "An account with this email already exists. Sign in instead.",
};

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const row = await findValidToken(token, "invite");
  const appName = process.env.APP_NAME || "Shraddha Message";
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <form action={acceptInvite.bind(null, token)} className="card w-full max-w-sm space-y-4 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 pb-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-white">
            <IconUserPlus size={22} />
          </span>
          <h1 className="text-base font-semibold">Join {appName}</h1>
          {row && (
            <p className="text-sm text-ink-3">
              You&apos;ve been invited as {row.role === "admin" ? "an admin" : "an agent"} ({row.email}).
            </p>
          )}
        </div>
        {!row ? (
          <div className="rounded-sm border border-[#ffd1d1] bg-[#fff5f5] px-3 py-2 text-sm text-danger">
            This invite link is invalid, already used or expired. Ask an admin for a new one.
          </div>
        ) : (
          <>
            {error && <div className="rounded-sm border border-[#ffd1d1] bg-[#fff5f5] px-3 py-2 text-sm text-danger">{ERR[error] ?? "Something went wrong."}</div>}
            <label className="block">
              <span className="label">Your name</span>
              <input name="name" required autoComplete="name" className="input h-9" />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input h-9" placeholder="At least 8 characters" />
            </label>
            <button className="btn btn-primary h-9 w-full justify-center">Create account</button>
          </>
        )}
        <div className="text-center text-sm">
          <Link href="/login" className="text-ink-3 hover:text-ink">Already have an account? Sign in</Link>
        </div>
      </form>
    </div>
  );
}
