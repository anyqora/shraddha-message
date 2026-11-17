import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Sidebar } from "@/components/sidebar";
import { audit } from "@/lib/audit";
import { destroySession, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { contacts } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { getPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

async function logout() {
  "use server";
  await audit("auth.logout", { entity: "users" });
  await destroySession();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [[u], s, permissions] = await Promise.all([
    db.select({ n: sql<number>`coalesce(sum(${contacts.unreadCount}),0)` }).from(contacts),
    getSettings(),
    getPermissions(user.role),
  ]);
  return (
    <div className="flex h-screen min-h-0">
      <Sidebar
        appName={process.env.APP_NAME || "Shraddha Message"}
        user={{ name: user.name, email: user.email, role: user.role }}
        permissions={permissions}
        unread={Number(u?.n ?? 0)}
        connected={Boolean(s.waAccessToken && s.waPhoneNumberId)}
        logout={logout}
      />
      <main className="min-w-0 flex-1 py-2 pr-2">{children}</main>
    </div>
  );
}
