"use client";

import Link from "next/link";
import { useState } from "react";
import { IconDownload } from "@tabler/icons-react";
import type { CampaignRow } from "@/lib/reports";
import { StatusChip } from "./ui";

const inr = (v: number, frac = 0) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

export function ReportCampaigns({ rows, csvBase, defaultRate }: { rows: CampaignRow[]; csvBase: string; defaultRate: number }) {
  const [rateText, setRateText] = useState(String(defaultRate.toFixed(2)));
  const rate = Math.max(0, Number(rateText) || 0);
  const t = rows.reduce(
    (a, c) => ({
      recipients: a.recipients + c.recipients,
      sent: a.sent + c.sent,
      delivered: a.delivered + c.delivered,
      read: a.read + c.read,
      failed: a.failed + c.failed,
      replied: a.replied + c.replied,
      wonDeals: a.wonDeals + c.wonDeals,
      wonValue: a.wonValue + c.wonValue,
    }),
    { recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, wonDeals: 0, wonValue: 0 },
  );
  const cost = t.sent * rate;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="label">Cost per message (₹)</span>
          <input
            className="input w-32"
            type="number"
            min={0}
            step={0.01}
            value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            aria-label="Cost per message in rupees"
          />
          <span className="mt-1 block text-xs text-ink-3">Default ₹0.80 (marketing template, India)</span>
        </label>
        <a className="btn no-print" href={`${csvBase}&rate=${encodeURIComponent(String(rate))}`}>
          <IconDownload size={14} /> Download CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-3">
          <div className="text-xs font-medium text-ink-3">Messages sent</div>
          <div className="mt-1 text-xl font-semibold">{t.sent.toLocaleString("en-IN")}</div>
          <div className="text-xs text-ink-3">{pct(t.read, t.sent)} read · {t.failed} failed</div>
        </div>
        <div className="card p-3">
          <div className="text-xs font-medium text-ink-3">Replied within 24h</div>
          <div className="mt-1 text-xl font-semibold">{t.replied.toLocaleString("en-IN")}</div>
          <div className="text-xs text-ink-3">{pct(t.replied, t.sent)} reply rate</div>
        </div>
        <div className="card p-3">
          <div className="text-xs font-medium text-ink-3">Estimated cost</div>
          <div className="mt-1 text-xl font-semibold">{inr(cost, 2)}</div>
          <div className="text-xs text-ink-3">{t.replied ? `${inr(cost / t.replied, 2)} per reply` : "No replies yet"}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs font-medium text-ink-3">Won deals from recipients</div>
          <div className="mt-1 text-xl font-semibold">{inr(t.wonValue)}</div>
          <div className="text-xs text-ink-3">
            {t.wonDeals} deals{cost > 0 && t.wonValue > 0 ? ` · ${(t.wonValue / cost).toFixed(1)}× cost` : ""}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-grid w-full">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th className="text-right">Recipients</th>
              <th className="text-right">Sent</th>
              <th className="text-right">Delivered</th>
              <th className="text-right">Read</th>
              <th className="text-right">Failed</th>
              <th className="text-right">Replied</th>
              <th className="text-right">Reply rate</th>
              <th className="text-right">Est. cost</th>
              <th className="text-right">Won value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="max-w-56 truncate">
                  <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-accent">{c.name}</Link>
                  <div className="text-[11px] text-ink-3">
                    {new Date(c.startedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}
                  </div>
                </td>
                <td><StatusChip status={c.status} /></td>
                <td className="text-right">{c.recipients.toLocaleString("en-IN")}</td>
                <td className="text-right">{c.sent.toLocaleString("en-IN")}</td>
                <td className="text-right">{c.delivered.toLocaleString("en-IN")} <span className="text-ink-3">{pct(c.delivered, c.sent)}</span></td>
                <td className="text-right">{c.read.toLocaleString("en-IN")} <span className="text-ink-3">{pct(c.read, c.sent)}</span></td>
                <td className={`text-right ${c.failed ? "text-danger" : ""}`}>{c.failed.toLocaleString("en-IN")}</td>
                <td className="text-right">{c.replied.toLocaleString("en-IN")}</td>
                <td className="text-right">{pct(c.replied, c.sent)}</td>
                <td className="text-right">{inr(c.sent * rate, 2)}</td>
                <td className="text-right">{c.wonValue ? inr(c.wonValue) : "—"}{c.wonDeals > 0 && <span className="ml-1 text-ink-3">({c.wonDeals})</span>}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={11} className="text-center text-ink-3">No campaigns started in this range</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">
        Replied = recipient sent any message within 24 hours of the campaign message. Won value = deals in a won stage for recipients, updated after the campaign started (a hint, not attribution).
      </p>
    </div>
  );
}
