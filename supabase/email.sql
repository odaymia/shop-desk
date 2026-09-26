-- Email: campaigns and automatic emails, sent through the "email" Edge
-- Function (supabase/functions/email). Paste into the Supabase SQL editor
-- and run once, after schema.sql and website.sql. Safe to run again.
--
--   email_messages      one row per email written (a campaign, or one day's
--                       copy of an automation); the HTML has placeholders
--                       ({first_name}, {unsubscribe_url}) filled per person
--   email_outbox        one row per person to send to; the function sends
--                       what's due, a batch at a time, within the shop's
--                       daily limit, and records how it went
--   email_suppressions  addresses that must never get marketing email again
--                       (unsubscribed, bounced, marked as spam)

create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  kind text not null default 'campaign',     -- campaign | thanks | oil | winback | welcome | test
  name text,                                  -- the campaign's name in the desk
  subject text not null check (length(subject) between 1 and 200),
  html text not null,
  text_body text,
  audience jsonb,                             -- the filters a campaign was sent to, for the record
  created_at timestamptz not null default now()
);
create index if not exists email_messages_shop on email_messages (shop_id, created_at desc);

create table if not exists email_outbox (
  id bigint generated always as identity primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  message_id uuid not null references email_messages(id) on delete cascade,
  email text not null,
  vars jsonb not null default '{}'::jsonb,    -- { first_name, vehicle, due_date }
  dedupe text,                                -- automations: never the same email twice
  send_after timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,                     -- when a send picked it up; a stuck one is retried after 15 minutes
  sent_at timestamptz
);
alter table email_outbox add column if not exists claimed_at timestamptz;
create unique index if not exists email_outbox_dedupe on email_outbox (shop_id, dedupe) where dedupe is not null;
create index if not exists email_outbox_due on email_outbox (status, send_after);
create index if not exists email_outbox_message on email_outbox (message_id, status);
create index if not exists email_outbox_sent_today on email_outbox (shop_id, sent_at);

create table if not exists email_suppressions (
  shop_id uuid not null references shops(id) on delete cascade,
  email text not null,                        -- lowercased
  reason text not null default 'unsubscribed', -- unsubscribed | bounced | complained | manual
  created_at timestamptz not null default now(),
  primary key (shop_id, email)
);

alter table email_messages enable row level security;
alter table email_outbox enable row level security;
alter table email_suppressions enable row level security;

-- the shop's staff write emails and read how they went; only the function
-- (service role) queues and sends, so its checks can't be skipped
drop policy if exists "members rw email messages" on email_messages;
create policy "members rw email messages" on email_messages
  for all using (is_member(shop_id)) with check (is_member(shop_id));
drop policy if exists "members read email outbox" on email_outbox;
create policy "members read email outbox" on email_outbox
  for select using (is_member(shop_id));
drop policy if exists "members rw email suppressions" on email_suppressions;
create policy "members rw email suppressions" on email_suppressions
  for all using (is_member(shop_id)) with check (is_member(shop_id));

-- Hand the function a batch to send for one shop, locking the rows so two
-- runs at once never send the same email twice.
create or replace function email_claim(p_shop uuid, p_limit int)
returns setof email_outbox
language sql security definer set search_path = public as $$
  update email_outbox o set status = 'sending', claimed_at = now()
  where o.id in (
    select id from email_outbox
    where shop_id = p_shop and status = 'queued' and send_after <= now()
    order by send_after, id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning o.*;
$$;
revoke all on function email_claim(uuid, int) from public, anon, authenticated;
grant execute on function email_claim(uuid, int) to service_role;

-- How a campaign went, for the desk's list: counts by status per message.
create or replace function email_message_counts(p_shop uuid)
returns table (message_id uuid, status text, n bigint)
language sql stable security invoker set search_path = public as $$
  select message_id, status, count(*) from email_outbox where shop_id = p_shop group by 1, 2;
$$;
