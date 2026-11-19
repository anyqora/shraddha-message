// ============================================================
// POST /api/whatsapp/broadcast/[id]/cancel
//
// Cancels a scheduled broadcast: it goes back to 'draft' with no
// `scheduled_at`, keeping its frozen recipient rows so it can still be
// sent by hand ("Send now" on the detail page). Only a broadcast that is
// still 'scheduled' can be cancelled — the conditional UPDATE loses
// cleanly to a cron tick that already started it.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id } = await params;

    const { data, error } = await supabase
      .from('broadcasts')
      .update({
        status: 'draft',
        scheduled_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .eq('status', 'scheduled')
      .select('id');

    if (error) {
      console.error('[broadcast-cancel] update failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to cancel broadcast' },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'This broadcast is not scheduled (it may already be sending).' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, broadcast_id: id });
  } catch (error) {
    return toErrorResponse(error);
  }
}
