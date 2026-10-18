-- CoreConnect v1 foundation: 14 core tables, 6 supporting tables, row-level security.
--
-- Tenancy rules (see Technical Requirements v1, "Users, roles and tenancy"):
--   * Every tenant table carries workspace_id and is protected by RLS.
--   * Cross-table references inside a tenant use composite foreign keys on
--     (workspace_id, id), so a row in workspace A can never point at a row in B.
--   * The app reaches the database either as the logged-in user (role
--     `authenticated`, claims set per transaction, RLS applies) or from webhook
--     and job code as the table owner (RLS bypassed). The browser never gets a
--     service-role credential.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- uuid v7 (time-ordered). Postgres 18 ships uuidv7(); Supabase is on 15/17.
-- Takes a random v4 uuid, overwrites the first 48 bits with the unix time in
-- milliseconds, and flips the version nibble from 4 (0100) to 7 (0111).
create or replace function app.uuid_v7() returns uuid
language sql volatile
as $$
  select encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
              from 1 for 6),
      52, 1), 53, 1),
    'hex')::uuid;
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workspaces, users, memberships
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id                          uuid primary key default app.uuid_v7(),
  name                        text not null check (length(name) between 1 and 120),
  slug                        text not null unique
                                check (slug ~ '^[a-z0-9](-?[a-z0-9])*$' and length(slug) between 3 and 40),
  business_type               text not null check (business_type in ('breeder', 'service')),
  logo_url                    text,
  brand_color                 text check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  timezone                    text not null default 'America/Chicago',
  digest_time                 time not null default '07:00',
  sms_enabled                 boolean not null default false,
  stripe_account_id           text,
  deposit_amount_cents        integer check (deposit_amount_cents >= 0),
  deposit_terms               text,
  physical_address            text,
  sms_number_e164             text check (sms_number_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  twilio_messaging_service_sid text,
  sending_domain              text,
  sending_domain_verified_at  timestamptz,
  faq                         text,
  billing_status              text not null default 'active'
                                check (billing_status in ('active', 'past_due', 'read_only')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Profile row for each Supabase Auth user. Auth itself lives in auth.users.
create table public.users (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  name               text,
  phone              text,
  is_platform_admin  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- role 'support' is the platform admin's time-limited impersonation access.
create table public.memberships (
  id            uuid primary key default app.uuid_v7(),
  user_id       uuid not null references public.users (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  role          text not null check (role in ('owner', 'staff', 'support')),
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, workspace_id),
  check ((role = 'support') = (expires_at is not null))
);
create index memberships_workspace_idx on public.memberships (workspace_id);

-- Copy new auth users into public.users.
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.users (id, email, name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- Workspaces the current user can act in. SECURITY DEFINER so policies can call
-- it without recursing through the memberships policy.
create or replace function app.my_workspace_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.workspace_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and (m.expires_at is null or m.expires_at > now());
$$;

-- Workspaces where the current user has owner rights (owners, and support
-- sessions acting on the owner's behalf).
create or replace function app.my_admin_workspace_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.workspace_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.role in ('owner', 'support')
    and (m.expires_at is null or m.expires_at > now());
$$;

-- ---------------------------------------------------------------------------
-- Core tenant tables
-- ---------------------------------------------------------------------------

create table public.contacts (
  id                     uuid primary key default app.uuid_v7(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  first_name             text,
  last_name              text,
  email_norm             text check (email_norm = lower(email_norm)),
  phone_e164             text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  city                   text,
  state                  text,
  timezone               text,              -- null = use the workspace's
  sms_consent_at         timestamptz,
  sms_consent_text       text,
  sms_consent_source     text,              -- form id or staff user id
  email_unsubscribed_at  timestamptz,
  do_not_contact         boolean not null default false,
  needs_merge_review     boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (workspace_id, id),
  check (email_norm is not null or phone_e164 is not null),
  check (sms_consent_at is null or sms_consent_text is not null)
);
create unique index contacts_email_uniq on public.contacts (workspace_id, email_norm) where email_norm is not null;
create unique index contacts_phone_uniq on public.contacts (workspace_id, phone_e164) where phone_e164 is not null;

create table public.pipeline_stages (
  id            uuid primary key default app.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  position      integer not null,
  kind          text not null check (kind in ('open', 'won', 'lost')),
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, position) deferrable initially immediate
);
create unique index pipeline_stages_one_default on public.pipeline_stages (workspace_id) where is_default;

create table public.litters (
  id              uuid primary key default app.uuid_v7(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  name            text not null,
  is_general      boolean not null default false,
  sire            text,
  dam             text,
  expected_date   date,
  born_date       date,
  expected_count  integer check (expected_count >= 0),
  status          text not null default 'planned'
                    check (status in ('planned', 'confirmed', 'born', 'closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index litters_one_general on public.litters (workspace_id) where is_general;

create table public.leads (
  id                 uuid primary key default app.uuid_v7(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  contact_id         uuid not null,
  stage_id           uuid not null,
  litter_id          uuid,
  source             text not null check (source in
                       ('form', 'embed', 'email', 'facebook', 'instagram', 'text', 'call',
                        'show', 'referral', 'import', 'other')),
  rating             smallint check (rating between 1 and 5),
  tags               text[] not null default '{}',
  assigned_user_id   uuid references public.users (id) on delete set null,
  last_contacted_at  timestamptz,
  next_task_due_at   timestamptz,
  closed_reason      text,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, stage_id)   references public.pipeline_stages (workspace_id, id),
  foreign key (workspace_id, litter_id)  references public.litters (workspace_id, id)
);
create index leads_workspace_stage_idx on public.leads (workspace_id, stage_id);
create index leads_contact_idx on public.leads (workspace_id, contact_id);
create index leads_tags_idx on public.leads using gin (tags);

create table public.forms (
  id               uuid primary key default app.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  kind             text not null check (kind in ('inquiry', 'application')),
  title            text not null,
  fields           jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),
  success_message  text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.form_submissions (
  id            uuid primary key default app.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  form_id       uuid not null,
  lead_id       uuid,
  answers       jsonb not null default '{}',
  ip_hash       text,
  user_agent    text,
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (workspace_id, form_id) references public.forms (workspace_id, id),
  foreign key (workspace_id, lead_id) references public.leads (workspace_id, id) on delete cascade
);
create index form_submissions_lead_idx on public.form_submissions (workspace_id, lead_id);

-- Only active entries hold a position; matched or released entries keep the
-- row (for history) with position null. The general waitlist is the
-- workspace's is_general litter, so litter_id is never null and the unique
-- constraint covers it. Deferrable so a reorder can swap positions in one
-- transaction.
create table public.waitlist_entries (
  id            uuid primary key default app.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  lead_id       uuid not null,
  litter_id     uuid not null,
  position      integer check (position > 0),
  sex_pref      text,
  color_pref    text,
  status        text not null default 'active' check (status in ('active', 'matched', 'released')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  unique (litter_id, position) deferrable initially immediate,
  check ((status = 'active') = (position is not null)),
  foreign key (workspace_id, lead_id)   references public.leads (workspace_id, id) on delete cascade,
  foreign key (workspace_id, litter_id) references public.litters (workspace_id, id)
);

-- Append-only position history. A manual reorder (both positions set) needs a reason.
create table public.waitlist_events (
  id             uuid primary key default app.uuid_v7(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  entry_id       uuid not null,
  from_position  integer,
  to_position    integer,
  actor_user_id  uuid references public.users (id) on delete set null,
  reason         text,
  created_at     timestamptz not null default now(),
  check (from_position is null or to_position is null or coalesce(length(trim(reason)), 0) > 0),
  foreign key (workspace_id, entry_id) references public.waitlist_entries (workspace_id, id) on delete cascade
);
create index waitlist_events_entry_idx on public.waitlist_events (workspace_id, entry_id);

create or replace function app.forbid_change() returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

-- Both guards fire for every role, including the table owner. UPDATE is always
-- blocked. DELETE is allowed only when it comes from a foreign-key cascade (the
-- cascade runs inside Postgres's own trigger, so the depth is above 1), so
-- deleting a workspace, lead or contact still removes its history.
create or replace function app.forbid_direct_delete() returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger waitlist_events_no_update before update on public.waitlist_events
  for each row execute function app.forbid_change();
create trigger waitlist_events_no_delete before delete on public.waitlist_events
  for each row execute function app.forbid_direct_delete();

create table public.templates (
  id            uuid primary key default app.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  channel       text not null check (channel in ('email', 'sms')),
  name          text not null,
  subject       text,
  body          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  check (channel = 'sms' or subject is not null)
);

create table public.payments (
  id                 uuid primary key default app.uuid_v7(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  lead_id            uuid,              -- null after a contact delete; record kept, redacted
  kind               text not null check (kind in ('deposit', 'balance', 'other')),
  amount_cents       integer not null check (amount_cents > 0),
  method             text not null check (method in ('stripe', 'zelle', 'cash', 'other')),
  stripe_session_id  text unique,
  status             text not null default 'pending' check (status in ('pending', 'paid', 'refunded')),
  terms_snapshot     text,
  note               text,
  recorded_by        uuid references public.users (id) on delete set null,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (workspace_id, lead_id) references public.leads (workspace_id, id) on delete set null (lead_id),
  check (status <> 'paid' or paid_at is not null)
);
create index payments_lead_idx on public.payments (workspace_id, lead_id);

create table public.messages (
  id            uuid primary key default app.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  lead_id       uuid not null,
  channel       text not null check (channel in ('email', 'sms')),
  direction     text not null check (direction in ('out', 'in')),
  template_id   uuid,
  subject       text,
  body          text not null,
  provider_id   text,
  status        text not null check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  sent_at       timestamptz,
  read_at       timestamptz,   -- inbound only; null = unread in Inbox
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (workspace_id, lead_id)     references public.leads (workspace_id, id) on delete cascade,
  foreign key (workspace_id, template_id) references public.templates (workspace_id, id) on delete set null (template_id),
  check (direction = 'in' or read_at is null)
);
create index messages_lead_idx on public.messages (workspace_id, lead_id, created_at);
create index messages_unread_idx on public.messages (workspace_id) where direction = 'in' and read_at is null;
create unique index messages_provider_uniq on public.messages (channel, provider_id) where provider_id is not null;

-- The lead timeline. Tasks are activities with due_at.
create table public.activities (
  id             uuid primary key default app.uuid_v7(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  lead_id        uuid not null,
  type           text not null check (type in
                   ('note', 'stage_change', 'task', 'call_logged', 'form', 'payment', 'system')),
  payload        jsonb not null default '{}',
  actor_user_id  uuid references public.users (id) on delete set null,
  due_at         timestamptz,
  done_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (workspace_id, lead_id) references public.leads (workspace_id, id) on delete cascade,
  check (type = 'task' or due_at is null)
);
create index activities_lead_idx on public.activities (workspace_id, lead_id, created_at);
create index activities_open_tasks_idx on public.activities (workspace_id, due_at)
  where type = 'task' and done_at is null;

-- ---------------------------------------------------------------------------
-- Supporting tables
-- ---------------------------------------------------------------------------

create table public.sequences (
  id            uuid primary key default app.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.sequence_steps (
  id               uuid primary key default app.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  sequence_id      uuid not null,
  step_number      integer not null check (step_number > 0),
  delay_hours      integer not null check (delay_hours >= 0),
  template_id      uuid not null,
  stop_conditions  jsonb not null default '["inbound_reply", "stage_change", "manual_stop"]',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (sequence_id, step_number),
  foreign key (workspace_id, sequence_id) references public.sequences (workspace_id, id) on delete cascade,
  foreign key (workspace_id, template_id) references public.templates (workspace_id, id)
);

create table public.sequence_enrollments (
  id            uuid primary key default app.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  lead_id       uuid not null,
  sequence_id   uuid not null,
  next_step     integer not null default 1,
  next_run_at   timestamptz,
  status        text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (workspace_id, lead_id)     references public.leads (workspace_id, id) on delete cascade,
  foreign key (workspace_id, sequence_id) references public.sequences (workspace_id, id) on delete cascade
);
create unique index sequence_enrollments_one_active on public.sequence_enrollments (lead_id, sequence_id)
  where status = 'active';
create index sequence_enrollments_due_idx on public.sequence_enrollments (next_run_at) where status = 'active';

-- Written by server code only (impersonation, exports, workspace creation).
create table public.audit_log (
  id             uuid primary key default app.uuid_v7(),
  workspace_id   uuid references public.workspaces (id) on delete set null,
  actor_user_id  uuid references public.users (id) on delete set null,
  action         text not null,
  details        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index audit_log_workspace_idx on public.audit_log (workspace_id, created_at);

create trigger audit_log_no_update before update on public.audit_log
  for each row execute function app.forbid_change();

-- Webhook idempotency. Not tenant data; server code only.
create table public.webhook_events (
  id            uuid primary key default app.uuid_v7(),
  provider      text not null check (provider in ('stripe', 'twilio', 'email')),
  event_id      text not null,
  payload       jsonb,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces', 'users', 'memberships', 'contacts', 'pipeline_stages', 'litters', 'leads',
    'forms', 'form_submissions', 'waitlist_entries', 'templates', 'payments', 'messages',
    'activities', 'sequences', 'sequence_steps', 'sequence_enrollments'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
      t || '_touch_updated_at', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------

-- Public pages (inquiry form, application, deposit) go through server code,
-- never straight to the database, so anon gets nothing.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema app from public;

grant usage on schema app to authenticated;
grant execute on function app.my_workspace_ids(), app.my_admin_workspace_ids() to authenticated;
grant execute on function app.uuid_v7() to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Users may edit only their own name and phone; is_platform_admin is server-only.
revoke insert, update, delete on public.users from authenticated;
grant update (name, phone) on public.users to authenticated;

-- Membership-scoped tables: full access for any member of the row's workspace.
do $$
declare t text;
begin
  foreach t in array array[
    'contacts', 'pipeline_stages', 'litters', 'leads', 'forms', 'form_submissions',
    'waitlist_entries', 'templates', 'payments', 'messages', 'activities',
    'sequences', 'sequence_steps', 'sequence_enrollments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy member_access on public.%I for all to authenticated
         using (workspace_id in (select app.my_workspace_ids()))
         with check (workspace_id in (select app.my_workspace_ids()))', t);
  end loop;
end;
$$;

alter table public.workspaces enable row level security;
create policy member_read on public.workspaces for select to authenticated
  using (id in (select app.my_workspace_ids()));
create policy owner_update on public.workspaces for update to authenticated
  using (id in (select app.my_admin_workspace_ids()))
  with check (id in (select app.my_admin_workspace_ids()));
-- No insert or delete policy: workspaces are created and removed by the platform.

alter table public.users enable row level security;
create policy self_or_teammate_read on public.users for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select m.user_id from public.memberships m
              where m.workspace_id in (select app.my_workspace_ids()))
  );
create policy self_update on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter table public.memberships enable row level security;
create policy member_read on public.memberships for select to authenticated
  using (workspace_id in (select app.my_workspace_ids()));
-- Owners manage owner and staff rows; support rows are created by the platform only.
create policy owner_insert on public.memberships for insert to authenticated
  with check (workspace_id in (select app.my_admin_workspace_ids()) and role in ('owner', 'staff'));
create policy owner_update on public.memberships for update to authenticated
  using (workspace_id in (select app.my_admin_workspace_ids()) and role in ('owner', 'staff'))
  with check (workspace_id in (select app.my_admin_workspace_ids()) and role in ('owner', 'staff'));
create policy owner_delete on public.memberships for delete to authenticated
  using (workspace_id in (select app.my_admin_workspace_ids()) and role in ('owner', 'staff'));

alter table public.waitlist_events enable row level security;
create policy member_read on public.waitlist_events for select to authenticated
  using (workspace_id in (select app.my_workspace_ids()));
create policy member_append on public.waitlist_events for insert to authenticated
  with check (workspace_id in (select app.my_workspace_ids()) and actor_user_id = (select auth.uid()));

alter table public.audit_log enable row level security;
create policy owner_read on public.audit_log for select to authenticated
  using (workspace_id in (select app.my_admin_workspace_ids()));

alter table public.webhook_events enable row level security;
-- No policies: server code only.
