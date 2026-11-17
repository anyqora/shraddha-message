"use client";

import { useEffect, useRef } from "react";

export function ScrollToBottom({ children, className, depKey }: { children: React.ReactNode; className?: string; depKey: string | number }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (first.current || nearBottom) el.scrollTop = el.scrollHeight;
    first.current = false;
  }, [depKey]);
  return <div ref={ref} className={className}>{children}</div>;
}
