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
--   email_clicks        which links each person clicked
--   email_webhook_seen  ids of the mail service's notices already counted
--
-- How an email went (delivered, opened, clicked, bounced, marked as spam)
-- arrives from Resend as webhooks to the same function, which records each
-- one through email_event() below.

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

-- what happened to each email after it left, as the mail service reports it
alter table email_outbox add column if not exists delivered_at timestamptz;
alter table email_outbox add column if not exists opened_at timestamptz;      -- first open
alter table email_outbox add column if not exists open_count int not null default 0;
alter table email_outbox add column if not exists clicked_at timestamptz;     -- first click
alter table email_outbox add column if not exists click_count int not null default 0;
alter table email_outbox add column if not exists bounced_at timestamptz;
alter table email_outbox add column if not exists bounce_type text;           -- Permanent | Transient | ...
alter table email_outbox add column if not exists complained_at timestamptz;  -- marked as spam
create index if not exists email_outbox_provider on email_outbox (provider_id) where provider_id is not null;

create table if not exists email_clicks (
  outbox_id bigint not null references email_outbox(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  message_id uuid not null references email_messages(id) on delete cascade,
  url text not null,
  n int not null default 1,
  first_at timestamptz not null default now(),
  primary key (outbox_id, url)
);
create index if not exists email_clicks_message on email_clicks (message_id);

-- the mail service sends each notice at least once; remember the ones counted
create table if not exists email_webhook_seen (
  id text primary key,
  at timestamptz not null default now()
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
alter table email_clicks enable row level security;
alter table email_webhook_seen enable row level security; -- no policies: the function only
drop policy if exists "members read email clicks" on email_clicks;
create policy "members read email clicks" on email_clicks
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

-- Record one notice from the mail service about an email we sent.
--   p_type: delivered | opened | clicked | bounced | complained
-- Returns 'ok', 'duplicate' (this notice was already counted), or 'unknown'
-- (not an email in the outbox: a test send, or one whose id isn't saved yet).
-- A hard bounce or a spam complaint also puts the address on the
-- never-email-again list.
create or replace function email_event(p_event_id text, p_provider_id text, p_type text, p_at timestamptz, p_url text default null, p_detail text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  o email_outbox%rowtype;
  t timestamptz := coalesce(p_at, now());
begin
  select * into o from email_outbox where provider_id = p_provider_id limit 1;
  if not found then return 'unknown'; end if;
  if coalesce(p_event_id, '') <> '' then
    insert into email_webhook_seen (id) values (p_event_id) on conflict do nothing;
    if not found then return 'duplicate'; end if;
    if random() < 0.01 then delete from email_webhook_seen where at < now() - interval '14 days'; end if;
  end if;

  if p_type = 'delivered' then
    update email_outbox set delivered_at = coalesce(delivered_at, t) where id = o.id;
  elsif p_type = 'opened' then
    update email_outbox set opened_at = coalesce(opened_at, t), open_count = open_count + 1, delivered_at = coalesce(delivered_at, t) where id = o.id;
  elsif p_type = 'clicked' then
    -- a click is proof it was opened, even when the mail app hid the open
    update email_outbox set clicked_at = coalesce(clicked_at, t), click_count = click_count + 1, opened_at = coalesce(opened_at, t), delivered_at = coalesce(delivered_at, t) where id = o.id;
    if coalesce(p_url, '') <> '' then
      insert into email_clicks (outbox_id, shop_id, message_id, url, first_at) values (o.id, o.shop_id, o.message_id, left(p_url, 2000), t)
      on conflict (outbox_id, url) do update set n = email_clicks.n + 1;
    end if;
  elsif p_type = 'bounced' then
    update email_outbox set bounced_at = coalesce(bounced_at, t), bounce_type = left(coalesce(p_detail, ''), 80) where id = o.id;
    if lower(coalesce(p_detail, 'permanent')) like 'permanent%' then
      insert into email_suppressions (shop_id, email, reason) values (o.shop_id, lower(o.email), 'bounced') on conflict do nothing;
    end if;
  elsif p_type = 'complained' then
    update email_outbox set complained_at = coalesce(complained_at, t) where id = o.id;
    insert into email_suppressions (shop_id, email, reason) values (o.shop_id, lower(o.email), 'complained')
    on conflict (shop_id, email) do update set reason = 'complained';
    update site_signups set unsubscribed_at = now() where shop_id = o.shop_id and lower(email) = lower(o.email) and unsubscribed_at is null;
  end if;
  return 'ok';
end;
$$;
revoke all on function email_event(text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function email_event(text, text, text, timestamptz, text, text) to service_role;

-- How each email went, for the desk's list: people reached, per message.
create or replace function email_message_stats(p_shop uuid)
returns table (message_id uuid, delivered bigint, opened bigint, clicked bigint, bounced bigint, complained bigint)
language sql stable security invoker set search_path = public as $$
  select message_id, count(delivered_at), count(opened_at), count(clicked_at), count(bounced_at), count(complained_at)
  from email_outbox where shop_id = p_shop and status = 'sent' group by 1;
$$;
