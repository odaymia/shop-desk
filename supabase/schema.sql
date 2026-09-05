-- Shared cloud schema for the Shop Time Clock and the Shop Desk. Both apps
-- use the same Supabase project and the same tables. This file must stay
-- identical to supabase/schema.sql in the time clock repo. Run it once.
-- Multi-shop from the start: every row carries a shop_id, and row-level
-- security only lets a shop's members see that shop's rows.

create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists shop_members (
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'manager',
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

-- Everything that isn't a punch: config, roster, schedules, attestations.
create table if not exists kv (
  shop_id uuid not null references shops(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (shop_id, key)
);

-- One row per punch event. Append-only in spirit: deletes are tombstones
-- so every device converges on the same log.
create table if not exists punches (
  shop_id uuid not null references shops(id) on delete cascade,
  id text not null,
  emp_id text not null,
  type text not null,
  ts bigint not null,
  month text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (shop_id, id)
);

create index if not exists kv_shop_updated on kv (shop_id, updated_at);
create index if not exists punches_shop_updated on punches (shop_id, updated_at);
create index if not exists punches_shop_month on punches (shop_id, month);

-- updated_at is what sync uses to ask "what changed since I last looked",
-- so the server sets it, never the client.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists kv_touch on kv;
create trigger kv_touch before insert or update on kv
  for each row execute function touch_updated_at();
drop trigger if exists punches_touch on punches;
create trigger punches_touch before insert or update on punches
  for each row execute function touch_updated_at();

-- Membership check used by every policy.
create or replace function is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from shop_members where shop_id = sid and user_id = auth.uid()
  );
$$;

-- Creating a shop and joining it happen together, so nobody can insert
-- themselves into someone else's shop.
create or replace function create_shop(shop_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into shops (name) values (shop_name) returning id into sid;
  insert into shop_members (shop_id, user_id, role) values (sid, auth.uid(), 'manager');
  return sid;
end $$;

alter table shops enable row level security;
alter table shop_members enable row level security;
alter table kv enable row level security;
alter table punches enable row level security;

drop policy if exists "members read shops" on shops;
create policy "members read shops" on shops
  for select using (is_member(id));
drop policy if exists "members update shops" on shops;
create policy "members update shops" on shops
  for update using (is_member(id)) with check (is_member(id));

drop policy if exists "members read membership" on shop_members;
create policy "members read membership" on shop_members
  for select using (user_id = auth.uid() or is_member(shop_id));

drop policy if exists "members rw kv" on kv;
create policy "members rw kv" on kv
  for all using (is_member(shop_id)) with check (is_member(shop_id));

drop policy if exists "members rw punches" on punches;
create policy "members rw punches" on punches
  for all using (is_member(shop_id)) with check (is_member(shop_id));

-- Punch photos and signatures live in Storage, under <shop_id>/...
insert into storage.buckets (id, name, public)
  values ('media', 'media', false)
  on conflict (id) do nothing;

drop policy if exists "members rw media" on storage.objects;
create policy "members rw media" on storage.objects
  for all
  using (bucket_id = 'media' and is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'media' and is_member(((storage.foldername(name))[1])::uuid));

-- Live updates: a punch on the iPad shows up on the manager's screen right away.
do $$
begin
  alter publication supabase_realtime add table punches;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table kv;
exception when duplicate_object then null;
end $$;
