-- Cuộc Sống Ảo — M5 migration 005: Explicit schema & table grants.
-- When migrations run via raw Postgres connection (postgres role), newly created
-- tables in public do not automatically inherit PostgREST grants unless granted
-- explicitly to service_role, authenticated, and anon.

grant usage on schema public to anon, authenticated, service_role;

-- Backend admin client (SUPABASE_SECRET_KEY -> service_role) gets full access
-- to all game tables without touching extension objects.
grant all privileges on table
  public.profiles,
  public.inventory,
  public.assets,
  public.transaction_logs,
  public.player_jobs,
  public.player_missions,
  public.player_sessions,
  public.game_items,
  public._schema_migrations
to service_role;

grant execute on function public._log_tx(uuid, text, bigint, bigint, uuid, jsonb) to service_role;
grant execute on function public.rpc_starter_grant(uuid, uuid) to authenticated, service_role;
grant execute on function public.rpc_shop_buy(uuid, text, integer, uuid, boolean) to authenticated, service_role;
grant execute on function public.rpc_atm_transfer(uuid, text, bigint, uuid) to authenticated, service_role;

-- Client-facing tables (row access & column writes remain enforced by RLS + triggers).
grant select on public.game_items to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on
  public.inventory,
  public.assets,
  public.transaction_logs,
  public.player_jobs,
  public.player_missions,
  public.player_sessions
to authenticated;

-- Keep internal migration tracker private to postgres / service_role.
alter table if exists public._schema_migrations enable row level security;
revoke all on table public._schema_migrations from public, anon, authenticated;
