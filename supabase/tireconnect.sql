-- TireConnect two-way sync: online tire orders and quotes flow in as
-- webhooks, land in a desk inbox, and become tickets.
--
-- Run this once in the Supabase SQL editor (it is safe to re-run). It needs
-- the shops/is_member() setup from schema.sql.
--
-- Two tables:
--   tire_connect  one row per shop, holds that shop's webhook signing secret
--                 (members only — never public). The Edge Function reads it
--                 with the service-role key to verify incoming webhooks.
--   tire_orders   one row per TireConnect order/quote the webhook delivers.
--                 Only the webhook (service role) inserts; staff read and mark
--                 them handled. Nothing is deleted.

create table if not exists tire_connect (
  shop_id uuid primary key references shops(id) on delete cascade,
  webhook_secret text check (length(webhook_secret) <= 400),
  updated_at timestamptz not null default now()
);

alter table tire_connect enable row level security;

drop policy if exists "members rw tire_connect" on tire_connect;
create policy "members rw tire_connect" on tire_connect
  for all using (is_member(shop_id)) with check (is_member(shop_id));

create table if not exists tire_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  event text not null check (length(event) <= 60),      -- e.g. order.checked_out, lead.quote
  tc_uuid text check (length(tc_uuid) <= 80),            -- TireConnect's own order/quote id, for dedup
  customer_name text check (length(customer_name) <= 120),
  customer_phone text check (length(customer_phone) <= 40),
  customer_email text check (length(customer_email) <= 160),
  vehicle text check (length(vehicle) <= 120),
  summary text check (length(summary) <= 400),           -- "4× Bridgestone Dueler 235/45R19" for the list
  total numeric(12, 2),
  quote jsonb not null default '{}'::jsonb,               -- the tires/services/discounts the desk maps to lines
  raw jsonb,                                              -- the untouched webhook body, for reference
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  order_id text check (length(order_id) <= 60)            -- the ticket it became, once built
);
create index if not exists tire_orders_shop on tire_orders (shop_id, handled_at, created_at);
-- one row per TireConnect order/quote: a repeated webhook (status change,
-- retry) updates the same row instead of piling up duplicates. A full
-- (non-partial) unique index so upsert's ON CONFLICT can target it; rows
-- with no tc_uuid are all distinct (Postgres treats NULLs as unequal), so
-- they simply insert each time.
create unique index if not exists tire_orders_dedup on tire_orders (shop_id, event, tc_uuid);

alter table tire_orders enable row level security;

-- staff read their shop's orders and mark them handled; inserts come from the
-- Edge Function on the service-role key, which bypasses RLS
drop policy if exists "members rw tire_orders" on tire_orders;
create policy "members rw tire_orders" on tire_orders
  for all using (is_member(shop_id)) with check (is_member(shop_id));
