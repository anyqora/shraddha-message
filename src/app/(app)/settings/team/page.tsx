import { Fragment } from "react";
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
import { RoleSelect } from "@/components/settings-role-select";
import { getSettings } from "@/lib/settings";
import { can, GRANTABLE_ROLES, PERMISSIONS, ROLE_LABELS, parseGrants } from "@/lib/permissions";
import { addUser, createInvite, createResetLink, removeUser, revokeInvite, savePermissions, setUserRole } from "../actions";
import { requirePagePermission } from "@/lib/permissions";

const ERR: Record<string, string> = {
  dup: "That email is already used by another user.",
  user: "Enter an email and a password of at least 8 characters.",
};

export default async function TeamSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requirePagePermission("settings.team");
  const sp = await searchParams;
  const me = await requireUser();
  // page is gated on settings.team; only admins can touch admins or edit the permission matrix
  const isAdmin = me.role === "admin";
  const canManage = await can(me, "settings.team");
  const [team, invites, smtp, s] = await Promise.all([
    db.select().from(users).orderBy(asc(users.createdAt)),
    canManage
      ? db
          .select()
          .from(authTokens)
          .where(and(eq(authTokens.kind, "invite"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
          .orderBy(desc(authTokens.createdAt))
      : Promise.resolve([]),
    mailConfigured(),
    getSettings(),
  ]);
  const grants = parseGrants(s.permissions);
  const roleOptions = (["admin", "manager", "agent"] as const)
    .filter((r) => isAdmin || r !== "admin")
    .map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];
  const roleColor = (r: string) => (r === "admin" ? "purple" : r === "manager" ? "blue" : "gray");

  return (
    <>
      {sp.saved && <Notice tone="success">{sp.saved === "perms" ? "Permissions saved." : "User added."}</Notice>}
      {sp.error && <Notice tone="error">{ERR[sp.error] ?? "Something went wrong."}</Notice>}

      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">Team</div>
          <div className="text-sm text-ink-3">People who can sign in to this workspace.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-grid w-full">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign in</th>{canManage && <th className="w-10"></th>}</tr></thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id}>
                  <td><span className="flex items-center gap-2"><Avatar name={u.name || u.email} size={20} />{u.name || "—"}</span></td>
                  <td className="text-ink-2">{u.email}</td>
                  <td>
                    {canManage && (isAdmin || u.role !== "admin") ? (
                      <RoleSelect role={u.role} options={roleOptions} action={setUserRole.bind(null, u.id)} />
                    ) : (
                      <Chip color={roleColor(u.role)}>{ROLE_LABELS[u.role] ?? u.role}</Chip>
                    )}
                  </td>
                  <td className="text-ink-2">{timeAgo(u.lastSignInAt) || "never"}</td>
                  {canManage && (
                    <td>
                      {(isAdmin || u.role !== "admin") && <span className="flex items-center gap-1">
                        <ActionButton action={createResetLink.bind(null, u.id)} label="Reset link" pendingLabel="…" className="btn btn-ghost h-6 text-xs" icon={<IconLink size={13} />} />
                        {u.id !== me.id && (
                          <form action={removeUser.bind(null, u.id)}>
                            <button className="rounded-sm p-1 text-ink-3 hover:text-danger" title="Remove"><IconTrash size={14} /></button>
                          </form>
                        )}
                      </span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && (
          <>
            <InviteForm action={createInvite} allowAdmin={isAdmin} />
            <div className="px-3 pb-3 text-xs text-ink-3">
              {smtp ? "The invite link is emailed and shown here to copy." : "SMTP isn't configured — copy the link and send it yourself (Settings → Email to enable emails)."} Links are valid for 7 days.
            </div>
          </>
        )}
      </section>

      {canManage && invites.length > 0 && (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 font-semibold">Pending invites</div>
          <table className="table-grid w-full">
            <thead><tr><th>Email</th><th>Role</th><th>Sent</th><th>Expires</th><th className="w-10"></th></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td><Chip color={roleColor(i.role)}>{ROLE_LABELS[i.role] ?? i.role}</Chip></td>
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

      {canManage && (
        <section className="card space-y-2 p-4">
          <div>
            <h2 className="font-semibold">Add user directly</h2>
            <p className="text-sm text-ink-3">Create an account with a password you choose and share it yourself.</p>
          </div>
          <form action={addUser} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
            <input name="name" placeholder="Name" className="input" />
            <input name="email" type="email" required placeholder="Email" className="input" />
            <input name="password" type="password" required minLength={8} placeholder="Password (8+ chars)" className="input" autoComplete="new-password" />
            <select name="role" className="input w-auto">{roleOptions.slice().reverse().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <button className="btn btn-primary">Add user</button>
          </form>
        </section>
      )}

      {isAdmin && (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="font-semibold">Roles &amp; permissions</div>
            <div className="text-sm text-ink-3">Admins can do everything. Choose what managers and agents can access.</div>
          </div>
          <form action={savePermissions}>
            <div className="overflow-x-auto">
              <table className="table-grid w-full">
                <thead>
                  <tr>
                    <th>Permission</th>
                    <th className="w-24 text-center">Admin</th>
                    {GRANTABLE_ROLES.map((r) => <th key={r} className="w-24 text-center">{ROLE_LABELS[r]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g}>
                      <tr><td colSpan={2 + GRANTABLE_ROLES.length} className="bg-soft text-xs font-medium text-ink-3">{g}</td></tr>
                      {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                        <tr key={p.key}>
                          <td>{p.label} <span className="text-xs text-ink-4">{p.key}</span></td>
                          <td className="text-center"><input type="checkbox" checked disabled aria-label={`Admin: ${p.label}`} /></td>
                          {GRANTABLE_ROLES.map((r) => (
                            <td key={r} className="text-center">
                              <input type="checkbox" name={`perm:${r}:${p.key}`} defaultChecked={grants[r].includes(p.key)} aria-label={`${ROLE_LABELS[r]}: ${p.label}`} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="agentSeesOnlyOwnChats" defaultChecked={s.agentSeesOnlyOwnChats} />
                Agents only see chats assigned to them (plus unassigned)
              </label>
              <button className="btn btn-primary">Save permissions</button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
