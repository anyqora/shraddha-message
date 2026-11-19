-- auth.email()
CREATE OR REPLACE FUNCTION auth.email()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT auth.jwt() ->> 'email'
$function$
;

-- auth.jwt()
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$function$
;

-- auth.role()
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce(auth.jwt() ->> 'role', 'service_role')
$function$
;

-- auth.uid()
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$function$
;

-- public._bcast_bump(bid uuid, col text, delta integer)
CREATE OR REPLACE FUNCTION public._bcast_bump(bid uuid, col text, delta integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE format(
    'UPDATE broadcasts SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE id = $2',
    col, col
  ) USING delta, bid;
END;
$function$
;

-- public._bcast_cols_for_status(s text)
CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  -- 'pending' contributes to nothing.
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$function$
;

-- public.acquire_broadcast_delivery_lease(p_broadcast_id uuid)
CREATE OR REPLACE FUNCTION public.acquire_broadcast_delivery_lease(p_broadcast_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lease TIMESTAMPTZ;
BEGIN
  UPDATE broadcasts b
  SET delivery_lease_until = now() + INTERVAL '5 minutes'
  WHERE b.id = p_broadcast_id
    AND is_account_member(b.account_id, 'agent')
    AND (b.delivery_lease_until IS NULL OR b.delivery_lease_until < now())
    AND (b.delivery_locked_at IS NULL OR b.delivery_locked_at < now() - INTERVAL '30 minutes')
  RETURNING b.delivery_lease_until INTO v_lease;
  RETURN v_lease;
END;
$function$
;

-- public.armor(bytea)
CREATE OR REPLACE FUNCTION public.armor(bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_armor$function$
;

-- public.armor(bytea, text[], text[])
CREATE OR REPLACE FUNCTION public.armor(bytea, text[], text[])
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_armor$function$
;

-- public.array_to_halfvec(numeric[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_halfvec(numeric[], integer, boolean)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_halfvec$function$
;

-- public.array_to_halfvec(integer[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_halfvec(integer[], integer, boolean)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_halfvec$function$
;

-- public.array_to_halfvec(double precision[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_halfvec(double precision[], integer, boolean)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_halfvec$function$
;

-- public.array_to_halfvec(real[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_halfvec(real[], integer, boolean)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_halfvec$function$
;

-- public.array_to_sparsevec(numeric[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_sparsevec(numeric[], integer, boolean)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_sparsevec$function$
;

-- public.array_to_sparsevec(integer[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_sparsevec(integer[], integer, boolean)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_sparsevec$function$
;

-- public.array_to_sparsevec(real[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_sparsevec(real[], integer, boolean)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_sparsevec$function$
;

-- public.array_to_sparsevec(double precision[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_sparsevec(double precision[], integer, boolean)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_sparsevec$function$
;

-- public.array_to_vector(real[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_vector(real[], integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_vector$function$
;

-- public.array_to_vector(integer[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_vector(integer[], integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_vector$function$
;

-- public.array_to_vector(numeric[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_vector(numeric[], integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_vector$function$
;

-- public.array_to_vector(double precision[], integer, boolean)
CREATE OR REPLACE FUNCTION public.array_to_vector(double precision[], integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$array_to_vector$function$
;

-- public.binary_quantize(halfvec)
CREATE OR REPLACE FUNCTION public.binary_quantize(halfvec)
 RETURNS bit
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_binary_quantize$function$
;

-- public.binary_quantize(vector)
CREATE OR REPLACE FUNCTION public.binary_quantize(vector)
 RETURNS bit
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$binary_quantize$function$
;

-- public.broadcast_delivery_in_flight(p_broadcast_id uuid)
CREATE OR REPLACE FUNCTION public.broadcast_delivery_in_flight(p_broadcast_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT b.delivery_locked_at > now() - INTERVAL '30 minutes'
      OR b.delivery_lease_until > now()
    FROM broadcasts b
    WHERE b.id = p_broadcast_id
  ), FALSE)
$function$
;

-- public.broadcast_recipient_aggregate_trigger()
CREATE OR REPLACE FUNCTION public.broadcast_recipient_aggregate_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_cols TEXT[];
  new_cols TEXT[];
  c TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_cols := _bcast_cols_for_status(NEW.status);
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(OLD.broadcast_id, c, -1);
    END LOOP;
    RETURN OLD;
  END IF;

  -- UPDATE: only care if status changed.
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    new_cols := _bcast_cols_for_status(NEW.status);
    -- Subtract the old contributions, add the new.
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, -1);
    END LOOP;
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$
;

-- public.bump_conversation_on_inbound(p_conversation_id uuid, p_last_message_text text)
CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(p_conversation_id uuid, p_last_message_text text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE conversations
  SET unread_count      = COALESCE(unread_count, 0) + 1,
      last_message_text = p_last_message_text,
      last_message_at   = NOW(),
      updated_at        = NOW()
  WHERE id = p_conversation_id;
$function$
;

-- public.claim_ai_reply_slot(conversation_id uuid, max_replies integer)
CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(conversation_id uuid, max_replies integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
      AND NOT ai_autoreply_disabled
      AND assigned_agent_id IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$function$
;

-- public.cosine_distance(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.cosine_distance(sparsevec, sparsevec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_cosine_distance$function$
;

-- public.cosine_distance(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.cosine_distance(halfvec, halfvec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_cosine_distance$function$
;

-- public.cosine_distance(vector, vector)
CREATE OR REPLACE FUNCTION public.cosine_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$cosine_distance$function$
;

-- public.create_broadcast_with_recipients(p_account_id uuid, p_user_id uuid, p_name text, p_template_name text, p_template_language text, p_total_recipients integer, p_contact_ids uuid[], p_template_params jsonb)
CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(p_account_id uuid, p_user_id uuid, p_name text, p_template_name text, p_template_language text, p_total_recipients integer, p_contact_ids uuid[], p_template_params jsonb)
 RETURNS TABLE(broadcast_id uuid, recipient_id uuid, contact_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_broadcast_id UUID;
BEGIN
  IF p_template_params IS NULL OR jsonb_typeof(p_template_params) <> 'array' THEN
    RAISE EXCEPTION 'p_template_params must be a JSON array with one params array per contact'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_template_params) <> COALESCE(cardinality(p_contact_ids), 0) THEN
    RAISE EXCEPTION 'p_template_params has % entries but p_contact_ids has %',
      jsonb_array_length(p_template_params), COALESCE(cardinality(p_contact_ids), 0)
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_template_params) AS params(value)
    WHERE jsonb_typeof(params.value) <> 'array'
  ) THEN
    RAISE EXCEPTION 'every p_template_params entry must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO broadcasts (
    account_id, user_id, name, template_name,
    template_language, status, total_recipients
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, contacts_in.cid, 'pending', params_in.prm
    FROM unnest(p_contact_ids) WITH ORDINALITY AS contacts_in(cid, ordinal)
    JOIN jsonb_array_elements(p_template_params) WITH ORDINALITY AS params_in(prm, ordinal)
      ON params_in.ordinal = contacts_in.ordinal
    ORDER BY contacts_in.ordinal
    RETURNING id, broadcast_recipients.contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$function$
;

-- public.crypt(text, text)
CREATE OR REPLACE FUNCTION public.crypt(text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_crypt$function$
;

-- public.dashboard_overview(p_days integer, p_tz text)
CREATE OR REPLACE FUNCTION public.dashboard_overview(p_days integer, p_tz text DEFAULT 'UTC'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account UUID;
  v_tz TEXT := 'UTC';
  v_now TIMESTAMPTZ := now();
  v_start TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_prev_end TIMESTAMPTZ;
  v_unit TEXT;
  v_step INTERVAL;
  v_target INTEGER;
  v_attention JSONB;
  v_replies JSONB;
  v_volume JSONB;
  v_kpis JSONB;
  v_pipeline JSONB;
  v_campaigns JSONB;
  v_setup JSONB;
BEGIN
  SELECT p.account_id INTO v_account
  FROM profiles p
  WHERE p.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL OR p_days NOT IN (1, 7, 30, 90) THEN
    RAISE EXCEPTION 'p_days must be one of 1, 7, 30, 90' USING ERRCODE = '22023';
  END IF;

  IF p_tz IS NOT NULL THEN
    BEGIN
      PERFORM v_now AT TIME ZONE p_tz;
      v_tz := p_tz;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_tz := 'UTC';
    END;
  END IF;

  v_start := (date_trunc('day', v_now AT TIME ZONE v_tz) - make_interval(days => p_days - 1)) AT TIME ZONE v_tz;
  v_prev_start := v_start - make_interval(days => p_days);
  v_prev_end := v_now - make_interval(days => p_days);
  v_unit := CASE WHEN p_days = 1 THEN 'hour' ELSE 'day' END;
  v_step := CASE WHEN p_days = 1 THEN interval '1 hour' ELSE interval '1 day' END;

  SELECT a.reply_target_minutes INTO v_target FROM accounts a WHERE a.id = v_account;
  v_target := COALESCE(v_target, 5);

  WITH awaiting AS (
    SELECT
      c.id,
      c.contact_id,
      c.assigned_agent_id,
      c.last_message_text,
      c.last_inbound_at,
      (c.ai_autoreply_disabled AND c.ai_handoff_summary IS NOT NULL) AS handed_off,
      COALESCE((
        SELECT min(m.created_at)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'customer'
          AND m.created_at > COALESCE(c.last_reply_at, '-infinity'::timestamptz)
      ), c.last_inbound_at) AS waiting_since
    FROM conversations c
    WHERE c.account_id = v_account
      AND c.status <> 'closed'
      AND c.last_inbound_at IS NOT NULL
      AND (c.last_reply_at IS NULL OR c.last_reply_at < c.last_inbound_at)
  ),
  failed AS (
    SELECT m.id, m.conversation_id, m.content_text, m.error_code, m.error_title, m.created_at,
           ct.name AS contact_name, ct.phone AS contact_phone
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.account_id = v_account
      AND m.sender_type <> 'customer'
      AND m.status = 'failed'
      AND m.created_at >= v_now - interval '24 hours'
  )
  SELECT jsonb_build_object(
    'waiting', (SELECT count(*) FROM awaiting),
    'oldestWaitingSince', (SELECT min(waiting_since) FROM awaiting),
    'waitingOverTarget', (SELECT count(*) FROM awaiting WHERE waiting_since < v_now - make_interval(mins => v_target)),
    'unassigned', (
      SELECT count(*) FROM conversations c
      WHERE c.account_id = v_account AND c.status = 'open' AND c.assigned_agent_id IS NULL
    ),
    'windowsClosing', (
      SELECT count(*) FROM awaiting
      WHERE last_inbound_at > v_now - interval '24 hours'
        AND last_inbound_at <= v_now - interval '22 hours'
    ),
    'failed', (SELECT count(*) FROM failed),
    'failedMessages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'conversationId', f.conversation_id,
        'contactName', f.contact_name,
        'contactPhone', f.contact_phone,
        'preview', left(f.content_text, 120),
        'errorCode', f.error_code,
        'errorTitle', f.error_title,
        'at', f.created_at
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM failed ORDER BY created_at DESC LIMIT 10) f
    ), '[]'::jsonb),
    'queue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'conversationId', q.id,
        'contactName', ct.name,
        'contactPhone', ct.phone,
        'avatarUrl', ct.avatar_url,
        'preview', left(q.last_message_text, 120),
        'waitingSince', q.waiting_since,
        'windowClosesAt', q.last_inbound_at + interval '24 hours',
        'assignedAgentId', q.assigned_agent_id,
        'handedOff', COALESCE(q.handed_off, false)
      ) ORDER BY q.waiting_since)
      FROM (SELECT * FROM awaiting ORDER BY waiting_since LIMIT 6) q
      LEFT JOIN contacts ct ON ct.id = q.contact_id
    ), '[]'::jsonb)
  ) INTO v_attention;

  WITH msgs AS (
    SELECT m.id, m.conversation_id, m.sender_type, m.ai_generated, m.status, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_prev_start - interval '1 day'
  ),
  streams AS (
    SELECT
      'human'::text AS kind,
      conversation_id,
      created_at,
      sender_type = 'customer' AS is_customer,
      lag(sender_type = 'customer') OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS prev_customer
    FROM msgs
    WHERE sender_type = 'customer' OR (sender_type = 'agent' AND status <> 'failed')
    UNION ALL
    SELECT
      'ai'::text,
      conversation_id,
      created_at,
      sender_type = 'customer',
      lag(sender_type = 'customer') OVER (PARTITION BY conversation_id ORDER BY created_at, id)
    FROM msgs
    WHERE sender_type = 'customer' OR (ai_generated AND status <> 'failed')
  ),
  turns AS (
    SELECT
      s.kind,
      s.created_at AS asked_at,
      r.sender_id AS reply_agent,
      extract(epoch FROM r.created_at - s.created_at) / 60.0 AS minutes
    FROM streams s
    CROSS JOIN LATERAL (
      SELECT m2.sender_id, m2.created_at
      FROM messages m2
      WHERE m2.conversation_id = s.conversation_id
        AND m2.created_at > s.created_at
        AND m2.status <> 'failed'
        AND CASE WHEN s.kind = 'human' THEN m2.sender_type = 'agent' ELSE m2.ai_generated END
      ORDER BY m2.created_at, m2.id
      LIMIT 1
    ) r
    WHERE s.is_customer
      AND s.prev_customer IS NOT TRUE
      AND s.created_at >= v_prev_start
  ),
  members AS (
    SELECT p.user_id, p.full_name, p.avatar_url, p.account_role
    FROM profiles p
    WHERE p.account_id = v_account
  )
  SELECT jsonb_build_object(
    'medianHuman', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
      FROM turns WHERE kind = 'human' AND asked_at >= v_start
    ),
    'medianHumanPrevious', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
      FROM turns WHERE kind = 'human' AND asked_at >= v_prev_start AND asked_at < v_prev_end
    ),
    'team', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', mb.user_id,
        'name', mb.full_name,
        'avatarUrl', mb.avatar_url,
        'role', mb.account_role,
        'presence', mp.status,
        'lastSeenAt', mp.last_seen_at,
        'open', (
          SELECT count(*) FROM conversations c
          WHERE c.account_id = v_account AND c.status <> 'closed' AND c.assigned_agent_id = mb.user_id
        ),
        'replies', (
          SELECT count(*) FROM turns
          WHERE kind = 'human' AND reply_agent = mb.user_id AND asked_at >= v_start
        ),
        'medianMinutes', (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
          FROM turns
          WHERE kind = 'human' AND reply_agent = mb.user_id AND asked_at >= v_start
        )
      ) ORDER BY mb.full_name NULLS LAST)
      FROM members mb
      LEFT JOIN member_presence mp ON mp.user_id = mb.user_id AND mp.account_id = v_account
    ), '[]'::jsonb),
    'ai', jsonb_build_object(
      'replies', (
        SELECT count(*)
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.account_id = v_account AND m.ai_generated AND m.created_at >= v_start
      ),
      'medianMinutes', (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
        FROM turns WHERE kind = 'ai' AND asked_at >= v_start
      )
    )
  ) INTO v_replies;

  WITH buckets AS (
    SELECT b
    FROM generate_series(
      date_trunc(v_unit, v_start AT TIME ZONE v_tz),
      date_trunc(v_unit, v_now AT TIME ZONE v_tz),
      v_step
    ) AS b
  ),
  period_msgs AS (
    SELECT m.sender_type, m.created_at AT TIME ZONE v_tz AS local_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_start
  ),
  msg_counts AS (
    SELECT date_trunc(v_unit, local_at) AS b,
           count(*) FILTER (WHERE sender_type = 'customer') AS incoming,
           count(*) FILTER (WHERE sender_type <> 'customer') AS outgoing
    FROM period_msgs
    GROUP BY 1
  ),
  conv_counts AS (
    SELECT date_trunc(v_unit, created_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM conversations
    WHERE account_id = v_account AND created_at >= v_start
    GROUP BY 1
  ),
  resolved_counts AS (
    SELECT date_trunc(v_unit, closed_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM conversations
    WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_start
    GROUP BY 1
  ),
  won_counts AS (
    SELECT date_trunc(v_unit, closed_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM deals
    WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        't', to_char(bk.b, 'YYYY-MM-DD"T"HH24:MI'),
        'incoming', COALESCE(mc.incoming, 0),
        'outgoing', COALESCE(mc.outgoing, 0),
        'newConversations', COALESCE(cc.n, 0),
        'resolved', COALESCE(rc.n, 0),
        'dealsWon', COALESCE(wc.n, 0)
      ) ORDER BY bk.b)
      FROM buckets bk
      LEFT JOIN msg_counts mc ON mc.b = bk.b
      LEFT JOIN conv_counts cc ON cc.b = bk.b
      LEFT JOIN resolved_counts rc ON rc.b = bk.b
      LEFT JOIN won_counts wc ON wc.b = bk.b
    ), '[]'::jsonb),
    'hourly', (
      SELECT jsonb_agg(COALESCE(h.n, 0) ORDER BY hr.hour)
      FROM generate_series(0, 23) AS hr(hour)
      LEFT JOIN (
        SELECT extract(hour FROM local_at)::int AS hour, count(*) AS n
        FROM period_msgs
        WHERE sender_type = 'customer'
        GROUP BY 1
      ) h ON h.hour = hr.hour
    )
  ) INTO v_volume;

  SELECT jsonb_build_object(
    'newConversations', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND created_at >= v_start
    ),
    'newConversationsPrevious', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'resolved', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_start
    ),
    'resolvedPrevious', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'dealsWon', (
      SELECT count(*) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    ),
    'dealsWonPrevious', (
      SELECT count(*) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'dealsWonValue', (
      SELECT COALESCE(sum(value), 0) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    ),
    'broadcastDelivered', (
      SELECT COALESCE(sum(delivered_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_start
    ),
    'broadcastRead', (
      SELECT COALESCE(sum(read_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_start
    ),
    'broadcastDeliveredPrevious', (
      SELECT COALESCE(sum(delivered_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_prev_start
        AND COALESCE(scheduled_at, created_at) < v_prev_end
    ),
    'broadcastReadPrevious', (
      SELECT COALESCE(sum(read_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_prev_start
        AND COALESCE(scheduled_at, created_at) < v_prev_end
    )
  ) INTO v_kpis;

  SELECT jsonb_build_object(
    'pipelines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name) ORDER BY pl.created_at, pl.id)
      FROM pipelines pl
      WHERE pl.account_id = v_account
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'pipelineId', s.pipeline_id,
        'name', s.name,
        'color', s.color,
        'dealCount', (SELECT count(*) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open'),
        'totalValue', (SELECT COALESCE(sum(d.value), 0) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open')
      ) ORDER BY s.position, s.created_at)
      FROM pipeline_stages s
      JOIN pipelines pl ON pl.id = s.pipeline_id
      WHERE pl.account_id = v_account
    ), '[]'::jsonb),
    'stats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pipelineId', pl.id,
        'won', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= v_start
        ),
        'lost', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'lost' AND d.closed_at >= v_start
        ),
        'avgDaysToWin', (
          SELECT avg(extract(epoch FROM d.closed_at - d.created_at) / 86400.0) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= v_start
        ),
        'idleDeals', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'open' AND d.updated_at < v_now - interval '7 days'
        )
      ))
      FROM pipelines pl
      WHERE pl.account_id = v_account
    ), '[]'::jsonb)
  ) INTO v_pipeline;

  SELECT jsonb_build_object(
    'latestBroadcast', (
      SELECT jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'status', b.status,
        'at', COALESCE(b.scheduled_at, b.created_at),
        'recipients', b.total_recipients,
        'delivered', b.delivered_count,
        'read', b.read_count,
        'replied', b.replied_count,
        'failed', b.failed_count
      )
      FROM broadcasts b
      WHERE b.account_id = v_account AND b.status IN ('sending', 'sent', 'failed')
      ORDER BY COALESCE(b.scheduled_at, b.created_at) DESC
      LIMIT 1
    ),
    'automationRuns', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = v_account AND created_at >= v_start
    ),
    'automationFailed', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = v_account AND created_at >= v_start AND status = 'failed'
    ),
    'flowFailed', (
      SELECT count(*) FROM flow_runs
      WHERE account_id = v_account AND status = 'failed' AND ended_at >= v_start
    ),
    'topFailingFlow', (
      SELECT jsonb_build_object('id', f.id, 'name', f.name, 'failed', count(*))
      FROM flow_runs r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.account_id = v_account AND r.status = 'failed' AND r.ended_at >= v_start
      GROUP BY f.id, f.name
      ORDER BY count(*) DESC, f.name
      LIMIT 1
    ),
    'templatesApproved', (
      SELECT count(*) FROM message_templates
      WHERE account_id = v_account AND status = 'APPROVED'
    ),
    'templatesRejected', (
      SELECT count(*) FROM message_templates
      WHERE account_id = v_account AND status = 'REJECTED'
    )
  ) INTO v_campaigns;

  SELECT jsonb_build_object(
    'whatsappConnected', EXISTS (
      SELECT 1 FROM whatsapp_config WHERE account_id = v_account AND status = 'connected'
    ),
    'hasContacts', EXISTS (SELECT 1 FROM contacts WHERE account_id = v_account),
    'hasApprovedTemplate', EXISTS (
      SELECT 1 FROM message_templates WHERE account_id = v_account AND status = 'APPROVED'
    ),
    'memberCount', (SELECT count(*) FROM profiles WHERE account_id = v_account),
    'hasConversations', EXISTS (SELECT 1 FROM conversations WHERE account_id = v_account)
  ) INTO v_setup;

  RETURN jsonb_build_object(
    'generatedAt', v_now,
    'timeZone', v_tz,
    'days', p_days,
    'unit', v_unit,
    'periodStart', v_start,
    'previousStart', v_prev_start,
    'previousEnd', v_prev_end,
    'replyTargetMinutes', v_target,
    'attention', v_attention,
    'replies', v_replies,
    'volume', v_volume,
    'kpis', v_kpis,
    'pipeline', v_pipeline,
    'campaigns', v_campaigns,
    'setup', v_setup
  );
END;
$function$
;

-- public.dearmor(text)
CREATE OR REPLACE FUNCTION public.dearmor(text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_dearmor$function$
;

-- public.decrypt(bytea, bytea, text)
CREATE OR REPLACE FUNCTION public.decrypt(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_decrypt$function$
;

-- public.decrypt_iv(bytea, bytea, bytea, text)
CREATE OR REPLACE FUNCTION public.decrypt_iv(bytea, bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_decrypt_iv$function$
;

-- public.digest(text, text)
CREATE OR REPLACE FUNCTION public.digest(text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_digest$function$
;

-- public.digest(bytea, text)
CREATE OR REPLACE FUNCTION public.digest(bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_digest$function$
;

-- public.encrypt(bytea, bytea, text)
CREATE OR REPLACE FUNCTION public.encrypt(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_encrypt$function$
;

-- public.encrypt_iv(bytea, bytea, bytea, text)
CREATE OR REPLACE FUNCTION public.encrypt_iv(bytea, bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_encrypt_iv$function$
;

-- public.enforce_account_identity_columns()
CREATE OR REPLACE FUNCTION public.enforce_account_identity_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'owner_user_id, id and created_at cannot be changed directly; use transfer_account_ownership'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$
;

-- public.enforce_conversation_assignee_membership()
CREATE OR REPLACE FUNCTION public.enforce_conversation_assignee_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND EXISTS (
       SELECT 1 FROM profiles
       WHERE user_id = OLD.assigned_agent_id
         AND account_id = OLD.account_id
     )
  THEN
    NEW.assigned_agent_id := OLD.assigned_agent_id;
  ELSE
    NEW.assigned_agent_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$
;

-- public.enforce_profile_privilege_columns()
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION
      'profiles are created by the signup trigger; they cannot be inserted directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
  THEN
    RAISE EXCEPTION
      'account_role and account_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$
;

-- public.filter_contacts_by_tags(p_tag_ids uuid[], p_search text, p_limit integer, p_offset integer)
CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(p_tag_ids uuid[], p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(contact contacts, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH matched AS (
    -- Distinct contacts having ANY of the selected tags (OR),
    -- narrowed by the same name/phone/email search as the list.
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$function$
;

-- public.fips_mode()
CREATE OR REPLACE FUNCTION public.fips_mode()
 RETURNS boolean
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_check_fipsmode$function$
;

-- public.gen_random_bytes(integer)
CREATE OR REPLACE FUNCTION public.gen_random_bytes(integer)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_random_bytes$function$
;

-- public.gen_random_uuid()
CREATE OR REPLACE FUNCTION public.gen_random_uuid()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/pgcrypto', $function$pg_random_uuid$function$
;

-- public.gen_salt(text, integer)
CREATE OR REPLACE FUNCTION public.gen_salt(text, integer)
 RETURNS text
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_gen_salt_rounds$function$
;

-- public.gen_salt(text)
CREATE OR REPLACE FUNCTION public.gen_salt(text)
 RETURNS text
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_gen_salt$function$
;

-- public.halfvec(halfvec, integer, boolean)
CREATE OR REPLACE FUNCTION public.halfvec(halfvec, integer, boolean)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec$function$
;

-- public.halfvec_accum(double precision[], halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_accum(double precision[], halfvec)
 RETURNS double precision[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_accum$function$
;

-- public.halfvec_add(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_add(halfvec, halfvec)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_add$function$
;

-- public.halfvec_avg(double precision[])
CREATE OR REPLACE FUNCTION public.halfvec_avg(double precision[])
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_avg$function$
;

-- public.halfvec_cmp(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_cmp(halfvec, halfvec)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_cmp$function$
;

-- public.halfvec_combine(double precision[], double precision[])
CREATE OR REPLACE FUNCTION public.halfvec_combine(double precision[], double precision[])
 RETURNS double precision[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_combine$function$
;

-- public.halfvec_concat(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_concat(halfvec, halfvec)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_concat$function$
;

-- public.halfvec_eq(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_eq(halfvec, halfvec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_eq$function$
;

-- public.halfvec_ge(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_ge(halfvec, halfvec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_ge$function$
;

-- public.halfvec_gt(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_gt(halfvec, halfvec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_gt$function$
;

-- public.halfvec_in(cstring, oid, integer)
CREATE OR REPLACE FUNCTION public.halfvec_in(cstring, oid, integer)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_in$function$
;

-- public.halfvec_l2_squared_distance(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_l2_squared_distance(halfvec, halfvec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_l2_squared_distance$function$
;

-- public.halfvec_le(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_le(halfvec, halfvec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_le$function$
;

-- public.halfvec_lt(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_lt(halfvec, halfvec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_lt$function$
;

-- public.halfvec_mul(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_mul(halfvec, halfvec)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_mul$function$
;

-- public.halfvec_ne(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_ne(halfvec, halfvec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_ne$function$
;

-- public.halfvec_negative_inner_product(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_negative_inner_product(halfvec, halfvec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_negative_inner_product$function$
;

-- public.halfvec_out(halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_out(halfvec)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_out$function$
;

-- public.halfvec_recv(internal, oid, integer)
CREATE OR REPLACE FUNCTION public.halfvec_recv(internal, oid, integer)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_recv$function$
;

-- public.halfvec_send(halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_send(halfvec)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_send$function$
;

-- public.halfvec_spherical_distance(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_spherical_distance(halfvec, halfvec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_spherical_distance$function$
;

-- public.halfvec_sub(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.halfvec_sub(halfvec, halfvec)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_sub$function$
;

-- public.halfvec_to_float4(halfvec, integer, boolean)
CREATE OR REPLACE FUNCTION public.halfvec_to_float4(halfvec, integer, boolean)
 RETURNS real[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_to_float4$function$
;

-- public.halfvec_to_sparsevec(halfvec, integer, boolean)
CREATE OR REPLACE FUNCTION public.halfvec_to_sparsevec(halfvec, integer, boolean)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_to_sparsevec$function$
;

-- public.halfvec_to_vector(halfvec, integer, boolean)
CREATE OR REPLACE FUNCTION public.halfvec_to_vector(halfvec, integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_to_vector$function$
;

-- public.halfvec_typmod_in(cstring[])
CREATE OR REPLACE FUNCTION public.halfvec_typmod_in(cstring[])
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_typmod_in$function$
;

-- public.hamming_distance(bit, bit)
CREATE OR REPLACE FUNCTION public.hamming_distance(bit, bit)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$hamming_distance$function$
;

-- public.handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$
;

-- public.hmac(text, text, text)
CREATE OR REPLACE FUNCTION public.hmac(text, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_hmac$function$
;

-- public.hmac(bytea, bytea, text)
CREATE OR REPLACE FUNCTION public.hmac(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_hmac$function$
;

-- public.hnsw_bit_support(internal)
CREATE OR REPLACE FUNCTION public.hnsw_bit_support(internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/vector', $function$hnsw_bit_support$function$
;

-- public.hnsw_halfvec_support(internal)
CREATE OR REPLACE FUNCTION public.hnsw_halfvec_support(internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/vector', $function$hnsw_halfvec_support$function$
;

-- public.hnsw_sparsevec_support(internal)
CREATE OR REPLACE FUNCTION public.hnsw_sparsevec_support(internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/vector', $function$hnsw_sparsevec_support$function$
;

-- public.hnswhandler(internal)
CREATE OR REPLACE FUNCTION public.hnswhandler(internal)
 RETURNS index_am_handler
 LANGUAGE c
AS '$libdir/vector', $function$hnswhandler$function$
;

-- public.increment_automation_execution_count(p_automation_id uuid)
CREATE OR REPLACE FUNCTION public.increment_automation_execution_count(p_automation_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE automations
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_automation_id;
$function$
;

-- public.increment_flow_execution_count(p_flow_id uuid)
CREATE OR REPLACE FUNCTION public.increment_flow_execution_count(p_flow_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE flows
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_flow_id;
$function$
;

-- public.inner_product(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.inner_product(halfvec, halfvec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_inner_product$function$
;

-- public.inner_product(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.inner_product(sparsevec, sparsevec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_inner_product$function$
;

-- public.inner_product(vector, vector)
CREATE OR REPLACE FUNCTION public.inner_product(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$inner_product$function$
;

-- public.is_account_member(target_account_id uuid, min_role account_role_enum)
CREATE OR REPLACE FUNCTION public.is_account_member(target_account_id uuid, min_role account_role_enum DEFAULT 'viewer'::account_role_enum)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$function$
;

-- public.ivfflat_bit_support(internal)
CREATE OR REPLACE FUNCTION public.ivfflat_bit_support(internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/vector', $function$ivfflat_bit_support$function$
;

-- public.ivfflat_halfvec_support(internal)
CREATE OR REPLACE FUNCTION public.ivfflat_halfvec_support(internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/vector', $function$ivfflat_halfvec_support$function$
;

-- public.ivfflathandler(internal)
CREATE OR REPLACE FUNCTION public.ivfflathandler(internal)
 RETURNS index_am_handler
 LANGUAGE c
AS '$libdir/vector', $function$ivfflathandler$function$
;

-- public.jaccard_distance(bit, bit)
CREATE OR REPLACE FUNCTION public.jaccard_distance(bit, bit)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$jaccard_distance$function$
;

-- public.l1_distance(vector, vector)
CREATE OR REPLACE FUNCTION public.l1_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$l1_distance$function$
;

-- public.l1_distance(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.l1_distance(halfvec, halfvec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_l1_distance$function$
;

-- public.l1_distance(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.l1_distance(sparsevec, sparsevec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_l1_distance$function$
;

-- public.l2_distance(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.l2_distance(sparsevec, sparsevec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_l2_distance$function$
;

-- public.l2_distance(vector, vector)
CREATE OR REPLACE FUNCTION public.l2_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$l2_distance$function$
;

-- public.l2_distance(halfvec, halfvec)
CREATE OR REPLACE FUNCTION public.l2_distance(halfvec, halfvec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_l2_distance$function$
;

-- public.l2_norm(halfvec)
CREATE OR REPLACE FUNCTION public.l2_norm(halfvec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_l2_norm$function$
;

-- public.l2_norm(sparsevec)
CREATE OR REPLACE FUNCTION public.l2_norm(sparsevec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_l2_norm$function$
;

-- public.l2_normalize(sparsevec)
CREATE OR REPLACE FUNCTION public.l2_normalize(sparsevec)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_l2_normalize$function$
;

-- public.l2_normalize(vector)
CREATE OR REPLACE FUNCTION public.l2_normalize(vector)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$l2_normalize$function$
;

-- public.l2_normalize(halfvec)
CREATE OR REPLACE FUNCTION public.l2_normalize(halfvec)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_l2_normalize$function$
;

-- public.list_timed_out_flow_runs(p_now timestamp with time zone, p_limit integer)
CREATE OR REPLACE FUNCTION public.list_timed_out_flow_runs(p_now timestamp with time zone, p_limit integer)
 RETURNS TABLE(id uuid, last_advanced_at timestamp with time zone, fallback_policy jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.last_advanced_at, f.fallback_policy
  FROM flow_runs r
  LEFT JOIN flows f ON f.id = r.flow_id
  WHERE r.status = 'active'
    AND r.last_advanced_at <= p_now - make_interval(secs => 3600 * (
      CASE
        WHEN jsonb_typeof(f.fallback_policy->'on_timeout_hours') = 'number'
          AND (f.fallback_policy->>'on_timeout_hours')::NUMERIC > 0
        THEN LEAST((f.fallback_policy->>'on_timeout_hours')::NUMERIC, 87600)
        ELSE 24
      END
    )::DOUBLE PRECISION)
  ORDER BY r.last_advanced_at, r.id
  LIMIT GREATEST(p_limit, 0);
$function$
;

-- public.match_ai_knowledge_fts(p_account_id uuid, p_query text, p_match_count integer)
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(p_account_id uuid, p_query text, p_match_count integer)
 RETURNS TABLE(id uuid, content text, rank real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH any_term AS (
    SELECT string_agg(
             '''' || replace(replace(lexeme, '\', '\\'), '''', '''''') || '''',
             ' | '
           )::tsquery AS query
    FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query, '')))) AS lexeme
  )
  SELECT c.id,
         c.content,
         ts_rank(c.fts, any_term.query) AS rank
  FROM ai_knowledge_chunks c
  CROSS JOIN any_term
  WHERE any_term.query IS NOT NULL
    AND c.account_id = p_account_id
    AND c.fts @@ any_term.query
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$function$
;

-- public.match_ai_knowledge_semantic(p_account_id uuid, p_query_embedding text, p_match_count integer)
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(p_account_id uuid, p_query_embedding text, p_match_count integer)
 RETURNS TABLE(id uuid, content text, distance real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$function$
;

-- public.merge_duplicate_contacts()
CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group   RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           phone_normalized,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM contacts
    WHERE phone_normalized <> ''
    GROUP BY account_id, phone_normalized
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    -- Plain re-point: these tables have no contact-scoped unique
    -- constraint. `conversations` is ON DELETE CASCADE, so this
    -- re-point is what saves its rows (and their messages) from
    -- being deleted with the loser contact.
    UPDATE conversations                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE contact_notes                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);

    -- Conflict-guarded re-point for UNIQUE(contact_id, tag_id):
    -- move only tags the survivor doesn't already have, drop the rest.
    UPDATE contact_tags ct SET contact_id = v_survivor
      WHERE ct.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_tags s
          WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id
        );
    DELETE FROM contact_tags WHERE contact_id = ANY(v_losers);

    -- Same guard for UNIQUE(contact_id, custom_field_id). Survivor's
    -- own value wins on conflict.
    UPDATE contact_custom_values cv SET contact_id = v_survivor
      WHERE cv.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_custom_values s
          WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id
        );
    DELETE FROM contact_custom_values WHERE contact_id = ANY(v_losers);

    -- flow_runs has a partial UNIQUE on active runs per contact.
    -- Re-point only NON-active runs (exempt from the partial index)
    -- to preserve history; any active loser run is left to be
    -- NULLed by its FK's ON DELETE SET NULL when the loser is
    -- removed below — avoids colliding with the survivor's active run.
    UPDATE flow_runs SET contact_id = v_survivor
      WHERE contact_id = ANY(v_losers) AND status <> 'active';

    DELETE FROM contacts WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$function$
;

-- public.merge_duplicate_conversations()
CREATE OR REPLACE FUNCTION public.merge_duplicate_conversations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group    RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_all      UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           contact_id,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids,
           COALESCE(SUM(unread_count), 0)                AS total_unread
    FROM conversations
    GROUP BY account_id, contact_id
    HAVING count(*) > 1
  LOOP
    v_all      := v_group.ids;
    v_survivor := v_all[1];
    v_losers   := v_all[2:array_length(v_all, 1)];

    -- Re-point every conversation-scoped child from the losers onto
    -- the survivor. None of these carry a conversation-scoped unique
    -- constraint (message_id is intentionally non-unique — see
    -- migration 009), so a plain UPDATE is safe. Doing this BEFORE the
    -- delete is what saves the ON DELETE CASCADE children (messages,
    -- message_reactions, notifications) from being removed with the
    -- loser conversations.
    UPDATE messages          SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE message_reactions SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE deals             SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE flow_runs         SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE notifications     SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE ai_usage_log      SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);

    -- Roll the merged unread counts onto the survivor and re-derive
    -- its last-message summary from the now-complete message set, so
    -- the surviving thread reflects the full history.
    UPDATE conversations c
    SET unread_count      = v_group.total_unread,
        last_message_text = lm.content_text,
        last_message_at   = lm.created_at,
        updated_at        = NOW()
    FROM (
      SELECT content_text, created_at
      FROM messages
      WHERE conversation_id = v_survivor
      ORDER BY created_at DESC
      LIMIT 1
    ) lm
    WHERE c.id = v_survivor;

    -- Survivor may have no messages at all (edge case). Still fold in
    -- the merged unread count in that case.
    UPDATE conversations
    SET unread_count = v_group.total_unread,
        updated_at   = NOW()
    WHERE id = v_survivor
      AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = v_survivor);

    DELETE FROM conversations WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$function$
;

-- public.notify_conversation_assigned()
CREATE OR REPLACE FUNCTION public.notify_conversation_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$
;

-- public.peek_invitation(p_token_hash text)
CREATE OR REPLACE FUNCTION public.peek_invitation(p_token_hash text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name INTO v_account_name
  FROM accounts
  WHERE id = v_inv.account_id;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
END;
$function$
;

-- public.pgp_armor_headers(text, OUT key text, OUT value text)
CREATE OR REPLACE FUNCTION public.pgp_armor_headers(text, OUT key text, OUT value text)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_armor_headers$function$
;

-- public.pgp_key_id(bytea)
CREATE OR REPLACE FUNCTION public.pgp_key_id(bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_key_id_w$function$
;

-- public.pgp_pub_decrypt(bytea, bytea, text, text)
CREATE OR REPLACE FUNCTION public.pgp_pub_decrypt(bytea, bytea, text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$
;

-- public.pgp_pub_decrypt(bytea, bytea)
CREATE OR REPLACE FUNCTION public.pgp_pub_decrypt(bytea, bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$
;

-- public.pgp_pub_decrypt(bytea, bytea, text)
CREATE OR REPLACE FUNCTION public.pgp_pub_decrypt(bytea, bytea, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$
;

-- public.pgp_pub_decrypt_bytea(bytea, bytea, text)
CREATE OR REPLACE FUNCTION public.pgp_pub_decrypt_bytea(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$
;

-- public.pgp_pub_decrypt_bytea(bytea, bytea)
CREATE OR REPLACE FUNCTION public.pgp_pub_decrypt_bytea(bytea, bytea)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$
;

-- public.pgp_pub_decrypt_bytea(bytea, bytea, text, text)
CREATE OR REPLACE FUNCTION public.pgp_pub_decrypt_bytea(bytea, bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$
;

-- public.pgp_pub_encrypt(text, bytea, text)
CREATE OR REPLACE FUNCTION public.pgp_pub_encrypt(text, bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_text$function$
;

-- public.pgp_pub_encrypt(text, bytea)
CREATE OR REPLACE FUNCTION public.pgp_pub_encrypt(text, bytea)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_text$function$
;

-- public.pgp_pub_encrypt_bytea(bytea, bytea)
CREATE OR REPLACE FUNCTION public.pgp_pub_encrypt_bytea(bytea, bytea)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_bytea$function$
;

-- public.pgp_pub_encrypt_bytea(bytea, bytea, text)
CREATE OR REPLACE FUNCTION public.pgp_pub_encrypt_bytea(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_bytea$function$
;

-- public.pgp_sym_decrypt(bytea, text)
CREATE OR REPLACE FUNCTION public.pgp_sym_decrypt(bytea, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_text$function$
;

-- public.pgp_sym_decrypt(bytea, text, text)
CREATE OR REPLACE FUNCTION public.pgp_sym_decrypt(bytea, text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_text$function$
;

-- public.pgp_sym_decrypt_bytea(bytea, text)
CREATE OR REPLACE FUNCTION public.pgp_sym_decrypt_bytea(bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_bytea$function$
;

-- public.pgp_sym_decrypt_bytea(bytea, text, text)
CREATE OR REPLACE FUNCTION public.pgp_sym_decrypt_bytea(bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_bytea$function$
;

-- public.pgp_sym_encrypt(text, text, text)
CREATE OR REPLACE FUNCTION public.pgp_sym_encrypt(text, text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_text$function$
;

-- public.pgp_sym_encrypt(text, text)
CREATE OR REPLACE FUNCTION public.pgp_sym_encrypt(text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_text$function$
;

-- public.pgp_sym_encrypt_bytea(bytea, text)
CREATE OR REPLACE FUNCTION public.pgp_sym_encrypt_bytea(bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_bytea$function$
;

-- public.pgp_sym_encrypt_bytea(bytea, text, text)
CREATE OR REPLACE FUNCTION public.pgp_sym_encrypt_bytea(bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_bytea$function$
;

-- public.realtime_notify()
CREATE OR REPLACE FUNCTION public.realtime_notify()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  rec   jsonb;
  pk    jsonb := '{}'::jsonb;
  col   text;
BEGIN
  rec := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  FOREACH col IN ARRAY TG_ARGV LOOP
    pk := pk || jsonb_build_object(col, rec -> col);
  END LOOP;
  PERFORM pg_notify(
    'anyqora_realtime',
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'type', TG_OP,
      -- Only the primary key travels: INSERT/UPDATE rows are re-read
      -- under each subscriber's RLS, and a DELETE (which can't be
      -- re-read) exposes nothing beyond its key — same as Supabase.
      'pk', pk
    )::text
  );
  RETURN NULL;
END
$function$
;

-- public.recompute_broadcast_counts(bid uuid)
CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$function$
;

-- public.record_webhook_failure(endpoint_id uuid, max_failures integer)
CREATE OR REPLACE FUNCTION public.record_webhook_failure(endpoint_id uuid, max_failures integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE webhook_endpoints
  SET failure_count = failure_count + 1,
      is_active = CASE
        WHEN failure_count + 1 >= max_failures THEN false
        ELSE is_active
      END
  WHERE id = endpoint_id;
$function$
;

-- public.redeem_invitation(p_token_hash text)
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM companies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tasks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM views WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$function$
;

-- public.remove_account_member(p_user_id uuid)
CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM profiles
  WHERE user_id IN (auth.uid(), p_user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  UPDATE conversations
  SET assigned_agent_id = NULL
  WHERE account_id = v_target_account_id
    AND assigned_agent_id = p_user_id;

  RETURN v_new_account_id;
END;
$function$
;

-- public.renew_broadcast_delivery_lease(p_broadcast_id uuid, p_held timestamp with time zone)
CREATE OR REPLACE FUNCTION public.renew_broadcast_delivery_lease(p_broadcast_id uuid, p_held timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lease TIMESTAMPTZ;
BEGIN
  UPDATE broadcasts b
  SET delivery_lease_until = now() + INTERVAL '5 minutes'
  WHERE b.id = p_broadcast_id
    AND is_account_member(b.account_id, 'agent')
    AND b.delivery_lease_until = p_held
  RETURNING b.delivery_lease_until INTO v_lease;
  RETURN v_lease;
END;
$function$
;

-- public.replace_flow_graph(p_flow_id uuid, p_nodes jsonb, p_flow jsonb)
CREATE OR REPLACE FUNCTION public.replace_flow_graph(p_flow_id uuid, p_nodes jsonb, p_flow jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cancelled INTEGER;
BEGIN
  IF p_flow IS NULL OR jsonb_typeof(p_flow) <> 'object' THEN
    RAISE EXCEPTION 'p_flow must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_cancelled := replace_flow_nodes(p_flow_id, p_nodes);

  UPDATE flows
  SET name = CASE WHEN p_flow ? 'name' THEN p_flow->>'name' ELSE name END,
      description = CASE WHEN p_flow ? 'description' THEN p_flow->>'description' ELSE description END,
      trigger_type = CASE WHEN p_flow ? 'trigger_type' THEN p_flow->>'trigger_type' ELSE trigger_type END,
      trigger_config = CASE WHEN p_flow ? 'trigger_config' THEN p_flow->'trigger_config' ELSE trigger_config END,
      entry_node_id = CASE WHEN p_flow ? 'entry_node_id' THEN p_flow->>'entry_node_id' ELSE entry_node_id END,
      fallback_policy = CASE WHEN p_flow ? 'fallback_policy' THEN p_flow->'fallback_policy' ELSE fallback_policy END,
      updated_at = NOW()
  WHERE id = p_flow_id;

  RETURN v_cancelled;
END;
$function$
;

-- public.replace_flow_nodes(p_flow_id uuid, p_nodes jsonb)
CREATE OR REPLACE FUNCTION public.replace_flow_nodes(p_flow_id uuid, p_nodes jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id UUID;
  v_cancelled INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION 'p_nodes must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM flows
  WHERE id = p_flow_id
  FOR UPDATE;

  IF v_account_id IS NULL OR NOT is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Flow not found' USING ERRCODE = '42501';
  END IF;

  DELETE FROM flow_nodes WHERE flow_id = p_flow_id;

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  SELECT
    p_flow_id,
    n->>'node_key',
    n->>'node_type',
    COALESCE(n->'config', '{}'::jsonb),
    COALESCE((n->>'position_x')::INTEGER, 0),
    COALESCE((n->>'position_y')::INTEGER, 0)
  FROM jsonb_array_elements(p_nodes) AS n;

  UPDATE flow_runs r
  SET status = 'cancelled',
      ended_at = NOW(),
      end_reason = 'current_node_removed'
  WHERE r.flow_id = p_flow_id
    AND r.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM flow_nodes fn
      WHERE fn.flow_id = p_flow_id
        AND fn.node_key = r.current_node_key
    );
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN v_cancelled;
END;
$function$
;

-- public.set_member_role(p_user_id uuid, p_new_role account_role_enum)
CREATE OR REPLACE FUNCTION public.set_member_role(p_user_id uuid, p_new_role account_role_enum)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM profiles
  WHERE user_id IN (auth.uid(), p_user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id;
END;
$function$
;

-- public.sparsevec(sparsevec, integer, boolean)
CREATE OR REPLACE FUNCTION public.sparsevec(sparsevec, integer, boolean)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec$function$
;

-- public.sparsevec_cmp(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_cmp(sparsevec, sparsevec)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_cmp$function$
;

-- public.sparsevec_eq(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_eq(sparsevec, sparsevec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_eq$function$
;

-- public.sparsevec_ge(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_ge(sparsevec, sparsevec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_ge$function$
;

-- public.sparsevec_gt(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_gt(sparsevec, sparsevec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_gt$function$
;

-- public.sparsevec_in(cstring, oid, integer)
CREATE OR REPLACE FUNCTION public.sparsevec_in(cstring, oid, integer)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_in$function$
;

-- public.sparsevec_l2_squared_distance(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_l2_squared_distance(sparsevec, sparsevec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_l2_squared_distance$function$
;

-- public.sparsevec_le(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_le(sparsevec, sparsevec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_le$function$
;

-- public.sparsevec_lt(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_lt(sparsevec, sparsevec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_lt$function$
;

-- public.sparsevec_ne(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_ne(sparsevec, sparsevec)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_ne$function$
;

-- public.sparsevec_negative_inner_product(sparsevec, sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_negative_inner_product(sparsevec, sparsevec)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_negative_inner_product$function$
;

-- public.sparsevec_out(sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_out(sparsevec)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_out$function$
;

-- public.sparsevec_recv(internal, oid, integer)
CREATE OR REPLACE FUNCTION public.sparsevec_recv(internal, oid, integer)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_recv$function$
;

-- public.sparsevec_send(sparsevec)
CREATE OR REPLACE FUNCTION public.sparsevec_send(sparsevec)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_send$function$
;

-- public.sparsevec_to_halfvec(sparsevec, integer, boolean)
CREATE OR REPLACE FUNCTION public.sparsevec_to_halfvec(sparsevec, integer, boolean)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_to_halfvec$function$
;

-- public.sparsevec_to_vector(sparsevec, integer, boolean)
CREATE OR REPLACE FUNCTION public.sparsevec_to_vector(sparsevec, integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_to_vector$function$
;

-- public.sparsevec_typmod_in(cstring[])
CREATE OR REPLACE FUNCTION public.sparsevec_typmod_in(cstring[])
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$sparsevec_typmod_in$function$
;

-- public.stamp_conversation_closed_at()
CREATE OR REPLACE FUNCTION public.stamp_conversation_closed_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status <> 'closed' THEN
    NEW.closed_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  ELSIF OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.closed_at := now();
  ELSE
    NEW.closed_at := COALESCE(OLD.closed_at, now());
  END IF;
  RETURN NEW;
END;
$function$
;

-- public.stamp_deal_closed_at()
CREATE OR REPLACE FUNCTION public.stamp_deal_closed_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('won', 'lost') THEN
    NEW.closed_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.closed_at := now();
  ELSE
    NEW.closed_at := COALESCE(OLD.closed_at, now());
  END IF;
  RETURN NEW;
END;
$function$
;

-- public.subvector(vector, integer, integer)
CREATE OR REPLACE FUNCTION public.subvector(vector, integer, integer)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$subvector$function$
;

-- public.subvector(halfvec, integer, integer)
CREATE OR REPLACE FUNCTION public.subvector(halfvec, integer, integer)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_subvector$function$
;

-- public.tasks_stamp_completed_at()
CREATE OR REPLACE FUNCTION public.tasks_stamp_completed_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END
$function$
;

-- public.touch_presence(p_status text)
CREATE OR REPLACE FUNCTION public.touch_presence(p_status text DEFAULT 'online'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;
END;
$function$
;

-- public.track_conversation_message_times()
CREATE OR REPLACE FUNCTION public.track_conversation_message_times()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sender_type = 'customer' THEN
      UPDATE conversations
      SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, NEW.created_at), NEW.created_at)
      WHERE id = NEW.conversation_id;
    ELSIF (NEW.sender_type = 'agent' OR NEW.ai_generated) AND NEW.status IS DISTINCT FROM 'failed' THEN
      UPDATE conversations
      SET last_reply_at = GREATEST(COALESCE(last_reply_at, NEW.created_at), NEW.created_at)
      WHERE id = NEW.conversation_id;
    END IF;
  ELSIF NEW.status = 'failed'
    AND OLD.status IS DISTINCT FROM 'failed'
    AND (NEW.sender_type = 'agent' OR NEW.ai_generated) THEN
    UPDATE conversations
    SET last_reply_at = (
      SELECT max(m.created_at)
      FROM messages m
      WHERE m.conversation_id = NEW.conversation_id
        AND (m.sender_type = 'agent' OR m.ai_generated)
        AND m.status <> 'failed'
    )
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END;
$function$
;

-- public.transfer_account_ownership(p_new_owner_user_id uuid)
CREATE OR REPLACE FUNCTION public.transfer_account_ownership(p_new_owner_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM profiles
  WHERE user_id IN (auth.uid(), p_new_owner_user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_new_owner_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid();

  UPDATE profiles SET account_role = 'owner'
  WHERE user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;
END;
$function$
;

-- public.update_ai_configs_updated_at()
CREATE OR REPLACE FUNCTION public.update_ai_configs_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

-- public.update_ai_knowledge_documents_updated_at()
CREATE OR REPLACE FUNCTION public.update_ai_knowledge_documents_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

-- public.update_updated_at_column()
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

-- public.uuid_generate_v1()
CREATE OR REPLACE FUNCTION public.uuid_generate_v1()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1$function$
;

-- public.uuid_generate_v1mc()
CREATE OR REPLACE FUNCTION public.uuid_generate_v1mc()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1mc$function$
;

-- public.uuid_generate_v3(namespace uuid, name text)
CREATE OR REPLACE FUNCTION public.uuid_generate_v3(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v3$function$
;

-- public.uuid_generate_v4()
CREATE OR REPLACE FUNCTION public.uuid_generate_v4()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v4$function$
;

-- public.uuid_generate_v5(namespace uuid, name text)
CREATE OR REPLACE FUNCTION public.uuid_generate_v5(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v5$function$
;

-- public.uuid_nil()
CREATE OR REPLACE FUNCTION public.uuid_nil()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_nil$function$
;

-- public.uuid_ns_dns()
CREATE OR REPLACE FUNCTION public.uuid_ns_dns()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_dns$function$
;

-- public.uuid_ns_oid()
CREATE OR REPLACE FUNCTION public.uuid_ns_oid()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_oid$function$
;

-- public.uuid_ns_url()
CREATE OR REPLACE FUNCTION public.uuid_ns_url()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_url$function$
;

-- public.uuid_ns_x500()
CREATE OR REPLACE FUNCTION public.uuid_ns_x500()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_x500$function$
;

-- public.vector(vector, integer, boolean)
CREATE OR REPLACE FUNCTION public.vector(vector, integer, boolean)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector$function$
;

-- public.vector_accum(double precision[], vector)
CREATE OR REPLACE FUNCTION public.vector_accum(double precision[], vector)
 RETURNS double precision[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_accum$function$
;

-- public.vector_add(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_add(vector, vector)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_add$function$
;

-- public.vector_avg(double precision[])
CREATE OR REPLACE FUNCTION public.vector_avg(double precision[])
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_avg$function$
;

-- public.vector_cmp(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_cmp(vector, vector)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_cmp$function$
;

-- public.vector_combine(double precision[], double precision[])
CREATE OR REPLACE FUNCTION public.vector_combine(double precision[], double precision[])
 RETURNS double precision[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_combine$function$
;

-- public.vector_concat(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_concat(vector, vector)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_concat$function$
;

-- public.vector_dims(vector)
CREATE OR REPLACE FUNCTION public.vector_dims(vector)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_dims$function$
;

-- public.vector_dims(halfvec)
CREATE OR REPLACE FUNCTION public.vector_dims(halfvec)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$halfvec_vector_dims$function$
;

-- public.vector_eq(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_eq(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_eq$function$
;

-- public.vector_ge(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_ge(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_ge$function$
;

-- public.vector_gt(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_gt(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_gt$function$
;

-- public.vector_in(cstring, oid, integer)
CREATE OR REPLACE FUNCTION public.vector_in(cstring, oid, integer)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_in$function$
;

-- public.vector_l2_squared_distance(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_l2_squared_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_l2_squared_distance$function$
;

-- public.vector_le(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_le(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_le$function$
;

-- public.vector_lt(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_lt(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_lt$function$
;

-- public.vector_mul(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_mul(vector, vector)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_mul$function$
;

-- public.vector_ne(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_ne(vector, vector)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_ne$function$
;

-- public.vector_negative_inner_product(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_negative_inner_product(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_negative_inner_product$function$
;

-- public.vector_norm(vector)
CREATE OR REPLACE FUNCTION public.vector_norm(vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_norm$function$
;

-- public.vector_out(vector)
CREATE OR REPLACE FUNCTION public.vector_out(vector)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_out$function$
;

-- public.vector_recv(internal, oid, integer)
CREATE OR REPLACE FUNCTION public.vector_recv(internal, oid, integer)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_recv$function$
;

-- public.vector_send(vector)
CREATE OR REPLACE FUNCTION public.vector_send(vector)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_send$function$
;

-- public.vector_spherical_distance(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_spherical_distance(vector, vector)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_spherical_distance$function$
;

-- public.vector_sub(vector, vector)
CREATE OR REPLACE FUNCTION public.vector_sub(vector, vector)
 RETURNS vector
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_sub$function$
;

-- public.vector_to_float4(vector, integer, boolean)
CREATE OR REPLACE FUNCTION public.vector_to_float4(vector, integer, boolean)
 RETURNS real[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_to_float4$function$
;

-- public.vector_to_halfvec(vector, integer, boolean)
CREATE OR REPLACE FUNCTION public.vector_to_halfvec(vector, integer, boolean)
 RETURNS halfvec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_to_halfvec$function$
;

-- public.vector_to_sparsevec(vector, integer, boolean)
CREATE OR REPLACE FUNCTION public.vector_to_sparsevec(vector, integer, boolean)
 RETURNS sparsevec
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_to_sparsevec$function$
;

-- public.vector_typmod_in(cstring[])
CREATE OR REPLACE FUNCTION public.vector_typmod_in(cstring[])
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/vector', $function$vector_typmod_in$function$
;

-- storage.extension(name text)
CREATE OR REPLACE FUNCTION storage.extension(name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT reverse(split_part(reverse(storage.filename(name)), '.', 1))
$function$
;

-- storage.filename(name text)
CREATE OR REPLACE FUNCTION storage.filename(name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$function$
;

-- storage.foldername(name text)
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$function$
;

