"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconMoodSmile } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export const REACTIONS = ["👍", "❤️", "😂", "😮", "🙏"];

export function ReactionPicker({
  current,
  react,
}: {
  current?: string;
  react: (emoji: string) => Promise<{ error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const pick = (emoji: string) =>
    start(async () => {
      const r = await react(current === emoji ? "" : emoji);
      setOpen(false);
      if (r?.error) alert(r.error);
      router.refresh();
    });

  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={pending}
        title="React"
        className="flex size-6 items-center justify-center rounded-full bg-white/90 text-[#54656f] shadow-sm hover:bg-white disabled:opacity-50"
      >
        <IconMoodSmile size={15} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 rounded-full bg-white px-1.5 py-1 shadow-md">
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              disabled={pending}
              onClick={() => pick(e)}
              className={cn("flex size-7 items-center justify-center rounded-full text-[17px] transition-transform hover:scale-125", current === e && "bg-black/[0.06]")}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
