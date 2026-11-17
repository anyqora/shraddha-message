"use client";

import { useTransition } from "react";
import { IconTrash } from "@tabler/icons-react";

/** Confirm-then-delete button, shared by segments and links. */
export function SegmentDelete({ onDelete, label = "Delete", confirmText = "Delete this segment?" }: { onDelete: () => Promise<void>; label?: string; confirmText?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-danger"
      disabled={pending}
      onClick={() => {
        if (confirm(confirmText)) start(() => onDelete());
      }}
    >
      <IconTrash size={14} /> {pending ? "Deleting…" : label}
    </button>
  );
}
