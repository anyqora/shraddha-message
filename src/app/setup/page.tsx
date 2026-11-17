import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function hasUsers() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(users);
  return Number(n) > 0;
}

async function setup(fd: FormData) {
  "use server";
  if (await hasUsers()) redirect("/login");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || password.length < 8) redirect("/setup?error=1");
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email, name: String(fd.get("name") ?? "").trim(), role: "admin", passwordHash: await hashPassword(password) });
  await createSession(id);
  redirect("/settings");
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await hasUsers()) redirect("/login");
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <form action={setup} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-base font-semibold">Create the admin account</h1>
          <p className="text-sm text-ink-3">This page works only once, while no users exist.</p>
        </div>
        {error && <div className="text-sm text-danger">Enter an email and a password of at least 8 characters.</div>}
        <label className="block"><span className="label">Name</span><input name="name" className="input h-9" /></label>
        <label className="block"><span className="label">Email</span><input name="email" type="email" required className="input h-9" /></label>
        <label className="block"><span className="label">Password</span><input name="password" type="password" required minLength={8} className="input h-9" /></label>
        <button className="btn btn-primary h-9 w-full justify-center">Create admin</button>
      </form>
    </div>
  );
}
