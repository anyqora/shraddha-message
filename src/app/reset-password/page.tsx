import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { IconLock } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { sessions, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { consumeToken, findValidToken } from "./tokens";

export const dynamic = "force-dynamic";

async function resetPassword(fd: FormData) {
  "use server";
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const q = `token=${encodeURIComponent(token)}`;
  if (password.length < 8) redirect(`/reset-password?${q}&error=short`);
  if (password !== confirm) redirect(`/reset-password?${q}&error=match`);
  const row = await findValidToken(token, "reset");
  if (!row?.userId) redirect(`/reset-password?${q}`);
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, row.userId)).limit(1);
  if (!u || !(await consumeToken(row.id))) redirect(`/reset-password?${q}`);
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, u.id));
  await db.delete(sessions).where(eq(sessions.userId, u.id));
  await createSession(u.id);
  redirect("/");
}

const ERR: Record<string, string> = {
  short: "Password must be at least 8 characters.",
  match: "Passwords don't match.",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token = "", error } = await searchParams;
  const row = await findValidToken(token, "reset");
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <form action={resetPassword} className="card w-full max-w-sm space-y-4 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 pb-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-white">
            <IconLock size={22} />
          </span>
          <h1 className="text-base font-semibold">Choose a new password</h1>
          {row && <p className="text-sm text-ink-3">for {row.email}</p>}
        </div>
        {!row ? (
          <div className="rounded-sm border border-[#ffd1d1] bg-[#fff5f5] px-3 py-2 text-sm text-danger">
            This reset link is invalid, already used or expired. <Link href="/forgot-password" className="underline">Request a new one</Link>.
          </div>
        ) : (
          <>
            {error && <div className="rounded-sm border border-[#ffd1d1] bg-[#fff5f5] px-3 py-2 text-sm text-danger">{ERR[error] ?? "Something went wrong."}</div>}
            <input type="hidden" name="token" value={token} />
            <label className="block">
              <span className="label">New password</span>
              <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input h-9" />
            </label>
            <label className="block">
              <span className="label">Confirm password</span>
              <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className="input h-9" />
            </label>
            <button className="btn btn-primary h-9 w-full justify-center">Set password &amp; sign in</button>
          </>
        )}
        <div className="text-center text-sm">
          <Link href="/login" className="text-ink-3 hover:text-ink">Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
