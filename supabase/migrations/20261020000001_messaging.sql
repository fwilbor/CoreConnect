-- Messaging (week 4). messages doubles as the outbound queue: automated sends
-- are inserted as 'queued' in the same transaction as the event that caused
-- them, and the 1-minute tick delivers them (Automations: "All automations run
-- from one job queue with a 1-minute scheduler tick").

alter table public.messages
  add column kind text not null default 'one_off'
    check (kind in ('one_off', 'auto_reply', 'sequence', 'reminder', 'system')),
  add column to_address text,
  add column send_after timestamptz,
  add column attempts integer not null default 0,
  add column last_error text,
  add column sequence_step_id uuid references public.sequence_steps (id) on delete set null,
  add column created_by uuid references public.users (id) on delete set null;

create index messages_queue_idx on public.messages (coalesce(send_after, created_at)) where status = 'queued';
create index messages_failed_idx on public.messages (workspace_id, created_at) where status = 'failed';

-- Quiet hours: no SMS 9 pm to 8 am in the given time zone. Returns now() when
-- sending is allowed, otherwise the next 8 am there.
create or replace function app.sms_send_after(p_timezone text) returns timestamptz
language sql stable
as $$
  with local as (select (now() at time zone p_timezone) as t)
  select case
    when extract(hour from t) >= 21 then ((date_trunc('day', t) + interval '1 day' + time '08:00') at time zone p_timezone)
    when extract(hour from t) < 8   then ((date_trunc('day', t) + time '08:00') at time zone p_timezone)
    else now()
  end
  from local;
$$;

grant execute on function app.sms_send_after(text) to authenticated, service_role;

-- Stable handles for the templates and sequence the automations use, so
-- owners can rename them freely.
alter table public.templates add column system_key text
  check (system_key in ('auto_reply_email', 'auto_reply_sms', 'decline', 'nurture_1', 'nurture_2', 'nurture_3'));
create unique index templates_system_key_uniq on public.templates (workspace_id, system_key) where system_key is not null;

alter table public.sequences add column system_key text check (system_key in ('nurture'));
create unique index sequences_system_key_uniq on public.sequences (workspace_id, system_key) where system_key is not null;

create or replace function app.tag_system_records(p_workspace_id uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.templates t set system_key = k.key
  from (values ('Auto-reply', 'email', 'auto_reply_email'), ('Auto-reply (SMS)', 'sms', 'auto_reply_sms'),
               ('Decline', 'email', 'decline'), ('Nurture 1', 'email', 'nurture_1'),
               ('Nurture 2', 'email', 'nurture_2'), ('Nurture 3', 'email', 'nurture_3')) as k(name, channel, key)
  where t.workspace_id = p_workspace_id and t.name = k.name and t.channel = k.channel and t.system_key is null;
  update public.sequences set system_key = 'nurture'
  where workspace_id = p_workspace_id and name = 'Nurture' and system_key is null;
$$;
revoke all on function app.tag_system_records(uuid) from public;

-- Existing workspaces.
select app.tag_system_records(id) from public.workspaces;

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

  insert into public.audit_log (workspace_id, actor_user_id, action, details)
  values (v_id, p_actor_user_id, 'workspace.create',
          jsonb_build_object('slug', p_slug, 'owner_user_id', p_owner_user_id));

  return v_id;
end;
$$;
