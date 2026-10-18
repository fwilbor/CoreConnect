-- Workspace creation and seeding. v1 has no self-serve sign-up: the platform
-- admin creates each workspace during the paid setup. Creating one seeds the
-- stage template, the general waitlist litter, the inquiry and application
-- forms, default templates and the Nurture sequence, and makes the owner a
-- member. Callable from server code only.

create or replace function app.seed_workspace(p_workspace_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_type text;
  v_seq uuid;
  v_t1 uuid;
  v_t2 uuid;
  v_t3 uuid;
begin
  select business_type into v_type from public.workspaces where id = p_workspace_id;
  if v_type is null then
    raise exception 'workspace % not found', p_workspace_id;
  end if;

  -- Stages. The service template renames the lower row to Booked, Paid and
  -- Completed and drops Matched.
  insert into public.pipeline_stages (workspace_id, name, position, kind, is_default)
  select p_workspace_id, s.name, s.position, s.kind, s.position = 1
  from (
    values
      (1, 'New',          'open'),
      (2, 'Contacted',    'open'),
      (3, 'Application',  'open'),
      (4, 'Approved',     'open'),
      (5, case v_type when 'breeder' then 'Waitlisted'   else 'Booked'    end, 'open'),
      (6, case v_type when 'breeder' then 'Deposit paid' else 'Paid'      end, 'open'),
      (7, 'Matched',      'open'),
      (8, case v_type when 'breeder' then 'Placed'       else 'Completed' end, 'won'),
      (9, 'Closed',       'lost')
  ) as s(position, name, kind)
  where not (v_type = 'service' and s.name = 'Matched');

  -- Close the gap the dropped stage leaves in the service template.
  update public.pipeline_stages ps
  set position = r.rn
  from (
    select id, row_number() over (order by position) as rn
    from public.pipeline_stages where workspace_id = p_workspace_id
  ) r
  where ps.id = r.id and ps.position <> r.rn;

  insert into public.litters (workspace_id, name, is_general, status)
  values (p_workspace_id, 'General waitlist', true, 'confirmed');

  insert into public.forms (workspace_id, kind, title, fields, success_message)
  values
    (p_workspace_id, 'inquiry', 'Inquiry',
     '[{"key":"name","label":"Name","type":"text","required":true},
       {"key":"email","label":"Email","type":"text","required":true},
       {"key":"phone","label":"Phone","type":"text","required":true},
       {"key":"source","label":"How did you hear about us?","type":"select","required":true,
        "options":["Facebook","Instagram","Website","Referral","Show","Other"]}]',
     'Thanks! We''ll be in touch shortly.'),
    (p_workspace_id, 'application', 'Application', '[]',
     'Thanks for applying. We''ll review your application and get back to you.');

  insert into public.templates (workspace_id, channel, name, subject, body)
  values
    (p_workspace_id, 'email', 'Auto-reply',
     'Thanks for reaching out',
     E'Hi {{first_name}},\n\nThanks for your inquiry. The next step is a short application: {{application_link}}\n\nWe''ll be in touch soon.'),
    (p_workspace_id, 'sms', 'Auto-reply (SMS)', null,
     'Hi {{first_name}}, thanks for your inquiry! Next step: {{application_link}}'),
    (p_workspace_id, 'email', 'Decline',
     'An update on your inquiry',
     E'Hi {{first_name}},\n\nThank you for your interest. We aren''t able to move forward at this time, and we wish you the best in your search.');

  insert into public.templates (workspace_id, channel, name, subject, body)
  values (p_workspace_id, 'email', 'Nurture 1', 'Any questions?',
          E'Hi {{first_name}},\n\nJust checking in. Happy to answer any questions. Your application link: {{application_link}}')
  returning id into v_t1;
  insert into public.templates (workspace_id, channel, name, subject, body)
  values (p_workspace_id, 'email', 'Nurture 2', 'Still interested?',
          E'Hi {{first_name}},\n\nAre you still looking? Reply to this email and we''ll help with next steps.')
  returning id into v_t2;
  insert into public.templates (workspace_id, channel, name, subject, body)
  values (p_workspace_id, 'email', 'Nurture 3', 'Last check-in',
          E'Hi {{first_name}},\n\nWe don''t want to crowd your inbox, so this is our last check-in. Reply anytime if you''d like to continue.')
  returning id into v_t3;

  insert into public.sequences (workspace_id, name)
  values (p_workspace_id, 'Nurture')
  returning id into v_seq;

  -- Day 1, day 3, day 7.
  insert into public.sequence_steps (workspace_id, sequence_id, step_number, delay_hours, template_id)
  values
    (p_workspace_id, v_seq, 1, 24,  v_t1),
    (p_workspace_id, v_seq, 2, 72,  v_t2),
    (p_workspace_id, v_seq, 3, 168, v_t3);
end;
$$;

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

  insert into public.audit_log (workspace_id, actor_user_id, action, details)
  values (v_id, p_actor_user_id, 'workspace.create',
          jsonb_build_object('slug', p_slug, 'owner_user_id', p_owner_user_id));

  return v_id;
end;
$$;

revoke all on function app.seed_workspace(uuid) from public;
revoke all on function app.create_workspace(text, text, text, text, uuid, uuid) from public;
grant execute on function app.create_workspace(text, text, text, text, uuid, uuid) to service_role;
