-- Customer requests from the portal ("that's not my car", "I sold it").
-- Run once in the Supabase SQL editor, after portal.sql.
-- A customer can add a request under their own email and see their own;
-- the shop's staff see and handle every request for their shop.

create table if not exists portal_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  customer_id text not null,
  email text not null,
  vehicle_id text,
  kind text not null,          -- not_mine | sold | other
  note text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index if not exists portal_requests_shop on portal_requests (shop_id, handled_at);
create index if not exists portal_requests_email on portal_requests (lower(email));

alter table portal_requests enable row level security;

drop policy if exists "members rw requests" on portal_requests;
create policy "members rw requests" on portal_requests
  for all using (is_member(shop_id)) with check (is_member(shop_id));

drop policy if exists "customer adds own request" on portal_requests;
create policy "customer adds own request" on portal_requests
  for insert with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "customer reads own requests" on portal_requests;
create policy "customer reads own requests" on portal_requests
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
