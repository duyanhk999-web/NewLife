-- Đô Thị Ảo — M2 migration 003 (SRS v2.1 §5.7)
-- Atomic RPCs: every money change is ONE transaction + row lock +
-- idempotency check + append-only log. SECURITY DEFINER so they bypass
-- RLS; the client (anon key) can only call them, never write tables
-- directly. The server (Render) calls these with the service_role key.
-- Return shape: jsonb { ok, error?, cash, bank, ... }.

-- Helper: append a transaction-log row (idempotency_key UNIQUE — a
-- duplicate insert raises unique_violation, caught by each RPC).
create or replace function public._log_tx(
  p_user_id uuid, p_type text, p_amount bigint, p_balance_after bigint,
  p_key uuid, p_meta jsonb
) returns void as $$
begin
  insert into public.transaction_logs
    (user_id, type, amount, balance_after, idempotency_key, metadata)
  values (p_user_id, p_type, p_amount, p_balance_after, p_key, p_meta);
end;
$$ language plpgsql security definer;

-- rpc_starter_grant: 80.000đ ONCE (v2.2, supersedes v2.1: 50.000đ). A second call returns ALREADY_GRANTED
-- (checked via the existing starter_grant log row, so even a fresh
-- idempotency key cannot grant twice).
create or replace function public.rpc_starter_grant(
  p_user_id uuid, p_idempotency_key uuid
) returns jsonb as $$
declare
  v_cash bigint;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if current_user not in ('postgres', 'service_role') then
    if v_uid is null then
      return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
    end if;
    if p_user_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
    end if;
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  -- idempotency: same key twice -> return the previous result, no re-grant
  if exists (select 1 from public.transaction_logs
             where idempotency_key = p_idempotency_key) then
    select cash into v_cash from public.profiles where user_id = p_user_id;
    return jsonb_build_object('ok', false, 'error', 'ALREADY_PROCESSED', 'cash', coalesce(v_cash, 0));
  end if;
  -- lock the profile row for the whole transaction (prevents double-grant races)
  insert into public.profiles (user_id, cash, bank)
    values (p_user_id, 0, 0)
    on conflict (user_id) do nothing;
  select cash into v_cash from public.profiles where user_id = p_user_id for update;
  if exists (select 1 from public.transaction_logs
             where user_id = p_user_id and type = 'starter_grant') then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_GRANTED', 'cash', v_cash);
  end if;
  update public.profiles set cash = cash + 80000 where user_id = p_user_id;
  perform public._log_tx(p_user_id, 'starter_grant', 80000, v_cash + 80000,
    p_idempotency_key, '{"once": true}'::jsonb);
  return jsonb_build_object('ok', true, 'cash', v_cash + 80000, 'bank', 0);
end;
$$ language plpgsql security definer;

-- rpc_shop_buy: buy qty of an item at the server price (day price 06:00–18:00
-- game time is decided by the CALLER passing p_is_day; the client passes
-- its worldTime-derived value and the server re-checks it in production).
create or replace function public.rpc_shop_buy(
  p_user_id uuid, p_item_id text, p_qty integer, p_idempotency_key uuid,
  p_is_day boolean default true
) returns jsonb as $$
declare
  v_price bigint; v_total bigint; v_cash bigint; v_bank bigint;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if current_user not in ('postgres', 'service_role') then
    if v_uid is null then
      return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
    end if;
    if p_user_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
    end if;
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  if p_qty < 1 or p_qty > 99 then
    return jsonb_build_object('ok', false, 'error', 'BAD_QTY');
  end if;
  if exists (select 1 from public.transaction_logs
             where idempotency_key = p_idempotency_key) then
    select cash, bank into v_cash, v_bank from public.profiles where user_id = p_user_id;
    return jsonb_build_object('ok', false, 'error', 'ALREADY_PROCESSED', 'cash', coalesce(v_cash, 0), 'bank', coalesce(v_bank, 0));
  end if;
  select price, day_price into v_price, v_total from public.game_items
    where item_id = p_item_id and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ITEM_NOT_FOUND');
  end if;
  -- v_total reused as day_price holder; pick the real unit price
  if p_is_day and v_total is not null then v_price := v_total; end if;
  v_total := v_price * p_qty;
  select cash, bank into v_cash, v_bank from public.profiles
    where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_PROFILE');
  end if;
  if v_cash < v_total then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_FUNDS', 'need', v_total, 'cash', v_cash);
  end if;
  update public.profiles set cash = cash - v_total where user_id = p_user_id;
  insert into public.inventory (user_id, item_id, qty)
    values (p_user_id, p_item_id, p_qty)
    on conflict (user_id, item_id) do update set qty = public.inventory.qty + p_qty;
  perform public._log_tx(p_user_id, 'shop_buy', -v_total, v_cash - v_total,
    p_idempotency_key,
    jsonb_build_object('item_id', p_item_id, 'qty', p_qty, 'unit_price', v_price));
  return jsonb_build_object('ok', true, 'cash', v_cash - v_total, 'bank', v_bank,
    'item_id', p_item_id, 'qty', p_qty, 'total', v_total);
end;
$$ language plpgsql security definer;

-- rpc_atm_transfer: deposit (cash -> bank) or withdraw (bank -> cash).
-- Limits (SRS §4.5): 1.000–200.000đ per transaction, max 500.000đ/day.
-- The daily total is summed from today's atm log rows (append-only = truth).
create or replace function public.rpc_atm_transfer(
  p_user_id uuid, p_action text, p_amount bigint, p_idempotency_key uuid
) returns jsonb as $$
declare
  v_cash bigint; v_bank bigint; v_day_total bigint;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if current_user not in ('postgres', 'service_role') then
    if v_uid is null then
      return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
    end if;
    if p_user_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
    end if;
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  if p_action not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'BAD_ACTION');
  end if;
  if p_amount < 1000 or p_amount > 200000 then
    return jsonb_build_object('ok', false, 'error', 'AMOUNT_RANGE', 'min', 1000, 'max', 200000);
  end if;
  if exists (select 1 from public.transaction_logs
             where idempotency_key = p_idempotency_key) then
    select cash, bank into v_cash, v_bank from public.profiles where user_id = p_user_id;
    return jsonb_build_object('ok', false, 'error', 'ALREADY_PROCESSED', 'cash', coalesce(v_cash, 0), 'bank', coalesce(v_bank, 0));
  end if;
  select coalesce(sum(abs(amount)), 0) into v_day_total
    from public.transaction_logs
    where user_id = p_user_id and type = 'atm'
      and created_at >= date_trunc('day', now());
  if v_day_total + p_amount > 500000 then
    return jsonb_build_object('ok', false, 'error', 'DAILY_LIMIT', 'dayMax', 500000, 'used', v_day_total);
  end if;
  select cash, bank into v_cash, v_bank from public.profiles
    where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_PROFILE');
  end if;
  if p_action = 'deposit' then
    if v_cash < p_amount then
      return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_FUNDS');
    end if;
    update public.profiles set cash = cash - p_amount, bank = bank + p_amount
      where user_id = p_user_id;
    perform public._log_tx(p_user_id, 'atm', -p_amount, v_cash - p_amount,
      p_idempotency_key, jsonb_build_object('action', 'deposit'));
    return jsonb_build_object('ok', true, 'cash', v_cash - p_amount, 'bank', v_bank + p_amount, 'dayUsed', v_day_total + p_amount);
  else
    if v_bank < p_amount then
      return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_FUNDS');
    end if;
    update public.profiles set cash = cash + p_amount, bank = bank - p_amount
      where user_id = p_user_id;
    perform public._log_tx(p_user_id, 'atm', p_amount, v_cash + p_amount,
      p_idempotency_key, jsonb_build_object('action', 'withdraw'));
    return jsonb_build_object('ok', true, 'cash', v_cash + p_amount, 'bank', v_bank - p_amount, 'dayUsed', v_day_total + p_amount);
  end if;
end;
$$ language plpgsql security definer;

-- Restrict RPC execution: internal _log_tx is server/postgres only;
-- player RPCs cannot be invoked anonymously.
revoke all on function public._log_tx(uuid, text, bigint, bigint, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_starter_grant(uuid, uuid) from public, anon;
grant execute on function public.rpc_starter_grant(uuid, uuid) to authenticated, service_role;
revoke all on function public.rpc_shop_buy(uuid, text, integer, uuid, boolean) from public, anon;
grant execute on function public.rpc_shop_buy(uuid, text, integer, uuid, boolean) to authenticated, service_role;
revoke all on function public.rpc_atm_transfer(uuid, text, bigint, uuid) from public, anon;
grant execute on function public.rpc_atm_transfer(uuid, text, bigint, uuid) to authenticated, service_role;
