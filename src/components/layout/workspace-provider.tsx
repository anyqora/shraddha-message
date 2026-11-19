"use client";

/**
 * WorkspaceProvider — app-shell UI state shared by the sidebar, the top
 * bar, the right-hand side panel and any page inside the dashboard.
 *
 *   const ws = useWorkspace();
 *
 * Side panel (renders beside <main>, see `side-panel.tsx`):
 *   ws.panel                         current panel or null:
 *                                      { kind: "search" }
 *                                      { kind: "record", object, id }
 *                                      { kind: "new-record", object, defaults }
 *   ws.openSearch()                  open the Search (⌘K) command panel
 *   ws.openRecord(object, id)        show a record (contacts/companies/tasks/deals)
 *   ws.openNewRecord(object, defaults?)  show the "new record" form
 *   ws.closePanel()
 *   ws.panelWidth / ws.setPanelWidth(px)   clamped to PANEL_CONSTRAINTS, persisted
 *
 * Data refresh:
 *   ws.revision / ws.bumpRevision()  bump after a write made from the panel so
 *                                    record lists can refetch (depend on `revision`).
 *
 * Sidebar:
 *   ws.navCollapsed / ws.toggleNav()       desktop icon-only mode, persisted
 *   ws.navWidth / ws.setNavWidth(px)       drag-resizable width, persisted
 *   ws.mobileNavOpen / ws.setMobileNavOpen(open)   mobile drawer
 *
 * Global keys: ⌘K / Ctrl+K toggles Search; Escape closes the panel unless focus
 * is in a text field or inside a dialog/menu/listbox.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Record kinds the side panel can show. */
export type WorkspaceObject = "contacts" | "companies" | "tasks" | "deals";

export type WorkspacePanel =
  | { kind: "search" }
  | { kind: "record"; object: WorkspaceObject; id: string }
  | {
      kind: "new-record";
      object: WorkspaceObject;
      defaults?: Record<string, unknown>;
    };

export interface WorkspaceContextValue {
  panel: WorkspacePanel | null;
  openRecord: (object: WorkspaceObject, id: string) => void;
  openSearch: () => void;
  openNewRecord: (
    object: WorkspaceObject,
    defaults?: Record<string, unknown>,
  ) => void;
  closePanel: () => void;
  panelWidth: number;
  setPanelWidth: (width: number) => void;
  navCollapsed: boolean;
  toggleNav: () => void;
  navWidth: number;
  setNavWidth: (width: number) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  revision: number;
  bumpRevision: () => void;
}

export const PANEL_CONSTRAINTS = { min: 320, max: 600, default: 400 } as const;
export const NAV_CONSTRAINTS = {
  min: 180,
  max: 350,
  default: 220,
  collapsed: 48,
} as const;

const PANEL_WIDTH_KEY = "aq.panelWidth";
const NAV_WIDTH_KEY = "aq.navWidth";
const NAV_COLLAPSED_KEY = "aq.navCollapsed";

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function readWidth(key: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? clamp(raw, min, max) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [panelWidth, setPanelWidthState] = useState(() =>
    readWidth(
      PANEL_WIDTH_KEY,
      PANEL_CONSTRAINTS.default,
      PANEL_CONSTRAINTS.min,
      PANEL_CONSTRAINTS.max,
    ),
  );
  const [navCollapsed, setNavCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [navWidth, setNavWidthState] = useState(() =>
    readWidth(
      NAV_WIDTH_KEY,
      NAV_CONSTRAINTS.default,
      NAV_CONSTRAINTS.min,
      NAV_CONSTRAINTS.max,
    ),
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  const setPanelWidth = useCallback((width: number) => {
    const next = clamp(width, PANEL_CONSTRAINTS.min, PANEL_CONSTRAINTS.max);
    setPanelWidthState(next);
    persist(PANEL_WIDTH_KEY, String(next));
  }, []);

  const setNavWidth = useCallback((width: number) => {
    const next = clamp(width, NAV_CONSTRAINTS.min, NAV_CONSTRAINTS.max);
    setNavWidthState(next);
    persist(NAV_WIDTH_KEY, String(next));
  }, []);

  const toggleNav = useCallback(() => {
    setNavCollapsed((prev) => {
      persist(NAV_COLLAPSED_KEY, prev ? "0" : "1");
      return !prev;
    });
  }, []);

  const openRecord = useCallback(
    (object: WorkspaceObject, id: string) =>
      setPanel({ kind: "record", object, id }),
    [],
  );
  const openSearch = useCallback(() => setPanel({ kind: "search" }), []);
  const openNewRecord = useCallback(
    (object: WorkspaceObject, defaults?: Record<string, unknown>) =>
      setPanel({ kind: "new-record", object, defaults }),
    [],
  );
  const closePanel = useCallback(() => setPanel(null), []);
  const bumpRevision = useCallback(() => setRevision((r) => r + 1), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPanel((p) => (p?.kind === "search" ? null : { kind: "search" }));
      } else if (e.key === "Escape") {
        const el = document.activeElement as HTMLElement | null;
        const typing =
          !!el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable);
        const inOverlay = el?.closest(
          '[role="dialog"],[role="menu"],[role="listbox"]',
        );
        if (!typing && !inOverlay) setPanel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      panel,
      openRecord,
      openSearch,
      openNewRecord,
      closePanel,
      panelWidth,
      setPanelWidth,
      navCollapsed,
      toggleNav,
      navWidth,
      setNavWidth,
      mobileNavOpen,
      setMobileNavOpen,
      revision,
      bumpRevision,
    }),
    [
      panel,
      openRecord,
      openSearch,
      openNewRecord,
      closePanel,
      panelWidth,
      setPanelWidth,
      navCollapsed,
      toggleNav,
      navWidth,
      setNavWidth,
      mobileNavOpen,
      revision,
      bumpRevision,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  }
  return ctx;
}
