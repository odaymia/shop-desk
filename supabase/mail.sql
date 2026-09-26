-- Postcards: oil change reminder cards printed and mailed by Lob through the
-- "mail" Edge Function (supabase/functions/mail). Paste into the Supabase
-- SQL editor and run once, after schema.sql. Safe to run again.
--
--   mail_keys   one row per reminder already mailed (a car's oil change), so
--               nobody is mailed the same reminder twice, even if two
--               computers approve the same batch
--   mail_sends  one row per card: who, where, Lob's id, expected delivery

create table if not exists mail_keys (
  shop_id uuid not null references shops(id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, key)
);

create table if not exists mail_sends (
  id bigint generated always as identity primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  batch_id text,
  customer_id text,
  name text,
  address jsonb,
  keys text[] not null default '{}',
  status text not null check (status in ('mailed', 'failed')),
  lob_id text,
  expected_delivery date,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists mail_sends_shop on mail_sends (shop_id, created_at desc);

alter table mail_keys enable row level security;
alter table mail_sends enable row level security;

-- staff read what went out; only the function (service role) records it
drop policy if exists "members read mail keys" on mail_keys;
create policy "members read mail keys" on mail_keys for select using (is_member(shop_id));
drop policy if exists "members read mail sends" on mail_sends;
create policy "members read mail sends" on mail_sends for select using (is_member(shop_id));
