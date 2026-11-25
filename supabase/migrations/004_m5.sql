-- Cuộc Sống Ảo — M5 migration 004: Full player state & asset metadata persistence.
-- Extends profiles (job, survival stats, last world position) and assets (jsonb
-- metadata for vehicle fuel/durability/parked coords and motel expiresAt/chest).

alter table public.profiles
  add column if not exists job text not null default 'unemployed',
  add column if not exists hp integer not null default 100 check (hp >= 0 and hp <= 100),
  add column if not exists hunger integer not null default 100 check (hunger >= 0 and hunger <= 100),
  add column if not exists stamina integer not null default 100 check (stamina >= 0 and stamina <= 100),
  add column if not exists x double precision not null default 2400,
  add column if not exists y double precision not null default 2625;

alter table public.assets
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Keep client-side direct updates from altering job/survival stats directly if desired;
-- display_name and avatar_key remain editable by the owner.
create or replace function public.block_client_money_update() returns trigger as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if new.cash is distinct from old.cash or new.bank is distinct from old.bank
       or new.level is distinct from old.level or new.exp is distinct from old.exp
       or new.job is distinct from old.job or new.hp is distinct from old.hp
       or new.hunger is distinct from old.hunger or new.stamina is distinct from old.stamina then
      raise exception 'MONEY_READONLY: player stats can only change via server';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
