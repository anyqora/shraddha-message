import { IconSettings } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { Page } from "@/components/ui";
import { SettingsNav } from "@/components/settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <Page title="Settings" icon={<IconSettings />} noPad>
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <SettingsNav />
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mx-auto max-w-3xl space-y-6">{children}</div>
        </div>
      </div>
    </Page>
  );
}
