-- Big Two rooms table for Supabase.
-- Run this only if your Supabase project does not already have the rooms table.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_uid text,
  seats jsonb default '[null,null,null,null]'::jsonb,
  spectators jsonb default '[]'::jsonb,
  playing boolean default false,
  scores jsonb default '[0,0,0,0]'::jsonb,
  deal integer default 1,
  state jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

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

alter table public.rooms enable row level security;

drop policy if exists "rooms read" on public.rooms;
drop policy if exists "rooms insert" on public.rooms;
drop policy if exists "rooms update" on public.rooms;
drop policy if exists "rooms delete" on public.rooms;

create policy "rooms read" on public.rooms for select using (true);
create policy "rooms insert" on public.rooms for insert with check (true);
create policy "rooms update" on public.rooms for update using (true) with check (true);
create policy "rooms delete" on public.rooms for delete using (true);

-- Enable Realtime for the rooms table.
-- If this line errors because it is already added, you can ignore the error.
alter publication supabase_realtime add table public.rooms;
