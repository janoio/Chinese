-- ============================================================================
-- Big Two — Supabase schema
-- Run this in the Supabase SQL editor to create the table the game uses for
-- online multiplayer. Online play is optional; the game also runs fully local
-- against bots with no backend at all.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  host_uid    text,
  seats       jsonb   default '[null,null,null,null]'::jsonb,
  spectators  jsonb   default '[]'::jsonb,
  playing     boolean default false,
  scores      jsonb   default '[0,0,0,0]'::jsonb,
  deal        integer default 1,
  state       jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- The lobby lists the most recent tables, so index the sort column.
create index if not exists rooms_created_at_idx on public.rooms (created_at desc);

-- Keep updated_at fresh on every write.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- These policies are intentionally OPEN (anyone with the anon key can read and
-- write any room). That is fine for a casual game played among friends, and it
-- lets the app work without user accounts. It does mean a malicious client
-- could tamper with or delete rooms. If you later add Supabase Auth, tighten
-- these to scope writes to the room's participants.
alter table public.rooms enable row level security;

drop policy if exists "rooms read"   on public.rooms;
drop policy if exists "rooms insert" on public.rooms;
drop policy if exists "rooms update" on public.rooms;
drop policy if exists "rooms delete" on public.rooms;

create policy "rooms read"   on public.rooms for select using (true);
create policy "rooms insert" on public.rooms for insert with check (true);
create policy "rooms update" on public.rooms for update using (true) with check (true);
create policy "rooms delete" on public.rooms for delete using (true);

-- Enable Supabase Realtime so clients get live updates. If this errors because
-- the table is already in the publication, you can safely ignore it.
alter publication supabase_realtime add table public.rooms;

-- Optional housekeeping: run occasionally (or as a scheduled job) to clear out
-- stale tables so the lobby stays clean.
--   delete from public.rooms where updated_at < now() - interval '12 hours';
