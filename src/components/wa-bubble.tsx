import { cn } from "@/lib/utils";

/** Render WhatsApp markdown (*bold*, _italic_, ~strike~, ```mono```) safely as React nodes. */
export function WaText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```|https?:\/\/[^\s]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("http")) parts.push(<a key={k++} href={t} target="_blank" rel="noreferrer" className="text-[#027eb5] underline break-all">{t}</a>);
    else if (t.startsWith("```")) parts.push(<code key={k++} className="font-mono">{t.slice(3, -3)}</code>);
    else if (t[0] === "*") parts.push(<strong key={k++}>{t.slice(1, -1)}</strong>);
    else if (t[0] === "_") parts.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else parts.push(<s key={k++}>{t.slice(1, -1)}</s>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function WaBubble({
  out,
  header,
  body,
  footer,
  buttons,
  meta,
  reaction,
  actions,
  children,
}: {
  out?: boolean;
  header?: string;
  body: string;
  footer?: string;
  buttons?: string[];
  meta?: React.ReactNode;
  /** emoji reaction shown as a small pill under the bubble */
  reaction?: string;
  /** hover-only controls (e.g. reaction picker), shown beside the bubble */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("group/bubble relative max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13.5px] leading-[19px] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]", out ? "ml-auto bg-[#d9fdd3]" : "bg-white", reaction && "mb-3.5")}>
      {children}
      {header && <div className="mb-1 font-semibold">{header}</div>}
      {body && <div className="whitespace-pre-wrap break-words"><WaText text={body} /></div>}
      {footer && <div className="mt-1 text-xs text-[#667781]">{footer}</div>}
      {meta && <div className="mt-0.5 flex justify-end gap-1 text-[11px] text-[#667781]">{meta}</div>}
      {buttons && buttons.length > 0 && (
        <div className="-mx-2.5 mt-1.5 border-t border-black/5">
          {buttons.map((b, i) => <div key={i} className="border-b border-black/5 py-1.5 text-center text-[#027eb5] last:border-0">{b}</div>)}
        </div>
      )}
      {reaction && (
        <span className={cn("absolute -bottom-3.5 flex h-[22px] items-center rounded-full border border-black/5 bg-white px-1.5 text-[13px] leading-none shadow-sm", out ? "right-2" : "left-2")}>
          {reaction}
        </span>
      )}
      {actions && (
        <div className={cn("absolute top-1 opacity-0 transition-opacity group-hover/bubble:opacity-100 focus-within:opacity-100", out ? "right-full mr-1" : "left-full ml-1")}>
          {actions}
        </div>
      )}
    </div>
  );
}
