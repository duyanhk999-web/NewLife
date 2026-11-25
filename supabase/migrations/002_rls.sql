-- Đô Thị Ảo — M2 migration 002 (SRS v2.1 §5.6)
-- RLS: the client can NEVER change money directly. All money changes go
-- through the server-side RPCs (003_rpc.sql, SECURITY DEFINER) which run
-- with the service_role key. The client (anon key) can only:
--   * read its OWN profile / inventory / assets / tx log / jobs / missions
--   * update its own display_name / avatar_key (never cash/bank)
--   * NEVER insert into transaction_logs or assets directly.
alter table public.profiles enable row level security;
alter table public.inventory enable row level security;
alter table public.assets enable row level security;
alter table public.transaction_logs enable row level security;
alter table public.player_jobs enable row level security;
alter table public.player_missions enable row level security;
alter table public.player_sessions enable row level security;
alter table public.game_items enable row level security;

-- profiles: read own, update own (display_name/avatar_key only — enforced
-- by the trigger below, which reverts any cash/bank change from a client).
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trigger: block any client-side cash/bank/level/exp change. Only the
-- SECURITY DEFINER RPCs may change money. Inside a SECURITY DEFINER
-- function, current_user is the FUNCTION OWNER (postgres, who runs these
-- migrations) — NOT service_role — so the trigger must allow both.
-- A direct client UPDATE (anon/authenticated role) is rejected.
create or replace function public.block_client_money_update() returns trigger as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if new.cash is distinct from old.cash or new.bank is distinct from old.bank
       or new.level is distinct from old.level or new.exp is distinct from old.exp then
      raise exception 'MONEY_READONLY: cash/bank/level/exp can only change via server RPC';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_block_client_money on public.profiles;
create trigger trg_block_client_money before update on public.profiles
  for each row execute function public.block_client_money_update();

-- inventory / assets / tx log / jobs / missions / sessions: read own only,
-- no client writes at all (server RPCs write with service_role).
drop policy if exists "inventory_select_own" on public.inventory;
create policy "inventory_select_own" on public.inventory
  for select using (auth.uid() = user_id);
drop policy if exists "assets_select_own" on public.assets;
create policy "assets_select_own" on public.assets
  for select using (auth.uid() = user_id);
drop policy if exists "tx_select_own" on public.transaction_logs;
create policy "tx_select_own" on public.transaction_logs
  for select using (auth.uid() = user_id);
drop policy if exists "jobs_select_own" on public.player_jobs;
create policy "jobs_select_own" on public.player_jobs
  for select using (auth.uid() = user_id);
drop policy if exists "missions_select_own" on public.player_missions;
create policy "missions_select_own" on public.player_missions
  for select using (auth.uid() = user_id);
drop policy if exists "sessions_select_own" on public.player_sessions;
create policy "sessions_select_own" on public.player_sessions
  for select using (auth.uid() = user_id);

-- game_items: public read (price list), no client writes.
drop policy if exists "items_select_all" on public.game_items;
create policy "items_select_all" on public.game_items
  for select using (is_active = true);
