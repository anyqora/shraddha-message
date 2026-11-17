import { requireUser } from "@/lib/auth";
import { Notice, Field } from "@/components/ui";
import { changeMyAccount } from "../actions";

const ERR: Record<string, string> = {
  pw: "Current password is wrong.",
  short: "New password must be at least 8 characters.",
  dup: "That email is already used by another user.",
};

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  return (
    <>
      {sp.saved && <Notice tone="success">Account updated.</Notice>}
      {sp.error && <Notice tone="error">{ERR[sp.error] ?? "Something went wrong."}</Notice>}
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-semibold">My account</h2>
          <p className="text-sm text-ink-3">Your name, sign-in email and password.</p>
        </div>
        <form action={changeMyAccount} className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input name="name" defaultValue={me.name} className="input" /></Field>
          <Field label="Email"><input name="email" type="email" defaultValue={me.email} className="input" /></Field>
          <Field label="New password" hint="Leave blank to keep the current one."><input name="password" type="password" autoComplete="new-password" className="input" /></Field>
          <Field label="Current password *"><input name="current" type="password" required autoComplete="current-password" className="input" /></Field>
          <div><button className="btn btn-primary">Update account</button></div>
        </form>
      </section>
    </>
  );
}
