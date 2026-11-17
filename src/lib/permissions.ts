import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@/db/schema";
import { requireUser } from "./auth";
import { getSettings } from "./settings";
import { ALL_PERMISSION_KEYS, parseGrants, type PermissionKey, type Role } from "./permission-keys";

export * from "./permission-keys";

const loadGrants = cache(async () => parseGrants((await getSettings()).permissions));

/** Permission keys granted to a role. Admin always has everything. */
export async function getPermissions(role: Role | string): Promise<PermissionKey[]> {
  if (role === "admin") return [...ALL_PERMISSION_KEYS];
  const grants = await loadGrants();
  return role === "manager" ? grants.manager : grants.agent;
}

export async function can(user: Pick<User, "role">, key: PermissionKey): Promise<boolean> {
  if (user.role === "admin") return true;
  return (await getPermissions(user.role)).includes(key);
}

/** Pages: redirect to the dashboard with ?denied=1 when the user lacks `key`. */
export async function requirePagePermission(key: PermissionKey): Promise<User> {
  const user = await requireUser();
  if (!(await can(user, key))) redirect("/?denied=1");
  return user;
}

/** Server actions / route handlers: throw when the user lacks `key`. */
export async function assertPermission(key: PermissionKey): Promise<User> {
  const user = await requireUser();
  if (!(await can(user, key))) throw new Error("You don't have permission to do this.");
  return user;
}

export const requirePermission = requirePagePermission;

/**
 * Inbox scoping: true when this user may only see chats assigned to them or unassigned.
 * Applies when they lack `inbox.all_chats`, or they're an agent and "agents only see own chats" is on.
 */
export async function inboxRestricted(user: Pick<User, "role">): Promise<boolean> {
  if (user.role === "admin") return false;
  if (!(await can(user, "inbox.all_chats"))) return true;
  return user.role === "agent" && (await getSettings()).agentSeesOnlyOwnChats;
}
