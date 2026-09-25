-- Shop website. Paste into the Supabase SQL editor and run once, after
-- schema.sql. The desk publishes one row per shop (the page's content,
-- built from its settings, prices and chosen coupons); anyone on the
-- internet can read a published row — that's the point of a website — and
-- nothing else. Visitors can send an appointment request but can't read
-- anyone's requests back; the shop's staff see and handle them.

create table if not exists shop_site (
  shop_id uuid primary key references shops(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  published boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists shop_site_touch on shop_site;
create trigger shop_site_touch before insert or update on shop_site
  for each row execute function touch_updated_at();

alter table shop_site enable row level security;

drop policy if exists "members rw site" on shop_site;
create policy "members rw site" on shop_site
  for all using (is_member(shop_id)) with check (is_member(shop_id));

drop policy if exists "public reads published site" on shop_site;
create policy "public reads published site" on shop_site
  for select to anon, authenticated using (published);

create table if not exists site_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  phone text check (length(phone) <= 20),
  email text check (length(email) <= 120),
  vehicle text check (length(vehicle) <= 80),
  service text check (length(service) <= 80),
  preferred_day date,
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index if not exists site_requests_shop on site_requests (shop_id, handled_at);

alter table site_requests enable row level security;

drop policy if exists "members rw site requests" on site_requests;
create policy "members rw site requests" on site_requests
  for all using (is_member(shop_id)) with check (is_member(shop_id));

-- a visitor may add a request, only to a shop whose site is published,
-- and never marked as already handled
drop policy if exists "public adds site request" on site_requests;
create policy "public adds site request" on site_requests
  for insert to anon, authenticated
  with check (handled_at is null and exists (select 1 from shop_site s where s.shop_id = site_requests.shop_id and s.published));
