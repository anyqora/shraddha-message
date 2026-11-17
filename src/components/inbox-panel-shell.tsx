"use client";

import { useEffect, useState } from "react";
import { IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand } from "@tabler/icons-react";

const KEY = "inbox.panel.collapsed";

/** Collapsible right-hand column for the chat view. Remembers its state per browser. */
export function InboxPanelShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === "1");
    } catch {}
  }, []);
  const set = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {}
  };

  if (collapsed) {
    return (
      <div className="hidden w-9 shrink-0 flex-col lg:flex items-center border-l border-line pt-2">
        <button type="button" title="Show contact details" className="btn btn-ghost h-7 px-1.5" onClick={() => set(false)}>
          <IconLayoutSidebarRightExpand size={15} />
        </button>
      </div>
    );
  }
  return (
    <aside className="relative hidden w-[280px] shrink-0 flex-col border-l border-line lg:flex">
      <button type="button" title="Hide contact details" className="btn btn-ghost absolute top-2 right-2 z-10 h-7 px-1.5" onClick={() => set(true)}>
        <IconLayoutSidebarRightCollapse size={15} />
      </button>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </aside>
  );
}
