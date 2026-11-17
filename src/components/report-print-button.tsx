"use client";

import { IconPrinter } from "@tabler/icons-react";

export function ReportPrintButton() {
  return (
    <button type="button" className="btn" onClick={() => window.print()}>
      <IconPrinter size={14} /> Print / Save PDF
    </button>
  );
}
