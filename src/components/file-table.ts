"use client";

import Papa from "papaparse";

/** Parse CSV / XLSX into header + rows (strings). */
export async function parseTableFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const { default: readXlsx } = await import("read-excel-file");
    const sheet = await readXlsx(file);
    const [head = [], ...body] = sheet;
    const headers = head.map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
    const rows = body
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] == null ? "" : String(r[i]).trim()])))
      .filter((r) => Object.values(r).some(Boolean));
    return { headers, rows };
  }
  const text = await file.text();
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (res.meta.fields ?? []).filter(Boolean);
  const rows = res.data.map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? "").trim()])));
  return { headers, rows };
}

export function guessColumn(headers: string[], ...words: string[]) {
  return headers.find((h) => words.some((w) => h.toLowerCase().replace(/[^a-z]/g, "").includes(w))) ?? "";
}
