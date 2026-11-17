/** Normalise a phone number to digits with country code. Returns "" if invalid. */
export function normalizePhone(input: string, defaultCc = "91"): string {
  let d = String(input ?? "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 11) d = defaultCc + d.slice(1);
  else if (d.length === 10) d = defaultCc + d;
  d = d.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : "";
}

export function formatPhone(d: string): string {
  if (d.startsWith("91") && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : "";
}
