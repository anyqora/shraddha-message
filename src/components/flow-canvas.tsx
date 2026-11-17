"use client";

import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type EdgeChange,
  type OnBeforeDelete,
} from "@xyflow/react";
import { IconPlus, IconLayoutDistributeVertical, IconList, IconX, IconUserShare, IconLoader2, IconBolt } from "@tabler/icons-react";
import type { BotRule } from "@/db/schema";
import { cn } from "@/lib/utils";
import { WaText } from "./wa-bubble";
import { FlowRuleEditor } from "./flow-rule-editor";

type Result = { ok: boolean; message: string; rule?: BotRule } | null;
type PosUpdate = { id: string; x: number; y: number };

export type FlowActions = {
  saveNodePositions: (u: PosUpdate[]) => Promise<void>;
  linkOption: (ruleId: string, optionIndex: number, nextRuleId: string | null) => Promise<{ ok: boolean; message?: string; options?: BotRule["options"] }>;
  createFlowStep: (x: number, y: number) => Promise<BotRule>;
  saveRuleInline: (id: string, s: unknown, fd: FormData) => Promise<Result>;
  deleteRule: (id: string) => Promise<void>;
};

const TRIGGER_STYLE: Record<BotRule["trigger"], { label: string; strip: string; chip: string; dot: string }> = {
  welcome: { label: "Welcome", strip: "bg-[#e3f5e8] border-[#c9ecd3]", chip: "bg-white/70 text-[#2f9e44]", dot: "#2f9e44" },
  keyword: { label: "Keyword", strip: "bg-[#e8efff] border-[#d4e2ff]", chip: "bg-white/70 text-[#1961ed]", dot: "#1961ed" },
  menu: { label: "Menu step", strip: "bg-[#f5f5f5] border-[#ebebeb]", chip: "bg-white text-[#666]", dot: "#999999" },
  fallback: { label: "Fallback", strip: "bg-[#fff1e5] border-[#ffe0c7]", chip: "bg-white/70 text-[#e8590c]", dot: "#e8590c" },
};

const NODE_W = 264;

type RuleNodeData = { rule: BotRule };
type RuleNode = Node<RuleNodeData, "rule">;

/* ------------------------------------------------------------------ node */

const RuleNodeView = memo(function RuleNodeView({ id, data, selected }: NodeProps<RuleNode>) {
  const r = data.rule;
  const t = TRIGGER_STYLE[r.trigger];
  const updateInternals = useUpdateNodeInternals();
  const optKey = r.options.map((o) => o.title).join("|") + r.replyType;
  useEffect(() => updateInternals(id), [id, optKey, updateInternals]);
  const kws = r.trigger === "keyword" ? r.keywords.split(",").filter(Boolean) : [];

  return (
    <div
      className={cn(
        "rounded-lg border bg-white text-[13px] shadow-[0_1px_2px_rgba(0,0,0,.04),0_2px_8px_rgba(0,0,0,.04)] transition-shadow",
        selected ? "border-accent ring-2 ring-accent/15" : "border-[#ebebeb] hover:shadow-[0_2px_4px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.06)]",
        !r.active && "opacity-60",
      )}
      style={{ width: NODE_W }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!h-3 !w-3 !border-2 !border-white !bg-[#b3b3b3] !shadow-[0_0_0_1px_#d6d6d6]"
      />
      <div className={cn("rounded-t-lg border-b px-2.5 py-1.5", t.strip)}>
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: t.dot }} />
          <span className="min-w-0 flex-1 truncate font-medium text-[#333]">{r.name}</span>
          <span className={cn("inline-flex h-[18px] items-center rounded-sm px-1.5 text-[11px] font-medium", t.chip)}>{t.label}</span>
        </div>
        {kws.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-[#666]">
            <span className="text-[#999]">{r.matchType}:</span>
            {kws.slice(0, 4).map((k) => (
              <span key={k} className="rounded-sm bg-white/80 px-1 font-mono text-[10.5px] text-[#333]">{k}</span>
            ))}
            {kws.length > 4 && <span>+{kws.length - 4}</span>}
          </div>
        )}
      </div>

      <div className="bg-[#efeae2]/60 px-2.5 py-2">
        <div className="rounded-md bg-[#d9fdd3] px-2 py-1.5 text-[12.5px] leading-[17px] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
          {r.header && <div className="mb-0.5 truncate font-semibold">{r.header}</div>}
          <div className="line-clamp-3 whitespace-pre-wrap break-words"><WaText text={r.body} /></div>
          {r.footer && <div className="mt-0.5 truncate text-[11px] text-[#667781]">{r.footer}</div>}
        </div>
      </div>

      {r.options.length > 0 && (
        <div className="border-t border-[#f1f1f1]">
          {r.replyType === "list" && (
            <div className="px-2.5 pt-1.5 text-[11px] font-medium text-[#999]">☰ {r.listButton || "Menu"}</div>
          )}
          {r.options.map((o, i) => (
            <div key={i} className="relative flex h-8 items-center justify-between gap-2 border-b border-[#f1f1f1] px-2.5 last:border-0">
              <span className="truncate text-[#027eb5]">{o.title || <span className="text-[#b3b3b3]">Untitled</span>}</span>
              {!o.next && <span className="shrink-0 text-[11px] text-[#b3b3b3]">no next</span>}
              <Handle
                type="source"
                position={Position.Right}
                id={`opt-${i}`}
                className="!h-3 !w-3 !border-2 !border-white !bg-accent !shadow-[0_0_0_1px_#1961ed]"
              />
            </div>
          ))}
        </div>
      )}

      {(r.handoff || r.hits > 0) && (
        <div className="flex items-center gap-2 border-t border-[#f1f1f1] px-2.5 py-1 text-[11px] text-[#999]">
          {r.handoff && (
            <span className="inline-flex items-center gap-1 text-[#d6336c]"><IconUserShare size={12} /> Hands off to agent</span>
          )}
          {r.hits > 0 && <span className="ml-auto inline-flex items-center gap-0.5"><IconBolt size={11} />{r.hits} hits</span>}
        </div>
      )}
    </div>
  );
});

const nodeTypes = { rule: RuleNodeView };

/* ---------------------------------------------------------------- layout */

function estimateHeight(r: BotRule) {
  return 96 + (r.trigger === "keyword" ? 20 : 0) + (r.options.length ? r.options.length * 32 + (r.replyType === "list" ? 20 : 0) : 0) + (r.handoff || r.hits ? 24 : 0);
}

/** Left-to-right layering: BFS from welcome/keyword roots, then any unreached steps, fallback last. */
function autoLayout(rules: BotRule[]): Map<string, { x: number; y: number }> {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const incoming = new Set(rules.flatMap((r) => r.options.map((o) => o.next).filter((n): n is string => !!n && byId.has(n))));
  const order = { welcome: 0, keyword: 1, menu: 2, fallback: 3 } as const;
  const sorted = [...rules].sort((a, b) => order[a.trigger] - order[b.trigger] || a.priority - b.priority);
  const layer = new Map<string, number>();
  const bfs = (roots: BotRule[]) => {
    const q: string[] = [];
    for (const r of roots) if (!layer.has(r.id)) { layer.set(r.id, 0); q.push(r.id); }
    while (q.length) {
      const id = q.shift()!;
      const d = layer.get(id)!;
      for (const o of byId.get(id)!.options) {
        if (o.next && byId.has(o.next) && !layer.has(o.next)) { layer.set(o.next, d + 1); q.push(o.next); }
      }
    }
  };
  bfs(sorted.filter((r) => r.trigger === "welcome" || r.trigger === "keyword"));
  bfs(sorted.filter((r) => r.trigger === "menu" && !incoming.has(r.id)));
  bfs(sorted.filter((r) => r.trigger !== "fallback"));
  bfs(sorted);

  const cols = new Map<number, BotRule[]>();
  for (const r of sorted) {
    const l = r.trigger === "fallback" && !incoming.has(r.id) ? 0 : layer.get(r.id) ?? 0;
    cols.set(l, [...(cols.get(l) ?? []), r]);
  }
  const out = new Map<string, { x: number; y: number }>();
  const GAP_X = 120, GAP_Y = 40;
  for (const [l, list] of cols) {
    // keep non-fallback order, put orphan fallbacks at the bottom of column 0
    list.sort((a, b) => (a.trigger === "fallback" ? 1 : 0) - (b.trigger === "fallback" ? 1 : 0));
    let y = 0;
    for (const r of list) {
      out.set(r.id, { x: l * (NODE_W + GAP_X), y });
      y += estimateHeight(r) + GAP_Y;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- canvas */

function toNode(r: BotRule, pos: { x: number; y: number }, selected = false): RuleNode {
  return { id: r.id, type: "rule", position: pos, data: { rule: r }, selected };
}

function FlowInner({ initialRules, actions }: { initialRules: BotRule[]; actions: FlowActions }) {
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rules, setRules] = useState<BotRule[]>(initialRules);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const pendingPos = useRef(new Map<string, PosUpdate>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPositions = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const updates = [...pendingPos.current.values()];
    pendingPos.current.clear();
    if (updates.length) actions.saveNodePositions(updates).catch(() => setError("Couldn’t save positions."));
  }, [actions]);

  const queuePositions = useCallback(
    (updates: PosUpdate[]) => {
      for (const u of updates) pendingPos.current.set(u.id, u);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flushPositions, 600);
    },
    [flushPositions],
  );
  useEffect(() => () => flushPositions(), [flushPositions]);

  // initial positions: auto-layout when nothing was ever placed; park unplaced newcomers below the rest
  const [nodes, setNodes, onNodesChange] = useNodesState<RuleNode>(
    useMemo(() => {
      if (!initialRules.length) return [];
      const placed = initialRules.filter((r) => r.posX !== 0 || r.posY !== 0);
      if (!placed.length) {
        const lay = autoLayout(initialRules);
        return initialRules.map((r) => toNode(r, lay.get(r.id) ?? { x: 0, y: 0 }));
      }
      let y = Math.max(...placed.map((r) => r.posY + estimateHeight(r))) + 80;
      return initialRules.map((r) => {
        if (r.posX !== 0 || r.posY !== 0 || placed.length === initialRules.length) return toNode(r, { x: r.posX, y: r.posY });
        const pos = { x: 0, y };
        y += estimateHeight(r) + 40;
        return toNode(r, pos);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // persist computed initial positions once
  useEffect(() => {
    const changed = nodes.filter((n) => {
      const r = initialRules.find((x) => x.id === n.id);
      return r && (r.posX !== Math.round(n.position.x) || r.posY !== Math.round(n.position.y));
    });
    if (changed.length) queuePositions(changed.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // server refreshes (revalidatePath) → merge new rule data, keep local positions
  const firstProps = useRef(true);
  useEffect(() => {
    if (firstProps.current) { firstProps.current = false; return; }
    setRules(initialRules);
  }, [initialRules]);

  // rules → node data (keep positions/selection)
  useEffect(() => {
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      return rules.map((r) => {
        const p = prevMap.get(r.id);
        return p ? { ...p, data: { rule: r } } : toNode(r, { x: r.posX, y: r.posY });
      });
    });
  }, [rules, setNodes]);

  const ids = useMemo(() => new Set(rules.map((r) => r.id)), [rules]);
  const edges = useMemo<Edge[]>(
    () =>
      rules.flatMap((r) =>
        r.options.flatMap((o, i) => {
          if (!o.next || !ids.has(o.next)) return [];
          const id = `${r.id}:${i}`;
          const sel = selectedEdges.has(id);
          return [{
            id,
            source: r.id,
            sourceHandle: `opt-${i}`,
            target: o.next,
            targetHandle: "in",
            animated: true,
            selected: sel,
            label: o.title,
            labelStyle: { fontSize: 11, fill: sel ? "#1961ed" : "#666", fontWeight: 500 },
            labelBgStyle: { fill: "#fff", stroke: sel ? "#1961ed" : "#ebebeb", strokeWidth: 1 },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 4,
            style: { stroke: sel ? "#1961ed" : "#b3b3b3", strokeWidth: sel ? 2 : 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: sel ? "#1961ed" : "#b3b3b3", width: 16, height: 16 },
          }];
        }),
      ),
    [rules, ids, selectedEdges],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes.filter((c) => c.type === "select"), edges);
      setSelectedEdges(new Set(next.filter((e) => e.selected).map((e) => e.id)));
    },
    [edges],
  );

  const setOptionNext = useCallback(
    (ruleId: string, idx: number, next: string | null) => {
      const prev = rules;
      setRules((rs) => rs.map((r) => (r.id === ruleId ? { ...r, options: r.options.map((o, i) => (i === idx ? { ...o, next } : o)) } : r)));
      actions.linkOption(ruleId, idx, next).then((res) => {
        if (!res.ok) { setRules(prev); setError(res.message ?? "Couldn’t update the link."); }
      }).catch(() => { setRules(prev); setError("Couldn’t update the link."); });
    },
    [rules, actions],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle?.startsWith("opt-")) return;
      if (c.source === c.target) return;
      setOptionNext(c.source, Number(c.sourceHandle.slice(4)), c.target);
    },
    [setOptionNext],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => c.source !== c.target && !!c.sourceHandle?.startsWith("opt-") && c.targetHandle === "in",
    [],
  );

  // Delete key removes edges (clears the link), never whole steps
  const onBeforeDelete: OnBeforeDelete<RuleNode, Edge> = useCallback(async ({ edges: es }) => ({ nodes: [], edges: es }), []);
  const onEdgesDelete = useCallback(
    (es: Edge[]) => {
      for (const e of es) {
        const [ruleId, idx] = e.id.split(":");
        setOptionNext(ruleId, Number(idx), null);
      }
      setSelectedEdges(new Set());
    },
    [setOptionNext],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, _n: RuleNode, dragged: RuleNode[]) => {
      queuePositions(dragged.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })));
    },
    [queuePositions],
  );

  const runAutoLayout = useCallback(() => {
    const lay = autoLayout(rules);
    setNodes((prev) => prev.map((n) => ({ ...n, position: lay.get(n.id) ?? n.position })));
    queuePositions([...lay].map(([id, p]) => ({ id, ...p })));
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 300 }));
  }, [rules, setNodes, queuePositions, rf]);

  const addStep = useCallback(() => {
    const box = wrapRef.current?.getBoundingClientRect();
    const center = box
      ? rf.screenToFlowPosition({ x: box.left + box.width / 2 - (openId ? 190 : 0), y: box.top + box.height / 2 })
      : { x: 0, y: 0 };
    startBusy(async () => {
      try {
        const rule = await actions.createFlowStep(center.x - NODE_W / 2, center.y - 50);
        setRules((rs) => (rs.some((r) => r.id === rule.id) ? rs : [...rs, rule]));
        setOpenId(rule.id);
      } catch {
        setError("Couldn’t create the step.");
      }
    });
  }, [rf, actions, openId]);

  const open = rules.find((r) => r.id === openId) ?? null;
  const others = useMemo(
    () => rules.filter((r) => r.id !== openId).map((r) => ({ id: r.id, name: r.name, trigger: r.trigger })).sort((a, b) => a.name.localeCompare(b.name)),
    [rules, openId],
  );

  const deleteOpen = () => {
    if (!open) return;
    if (!confirm(`Delete step “${open.name}”? Options pointing to it will be unlinked.`)) return;
    const id = open.id;
    setOpenId(null);
    setRules((rs) => rs.filter((r) => r.id !== id).map((r) => ({ ...r, options: r.options.map((o) => (o.next === id ? { ...o, next: null } : o)) })));
    actions.deleteRule(id).catch(() => setError("Couldn’t delete the step."));
  };

  return (
    <div ref={wrapRef} className="relative h-full min-h-[480px] w-full bg-[#fafafa]">
      <ReactFlow<RuleNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onBeforeDelete={onBeforeDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, n) => setOpenId(n.id)}
        onPaneClick={() => setOpenId(null)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "default" }}
        connectionLineStyle={{ stroke: "#1961ed", strokeWidth: 1.5 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#d6d6d6" />
        <Controls showInteractive={false} className="!overflow-hidden !rounded-md !border !border-[#ebebeb] !shadow-sm" />
        <MiniMap
          pannable
          zoomable
          className="!rounded-md !border !border-[#ebebeb] !shadow-sm"
          style={openId ? { right: 392 } : undefined}
          nodeColor={(n) => TRIGGER_STYLE[(n as RuleNode).data.rule.trigger].dot}
          nodeBorderRadius={4}
          maskColor="rgba(241,241,241,.6)"
        />
        <Panel position="top-left">
          <div className="flex items-center gap-1 rounded-md border border-[#ebebeb] bg-white p-1 shadow-sm">
            <button type="button" className="btn btn-ghost h-7" onClick={addStep} disabled={busy}>
              {busy ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlus size={14} />} Add step
            </button>
            <button type="button" className="btn btn-ghost h-7" onClick={runAutoLayout} disabled={!rules.length}>
              <IconLayoutDistributeVertical size={14} /> Auto layout
            </button>
            <span className="mx-0.5 h-4 w-px bg-[#ebebeb]" />
            <Link href="/chatbot" className="btn btn-ghost h-7"><IconList size={14} /> List view</Link>
          </div>
        </Panel>
        <Panel position="bottom-center">
          <div className="rounded-md border border-[#ebebeb] bg-white/90 px-2.5 py-1 text-[11px] text-ink-3 shadow-sm">
            Drag an option’s blue dot onto a step to link it · select a link and press Delete to remove it · click a step to edit
          </div>
        </Panel>
        {error && (
          <Panel position="top-center">
            <div className="flex items-center gap-2 rounded-md border border-[#ffd1d1] bg-[#fff5f5] px-2.5 py-1.5 text-xs text-[#b42318] shadow-sm">
              {error}
              <button type="button" onClick={() => setError(null)} className="text-[#b42318]/70 hover:text-[#b42318]"><IconX size={12} /></button>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {!rules.length && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto rounded-lg border border-[#ebebeb] bg-white p-5 text-center shadow-sm">
            <div className="text-sm font-medium text-ink">No steps yet</div>
            <div className="mt-1 text-sm text-ink-3">Add a step, or create the starter bot from the list view.</div>
          </div>
        </div>
      )}

      {open && (
        <aside className="absolute top-0 right-0 bottom-0 z-10 flex w-[380px] max-w-full flex-col border-l border-[#ebebeb] bg-white shadow-[-4px_0_16px_rgba(0,0,0,.05)]">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#ebebeb] px-4">
            <span className="size-2 rounded-full" style={{ background: TRIGGER_STYLE[open.trigger].dot }} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{open.name}</span>
            <Link href={`/chatbot/${open.id}`} className="text-xs text-ink-3 hover:text-ink-2 hover:underline">Full editor</Link>
            <button type="button" className="btn btn-ghost h-7 px-1.5 text-ink-3" onClick={() => setOpenId(null)} title="Close"><IconX size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
            <FlowRuleEditor
              key={open.id}
              rule={open}
              others={others}
              action={actions.saveRuleInline.bind(null, open.id)}
              onSaved={(saved) => setRules((rs) => rs.map((r) => (r.id === saved.id ? saved : r)))}
              onDelete={deleteOpen}
            />
          </div>
        </aside>
      )}
    </div>
  );
}

export function FlowCanvas({ rules, actions }: { rules: BotRule[]; actions: FlowActions }) {
  return (
    <ReactFlowProvider>
      <FlowInner initialRules={rules} actions={actions} />
    </ReactFlowProvider>
  );
}
