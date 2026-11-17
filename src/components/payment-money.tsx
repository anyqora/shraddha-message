/** Money helpers shared by server and client code. Amounts are stored in paise. */

export function formatMoney(paise: number, currency = "INR"): string {
  const v = (paise || 0) / 100;
  if (currency === "INR") return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${currency} ${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "1,299.50" / "₹1299.5" → 129950 paise. Returns NaN for invalid input. */
export function rupeesToPaise(input: string | number): number {
  const s = String(input ?? "").replace(/[₹,\s]/g, "");
  if (!s || !/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export function paiseToRupeesInput(paise: number): string {
  return paise ? String(paise / 100) : "";
}

export const PAYMENT_STATUS_COLOR: Record<string, string> = {
  created: "blue",
  paid: "green",
  expired: "gray",
  cancelled: "orange",
  failed: "red",
};
