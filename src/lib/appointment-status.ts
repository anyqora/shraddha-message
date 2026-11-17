// Shared by server pages and client components (no "use client").
export const APPT_STATUS_META: Record<string, { label: string; cls: string; block: string }> = {
  booked: { label: "Booked", cls: "bg-[#e8efff] text-[#1961ed]", block: "border-l-[#1961ed] bg-[#f3f7ff]" },
  confirmed: { label: "Confirmed", cls: "bg-[#e3f5e8] text-[#2f9e44]", block: "border-l-[#2f9e44] bg-[#f3fbf5]" },
  completed: { label: "Completed", cls: "bg-[#f1ebff] text-[#7048e8]", block: "border-l-[#7048e8] bg-[#f8f5ff]" },
  no_show: { label: "No-show", cls: "bg-[#ffebeb] text-[#e5484d]", block: "border-l-[#e5484d] bg-[#fff5f5]" },
  cancelled: { label: "Cancelled", cls: "bg-[#f1f1f1] text-[#666]", block: "border-l-[#b3b3b3] bg-[#fafafa] line-through opacity-70" },
};
