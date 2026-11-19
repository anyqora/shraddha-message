"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { WorkspaceProvider } from "@/components/layout/workspace-provider";
import { PageChromeProvider, TopBar } from "@/components/layout/page-chrome";
import { Sidebar } from "@/components/layout/sidebar";
import { SidePanel } from "@/components/layout/side-panel";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { BrowserNotificationsListener } from "@/components/notifications/browser-notifications-listener";
import { cn } from "@/lib/utils";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.
//
// Layout (Twenty-CRM style): grey frame → sidebar | (top bar + white
// rounded content card) | optional right side panel.

/** Record pages manage their own scrolling and edge-to-edge tables. */
const FULL_BLEED_PREFIXES = ["/contacts", "/companies", "/tasks"];

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("DashboardShell");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-frame">
        <div className="flex flex-col items-center gap-3">
          <div className="size-6 animate-spin rounded-full border-2 border-foreground/70 border-t-transparent" />
          <p className="text-[13px] text-tertiary-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const fullBleed = FULL_BLEED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  return (
    <WorkspaceProvider>
      <PageChromeProvider>
        <div className="flex h-dvh overflow-clip bg-frame">
          {/* Reports this tab's online/away presence. Headless. */}
          <PresenceHeartbeat />
          {/* Desktop alerts for new customer messages (opt-in). Headless. */}
          <BrowserNotificationsListener />
          <Sidebar />
          <div className="flex min-w-0 flex-1 overflow-clip">
            <div className="flex min-w-0 flex-1 flex-col pb-2 lg:pr-2">
              <TopBar />
              <main className="relative min-h-0 flex-1 overflow-hidden border-y border-border bg-panel sm:mx-2 sm:rounded-lg sm:border lg:mx-0">
                <div
                  className={cn(
                    "h-full",
                    fullBleed ? "overflow-hidden" : "overflow-y-auto p-4 sm:p-6",
                  )}
                >
                  {/* Writes are being rejected and here's why. Renders
                      nothing unless the account/role failed to resolve. */}
                  <AccountAccessAlert />
                  {children}
                </div>
              </main>
            </div>
            <SidePanel />
          </div>
        </div>
      </PageChromeProvider>
    </WorkspaceProvider>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
