"use client";

/**
 * Right-hand side panel, rendered beside <main> by the dashboard shell.
 * Shows whatever `useWorkspace().panel` holds: the Search command panel, a
 * record (<RecordShow>) or a new-record form (<NewRecordForm>). Drag the left
 * edge to resize (double-click resets); full-screen overlay below `md`.
 */

import { useCallback, useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { IconX } from "@tabler/icons-react";
import {
  PANEL_CONSTRAINTS,
  useWorkspace,
} from "@/components/layout/workspace-provider";
import { SearchPanel } from "@/components/layout/search-panel";
import { NewRecordForm, RecordShow } from "@/components/records/record-panel";
import { cn } from "@/lib/utils";

export function SidePanel() {
  const t = useTranslations("Workspace");
  const { panel, closePanel, panelWidth, setPanelWidth } = useWorkspace();
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; w: number } | null>(null);
  const open = panel !== null;

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      dragStart.current = { x: e.clientX, w: panelWidth };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [panelWidth],
  );
  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (dragStart.current) {
        setPanelWidth(dragStart.current.w - (e.clientX - dragStart.current.x));
      }
    },
    [setPanelWidth],
  );
  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    setDragging(false);
  }, []);

  const heading =
    panel?.kind === "search"
      ? t("search")
      : panel?.kind === "new-record"
        ? t("newRecord")
        : t("record");

  return (
    <aside
      aria-hidden={!open}
      style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
      className={cn(
        "fixed inset-0 z-50 flex min-w-0 shrink-0 flex-col overflow-clip bg-panel md:relative md:inset-auto md:z-0 md:bg-transparent",
        open ? "md:w-[var(--panel-w)]" : "pointer-events-none hidden md:flex md:w-0",
        !dragging && "md:transition-[width] md:duration-300 md:ease-in-out",
      )}
    >
      <div className="relative flex h-full min-w-0 flex-col overflow-clip md:w-[var(--panel-w)] md:py-2 md:pr-2">
        <div
          className={cn(
            "flex h-full min-h-0 flex-col overflow-clip bg-panel md:rounded-lg md:border md:border-border",
            open ? "opacity-100" : "opacity-0",
            "transition-opacity duration-150",
          )}
        >
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
            <span className="px-1 text-[13px] font-medium text-muted-foreground">
              {heading}
            </span>
            <button
              type="button"
              onClick={closePanel}
              aria-label={t("closePanel")}
              className="flex size-7 items-center justify-center rounded-sm text-tertiary-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <IconX size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {panel?.kind === "search" && <SearchPanel />}
            {panel?.kind === "record" && (
              <RecordShow
                key={`${panel.object}:${panel.id}`}
                object={panel.object}
                id={panel.id}
              />
            )}
            {panel?.kind === "new-record" && (
              <NewRecordForm
                key={`new:${panel.object}`}
                object={panel.object}
                defaults={panel.defaults}
              />
            )}
          </div>
        </div>
        {open && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resizePanel")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => setPanelWidth(PANEL_CONSTRAINTS.default)}
            className="absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1 cursor-col-resize md:block"
          />
        )}
      </div>
    </aside>
  );
}
