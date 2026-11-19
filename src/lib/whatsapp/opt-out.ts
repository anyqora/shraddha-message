// ============================================================
// Broadcast opt-out.
//
// A contact who replies STOP / UNSUBSCRIBE is flagged `opted_out` and
// excluded from every broadcast path (wizard audience, public API,
// resume and scheduled sends). START / SUBSCRIBE clears the flag. The
// inbox is unaffected: someone who opted out of marketing can still
// talk to an agent.
// ============================================================

import type { SupabaseClient } from '@/lib/supabase/types';

const OPT_OUT_KEYWORDS = ['stop', 'stop all', 'stopall', 'unsubscribe', 'opt out', 'optout'];
const OPT_IN_KEYWORDS = ['start', 'unstop', 'subscribe', 'opt in', 'optin'];

export type OptKeyword = 'opt_out' | 'opt_in';

/** Where an opt-out came from. Free text, display only. */
export type OptOutSource = 'keyword' | 'manual' | 'import';

/**
 * Classify an inbound text as an opt-out / opt-in keyword. Only a
 * message that is *just* the keyword counts ("Stop!", "opt-out"), so
 * "please don't stop sending" is left alone.
 */
export function parseOptKeyword(text: string | null | undefined): OptKeyword | null {
  if (!text) return null;
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, ' ')
    .replace(/[.!?,;:'"()]+$/g, '')
    .trim();
  if (!normalized) return null;
  if (OPT_OUT_KEYWORDS.includes(normalized)) return 'opt_out';
  if (OPT_IN_KEYWORDS.includes(normalized)) return 'opt_in';
  return null;
}

/**
 * Set or clear a contact's opt-out. Conditional on the current value,
 * so a repeat STOP doesn't move `opted_out_at`. Returns true when the
 * row changed.
 */
export async function setContactOptOut(
  db: SupabaseClient,
  contactId: string,
  optedOut: boolean,
  source: OptOutSource,
  now: Date = new Date()
): Promise<boolean> {
  const { data, error } = await db
    .from('contacts')
    .update(
      optedOut
        ? { opted_out: true, opted_out_at: now.toISOString(), opt_out_source: source }
        : { opted_out: false, opted_out_at: null, opt_out_source: null }
    )
    .eq('id', contactId)
    .eq('opted_out', !optedOut)
    .select('id');
  if (error) {
    console.error('[opt-out] update failed:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Apply an inbound STOP / START. Returns the keyword it matched (the
 * webhook then skips the AI auto-reply for that message) or null.
 * Never throws.
 */
export async function applyInboundOptKeyword(
  db: SupabaseClient,
  contactId: string,
  text: string | null | undefined
): Promise<OptKeyword | null> {
  const keyword = parseOptKeyword(text);
  if (!keyword) return null;
  try {
    await setContactOptOut(db, contactId, keyword === 'opt_out', 'keyword');
  } catch (err) {
    console.error('[opt-out] keyword handling failed:', err);
  }
  return keyword;
}
