import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { IconKey } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { actionEmail, mailConfigured, sendMail } from "@/lib/mailer";
import { createAuthToken } from "../reset-password/tokens";

export const dynamic = "force-dynamic";

async function requestReset(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (email && (await mailConfigured())) {
    const [u] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
    if (u) {
      const { url } = await createAuthToken({ kind: "reset", email: u.email, userId: u.id });
      const mail = actionEmail({
        heading: "Reset your password",
        intro: "Someone (hopefully you) asked to reset the password for your account. The link is valid for 1 hour.",
        cta: "Choose a new password",
        url,
        footer: "If you didn't ask for this you can ignore this email.",
      });
      const r = await sendMail({ to: u.email, subject: "Reset your password", ...mail });
      if (!r.ok) console.error("[forgot-password] mail failed:", r.error);
    }
  }
  redirect("/forgot-password?sent=1");
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { sent } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <form action={requestReset} className="card w-full max-w-sm space-y-4 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 pb-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-white">
            <IconKey size={22} />
          </span>
          <h1 className="text-base font-semibold">Forgot your password?</h1>
          <p className="text-sm text-ink-3">Enter your email and we&apos;ll send you a reset link.</p>
        </div>
        {sent ? (
          <div className="rounded-sm border border-[#c9ecd3] bg-[#f3fbf5] px-3 py-2 text-sm text-[#1e6b30]">
            If an account exists for that email, a reset link is on its way. It is valid for 1 hour. No email? Ask an admin for a reset link.
          </div>
        ) : (
          <>
            <label className="block">
              <span className="label">Email</span>
              <input name="email" type="email" required autoComplete="email" className="input h-9" placeholder="you@example.com" />
            </label>
            <button className="btn btn-primary h-9 w-full justify-center">Send reset link</button>
          </>
        )}
        <div className="text-center text-sm">
          <Link href="/login" className="text-ink-3 hover:text-ink">Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
