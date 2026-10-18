-- Week 5: applications, waitlists and deposits.

-- Stable handles for the stages that payments and waitlists move leads into,
-- so owners can rename stages freely (Data model: "Source of truth").
alter table public.pipeline_stages add column system_key text
  check (system_key in ('new', 'contacted', 'application', 'approved', 'waitlisted', 'deposit_paid', 'matched', 'placed', 'closed'));
create unique index pipeline_stages_system_key_uniq on public.pipeline_stages (workspace_id, system_key) where system_key is not null;

alter table public.workspaces add column stripe_charges_enabled boolean not null default false;

alter table public.payments drop constraint payments_status_check;
alter table public.payments add constraint payments_status_check check (status in ('pending', 'paid', 'refunded', 'failed'));
create index payments_pending_session_idx on public.payments (stripe_session_id) where stripe_session_id is not null;

alter table public.templates drop constraint templates_system_key_check;
alter table public.templates add constraint templates_system_key_check check (system_key in (
  'auto_reply_email', 'auto_reply_sms', 'decline', 'nurture_1', 'nurture_2', 'nurture_3',
  'application_link', 'application_reminder_email', 'application_reminder_sms',
  'approved', 'deposit_link', 'deposit_reminder', 'deposit_receipt', 'litter_born'));

alter table public.sequences drop constraint sequences_system_key_check;
alter table public.sequences add constraint sequences_system_key_check
  check (system_key in ('nurture', 'application_reminder', 'deposit_reminder'));

-- Default application questions (FR-15), editable under Settings > Forms.
create or replace function app.default_application_fields(p_business_type text) returns jsonb
language sql immutable
as $$
  select case p_business_type
    when 'breeder' then
      '[{"key":"household","label":"Tell us about your household (adults, children, other pets)","type":"text","required":true},
        {"key":"home_type","label":"Home type","type":"select","required":true,"options":["House with fenced yard","House without fenced yard","Apartment or condo","Other"]},
        {"key":"owned_breed","label":"Have you owned this breed before?","type":"yes_no","required":true},
        {"key":"sex_pref","label":"Preferred sex","type":"select","required":false,"options":["Male","Female","No preference"]},
        {"key":"color_pref","label":"Preferred color or markings","type":"text","required":false},
        {"key":"timeline","label":"When are you hoping to bring a puppy home?","type":"select","required":true,"options":["As soon as possible","1 to 3 months","3 to 6 months","6 months or more"]},
        {"key":"vet_reference","label":"Veterinarian reference (name and phone)","type":"text","required":false},
        {"key":"anything_else","label":"Anything else we should know?","type":"text","required":false}]'::jsonb
    else
      '[{"key":"about_dog","label":"Tell us about your dog (name, age, breed)","type":"text","required":true},
        {"key":"goals","label":"What would you like to work on?","type":"text","required":true},
        {"key":"schedule","label":"What days and times work for you?","type":"text","required":false},
        {"key":"anything_else","label":"Anything else we should know?","type":"text","required":false}]'::jsonb
  end;
$$;
revoke all on function app.default_application_fields(text) from public;

-- Templates, reminder sequences and stage keys a workspace needs for week 5.
create or replace function app.seed_week5(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_type text;
  v_seq uuid;
  t record;
begin
  select business_type into v_type from public.workspaces where id = p_workspace_id;

  update public.pipeline_stages s set system_key = k.key
  from (values ('New', 'new'), ('Contacted', 'contacted'), ('Application', 'application'), ('Approved', 'approved'),
               ('Waitlisted', 'waitlisted'), ('Booked', 'waitlisted'), ('Deposit paid', 'deposit_paid'), ('Paid', 'deposit_paid'),
               ('Matched', 'matched'), ('Placed', 'placed'), ('Completed', 'placed'), ('Closed', 'closed')) as k(name, key)
  where s.workspace_id = p_workspace_id and s.name = k.name and s.system_key is null
    and not exists (select 1 from public.pipeline_stages x where x.workspace_id = p_workspace_id and x.system_key = k.key);

  update public.forms set fields = app.default_application_fields(v_type)
  where workspace_id = p_workspace_id and kind = 'application' and fields = '[]'::jsonb;

  for t in select * from (values
    ('application_link', 'email', 'Application link', 'Your application for {{business_name}}',
     E'Hi {{first_name}},\n\nThanks for your interest! Here is our application. It takes about 5 minutes:\n{{application_link}}\n\nWe review every application personally.'),
    ('application_reminder_email', 'email', 'Application reminder', 'A reminder about your application',
     E'Hi {{first_name}},\n\nJust a reminder that your application is waiting for you:\n{{application_link}}\n\nLet us know if you have any questions.'),
    ('application_reminder_sms', 'sms', 'Application reminder (SMS)', null,
     'Hi {{first_name}}, a reminder from {{business_name}}: your application is here {{application_link}}'),
    ('approved', 'email', 'Approved', 'Good news from {{business_name}}',
     E'Hi {{first_name}},\n\nWe''re happy to let you know your application has been approved.\n\nTo hold your spot on our waitlist, please place your deposit of {{deposit_amount}} here:\n{{deposit_link}}\n\nWe''ll be in touch with updates.'),
    ('deposit_link', 'email', 'Deposit link', 'Your deposit link for {{business_name}}',
     E'Hi {{first_name}},\n\nHere is your link to place your deposit of {{deposit_amount}}:\n{{deposit_link}}'),
    ('deposit_reminder', 'email', 'Deposit reminder', 'A reminder about your deposit',
     E'Hi {{first_name}},\n\nA friendly reminder that your deposit of {{deposit_amount}} holds your spot:\n{{deposit_link}}\n\nReply if you have any questions.'),
    ('deposit_receipt', 'email', 'Deposit receipt', 'Deposit received: thank you!',
     E'Hi {{first_name}},\n\nWe received your deposit of {{deposit_amount}}. Thank you!\n\nYou are number {{waitlist_position}} on the {{litter_name}} list. We''ll keep you posted.'),
    ('litter_born', 'email', 'Litter born', 'The {{litter_name}} litter has arrived!',
     E'Hi {{first_name}},\n\nGreat news: the {{litter_name}} litter has been born! You are number {{waitlist_position}} on the list.\n\nWe''ll share photos and next steps soon.')
  ) as v(key, channel, name, subject, body)
  loop
    insert into public.templates (workspace_id, channel, name, subject, body, system_key)
    select p_workspace_id, t.channel, t.name, t.subject, t.body, t.key
    where not exists (select 1 from public.templates x where x.workspace_id = p_workspace_id and x.system_key = t.key);
  end loop;

  -- "Application link sent, no submission": reminder email at 48 hours, then SMS at 5 days.
  if not exists (select 1 from public.sequences where workspace_id = p_workspace_id and system_key = 'application_reminder') then
    insert into public.sequences (workspace_id, name, system_key) values (p_workspace_id, 'Application reminder', 'application_reminder')
    returning id into v_seq;
    insert into public.sequence_steps (workspace_id, sequence_id, step_number, delay_hours, template_id, stop_conditions)
    select p_workspace_id, v_seq, s.n, s.h, tp.id, '["application_submitted"]'
    from (values (1, 48, 'application_reminder_email'), (2, 120, 'application_reminder_sms')) as s(n, h, key)
    join public.templates tp on tp.workspace_id = p_workspace_id and tp.system_key = s.key;
  end if;

  -- "Approved, deposit link sent, not paid": reminder at 3 days, then 7 days.
  if not exists (select 1 from public.sequences where workspace_id = p_workspace_id and system_key = 'deposit_reminder') then
    insert into public.sequences (workspace_id, name, system_key) values (p_workspace_id, 'Deposit reminder', 'deposit_reminder')
    returning id into v_seq;
    insert into public.sequence_steps (workspace_id, sequence_id, step_number, delay_hours, template_id, stop_conditions)
    select p_workspace_id, v_seq, s.n, s.h, tp.id, '["payment_recorded"]'
    from (values (1, 72), (2, 168)) as s(n, h)
    join public.templates tp on tp.workspace_id = p_workspace_id and tp.system_key = 'deposit_reminder';
  end if;
end;
$$;
revoke all on function app.seed_week5(uuid) from public;

select app.seed_week5(id) from public.workspaces;

create or replace function app.create_workspace(
  p_name           text,
  p_slug           text,
  p_business_type  text,
  p_timezone       text,
  p_owner_user_id  uuid,
  p_actor_user_id  uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'unknown time zone: %', p_timezone using errcode = 'invalid_parameter_value';
  end if;

  insert into public.workspaces (name, slug, business_type, timezone)
  values (p_name, p_slug, p_business_type, p_timezone)
  returning id into v_id;

  insert into public.memberships (user_id, workspace_id, role)
  values (p_owner_user_id, v_id, 'owner');

  perform app.seed_workspace(v_id);
  perform app.seed_inquiry_form(v_id);
  perform app.tag_system_records(v_id);
  perform app.seed_week5(v_id);

  insert into public.audit_log (workspace_id, actor_user_id, action, details)
  values (v_id, p_actor_user_id, 'workspace.create',
          jsonb_build_object('slug', p_slug, 'owner_user_id', p_owner_user_id));

  return v_id;
end;
$$;
