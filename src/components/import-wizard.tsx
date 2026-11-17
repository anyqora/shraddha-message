"use client";

import { useState } from "react";
import Link from "next/link";
import { IconFileSpreadsheet } from "@tabler/icons-react";
import { parseTableFile, guessColumn } from "./file-table";
import type { ImportRow } from "@/app/(app)/contacts/actions";
import { Notice } from "./ui";

export function ImportWizard({
  lists,
  importAction,
  createList,
}: {
  lists: { id: string; name: string }[];
  importAction: (rows: ImportRow[], listId?: string, overwrite?: boolean) => Promise<{ imported: number; invalid: number; duplicates: number }>;
  createList: (name: string) => Promise<string>;
}) {
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [map, setMap] = useState({ phone: "", name: "", email: "" });
  const [extra, setExtra] = useState<string[]>([]);
  const [listId, setListId] = useState("");
  const [newList, setNewList] = useState("");
  const [overwrite, setOverwrite] = useState(true);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ imported: number; invalid: number; duplicates: number } | null>(null);
  const [error, setError] = useState("");

  async function onFile(f: File) {
    setError("");
    setResult(null);
    try {
      const t = await parseTableFile(f);
      if (!t.rows.length) throw new Error("The file has no rows.");
      setFile({ name: f.name, ...t });
      const phone = guessColumn(t.headers, "phone", "mobile", "whatsapp", "number", "contact");
      const name = guessColumn(t.headers, "name");
      const email = guessColumn(t.headers, "email", "mail");
      setMap({ phone, name, email });
      setExtra(t.headers.filter((h) => ![phone, name, email].includes(h)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run() {
    if (!file || !map.phone) return;
    setError("");
    try {
      let target = listId;
      if (listId === "__new") {
        if (!newList.trim()) throw new Error("Enter a name for the new list.");
        setBusy("Creating list…");
        target = await createList(newList.trim());
      }
      const rows: ImportRow[] = file.rows.map((r) => ({
        phone: r[map.phone],
        name: map.name ? r[map.name] : "",
        email: map.email ? r[map.email] : "",
        custom: Object.fromEntries(extra.map((h) => [h, r[h] ?? ""]).filter(([, v]) => v)),
      }));
      const total = { imported: 0, invalid: 0, duplicates: 0 };
      for (let i = 0; i < rows.length; i += 2000) {
        setBusy(`Importing ${Math.min(i + 2000, rows.length)} / ${rows.length}…`);
        const r = await importAction(rows.slice(i, i + 2000), target || undefined, overwrite);
        total.imported += r.imported;
        total.invalid += r.invalid;
        total.duplicates += r.duplicates;
      }
      setResult(total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const sel = (key: keyof typeof map, label: string, required = false) => (
    <label className="block">
      <span className="label">{label}{required && " *"}</span>
      <select className="input" value={map[key]} onChange={(e) => setMap({ ...map, [key]: e.target.value })}>
        <option value="">{required ? "Choose column" : "— none —"}</option>
        {file?.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <Notice tone="success">
          Imported {result.imported} contacts. {result.invalid > 0 && `${result.invalid} rows had an invalid phone. `}
          {result.duplicates > 0 && `${result.duplicates} duplicate rows merged. `}
          <Link href={listId && listId !== "__new" ? `/lists/${listId}` : "/contacts"} className="font-medium underline">View contacts</Link>
        </Notice>
      )}
      <label className="card flex cursor-pointer flex-col items-center gap-2 border-dashed p-8 text-center hover:bg-soft">
        <IconFileSpreadsheet size={28} className="text-ink-3" />
        <span className="font-medium">{file ? file.name : "Choose a CSV or Excel (.xlsx) file"}</span>
        <span className="text-xs text-ink-3">{file ? `${file.rows.length} rows · ${file.headers.length} columns` : "First row must contain column names"}</span>
        <input type="file" accept=".csv,.xlsx,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>

      {file && (
        <div className="card space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {sel("phone", "Phone column", true)}
            {sel("name", "Name column")}
            {sel("email", "Email column")}
          </div>
          <div>
            <span className="label">Save other columns as custom fields</span>
            <div className="flex flex-wrap gap-2">
              {file.headers.filter((h) => ![map.phone, map.name, map.email].includes(h)).map((h) => (
                <label key={h} className="flex items-center gap-1.5 rounded-sm border border-line px-2 py-1">
                  <input type="checkbox" checked={extra.includes(h)} onChange={(e) => setExtra(e.target.checked ? [...extra, h] : extra.filter((x) => x !== h))} />
                  {h}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Add to list</span>
              <select className="input" value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">— don&apos;t add —</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                <option value="__new">+ New list…</option>
              </select>
            </label>
            {listId === "__new" && (
              <label className="block">
                <span className="label">New list name</span>
                <input className="input" value={newList} onChange={(e) => setNewList(e.target.value)} />
              </label>
            )}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            Update name / email / fields of contacts that already exist
          </label>
          <div className="overflow-auto rounded-sm border border-line">
            <table className="table-grid w-full">
              <thead><tr>{file.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {file.rows.slice(0, 5).map((r, i) => <tr key={i}>{file.headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" disabled={!map.phone || !!busy} onClick={run}>
            {busy || `Import ${file.rows.length} contacts`}
          </button>
        </div>
      )}
    </div>
  );
}
