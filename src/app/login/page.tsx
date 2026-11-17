import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { IconBrandWhatsapp } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { createSession, getCurrentUser } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const [u] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
  if (!u || !(await verifyPassword(password, u.passwordHash))) redirect("/login?error=1");
  await createSession(u.id);
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(users);
  if (Number(n) === 0) redirect("/setup");
  const { error } = await searchParams;
  const appName = process.env.APP_NAME || "Shraddha Message";
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <form action={login} className="card w-full max-w-sm space-y-4 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 pb-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-white">
            <IconBrandWhatsapp size={22} />
          </span>
          <h1 className="text-base font-semibold">Welcome to {appName}</h1>
          <p className="text-sm text-ink-3">Sign in to your account</p>
        </div>
        {error && <div className="rounded-sm border border-[#ffd1d1] bg-[#fff5f5] px-3 py-2 text-sm text-danger">Invalid email or password</div>}
        <label className="block">
          <span className="label">Email</span>
          <input name="email" type="email" required autoComplete="email" className="input h-9" placeholder="you@example.com" />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="input h-9" />
        </label>
        <button className="btn btn-primary h-9 w-full justify-center">Sign in</button>
      </form>
    </div>
  );
}
