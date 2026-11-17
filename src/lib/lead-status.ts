// Shared by server pages and client components (no "use client").
export const LEAD_STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-[#e8efff] text-[#1961ed]" },
  contacted: { label: "Contacted", cls: "bg-[#fff8db] text-[#b08800]" },
  qualified: { label: "Qualified", cls: "bg-[#f1ebff] text-[#7048e8]" },
  converted: { label: "Converted", cls: "bg-[#e3f5e8] text-[#2f9e44]" },
  lost: { label: "Lost", cls: "bg-[#f1f1f1] text-[#666]" },
};
