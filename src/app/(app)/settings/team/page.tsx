import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { IconLink, IconTrash, IconX } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { authTokens, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { mailConfigured } from "@/lib/mailer";
import { Notice, Chip, Avatar } from "@/components/ui";
import { ActionButton } from "@/components/settings-action-button";
import { InviteForm } from "@/components/settings-invite-form";
import { timeAgo, formatDateTime } from "@/lib/utils";
import { addUser, createInvite, createResetLink, removeUser, revokeInvite } from "../actions";

const ERR: Record<string, string> = {
  dup: "That email is already used by another user.",
  user: "Enter an email and a password of at least 8 characters.",
};

export default async function TeamSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const isAdmin = me.role === "admin";
  const [team, invites, smtp] = await Promise.all([
    db.select().from(users).orderBy(asc(users.createdAt)),
    isAdmin
      ? db
          .select()
          .from(authTokens)
          .where(and(eq(authTokens.kind, "invite"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
          .orderBy(desc(authTokens.createdAt))
      : Promise.resolve([]),
    mailConfigured(),
  ]);

  return (
    <>
      {sp.saved && <Notice tone="success">User added.</Notice>}
      {sp.error && <Notice tone="error">{ERR[sp.error] ?? "Something went wrong."}</Notice>}

      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">Team</div>
          <div className="text-sm text-ink-3">People who can sign in to this workspace.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-grid w-full">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign in</th>{isAdmin && <th className="w-10"></th>}</tr></thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id}>
                  <td><span className="flex items-center gap-2"><Avatar name={u.name || u.email} size={20} />{u.name || "—"}</span></td>
                  <td className="text-ink-2">{u.email}</td>
                  <td><Chip color={u.role === "admin" ? "purple" : "gray"}>{u.role}</Chip></td>
                  <td className="text-ink-2">{timeAgo(u.lastSignInAt) || "never"}</td>
                  {isAdmin && (
                    <td>
                      <span className="flex items-center gap-1">
                        <ActionButton action={createResetLink.bind(null, u.id)} label="Reset link" pendingLabel="…" className="btn btn-ghost h-6 text-xs" icon={<IconLink size={13} />} />
                        {u.id !== me.id && (
                          <form action={removeUser.bind(null, u.id)}>
                            <button className="rounded-sm p-1 text-ink-3 hover:text-danger" title="Remove"><IconTrash size={14} /></button>
                          </form>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <>
            <InviteForm action={createInvite} />
            <div className="px-3 pb-3 text-xs text-ink-3">
              {smtp ? "The invite link is emailed and shown here to copy." : "SMTP isn't configured — copy the link and send it yourself (Settings → Email to enable emails)."} Links are valid for 7 days.
            </div>
          </>
        )}
      </section>

      {isAdmin && invites.length > 0 && (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 font-semibold">Pending invites</div>
          <table className="table-grid w-full">
            <thead><tr><th>Email</th><th>Role</th><th>Sent</th><th>Expires</th><th className="w-10"></th></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td><Chip color={i.role === "admin" ? "purple" : "gray"}>{i.role}</Chip></td>
                  <td className="text-ink-2">{timeAgo(i.createdAt)}</td>
                  <td className="text-ink-2">{formatDateTime(i.expiresAt)}</td>
                  <td>
                    <form action={revokeInvite.bind(null, i.id)}>
                      <button className="rounded-sm p-1 text-ink-3 hover:text-danger" title="Revoke"><IconX size={14} /></button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {isAdmin && (
        <section className="card space-y-2 p-4">
          <div>
            <h2 className="font-semibold">Add user directly</h2>
            <p className="text-sm text-ink-3">Create an account with a password you choose and share it yourself.</p>
          </div>
          <form action={addUser} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
            <input name="name" placeholder="Name" className="input" />
            <input name="email" type="email" required placeholder="Email" className="input" />
            <input name="password" type="password" required minLength={8} placeholder="Password (8+ chars)" className="input" autoComplete="new-password" />
            <select name="role" className="input w-auto"><option value="agent">Agent</option><option value="admin">Admin</option></select>
            <button className="btn btn-primary">Add user</button>
          </form>
        </section>
      )}
    </>
  );
}
