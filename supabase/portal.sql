-- Customer portal. Paste into the Supabase SQL editor and run once, after
-- schema.sql. The desk publishes one row per customer (their vehicles,
-- history, and what's due) and one row per shop (name, phone, price
-- menu). A customer signs in with a magic link to their email and can
-- read only the rows whose email matches their login. Nothing else in
-- the database is visible to them.

create table if not exists customer_portal (
  shop_id uuid not null references shops(id) on delete cascade,
  customer_id text not null,
  email text,                -- lowercased; this is what the customer logs in with
  phone text,                -- digits only; for text-message login later
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (shop_id, customer_id)
);
create index if not exists customer_portal_email on customer_portal (lower(email));

create table if not exists shop_public (
  shop_id uuid primary key references shops(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists customer_portal_touch on customer_portal;
create trigger customer_portal_touch before insert or update on customer_portal
  for each row execute function touch_updated_at();
drop trigger if exists shop_public_touch on shop_public;
create trigger shop_public_touch before insert or update on shop_public
  for each row execute function touch_updated_at();

alter table customer_portal enable row level security;
alter table shop_public enable row level security;

-- the shop's own staff read and write everything for their shop
drop policy if exists "members rw portal" on customer_portal;
create policy "members rw portal" on customer_portal
  for all using (is_member(shop_id)) with check (is_member(shop_id));
drop policy if exists "members rw shop_public" on shop_public;
create policy "members rw shop_public" on shop_public
  for all using (is_member(shop_id)) with check (is_member(shop_id));

-- a signed-in customer reads only rows carrying their own email
drop policy if exists "customer reads own" on customer_portal;
create policy "customer reads own" on customer_portal
  for select using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- any signed-in person can read a shop's public card (name, phone, menu)
drop policy if exists "signed in read shop_public" on shop_public;
create policy "signed in read shop_public" on shop_public
  for select using (auth.uid() is not null);
