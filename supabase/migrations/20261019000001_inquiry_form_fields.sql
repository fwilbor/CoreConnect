-- Inquiry forms: name, email, phone, source and SMS consent are fixed fields
-- rendered by the app on every inquiry form. forms.fields now holds only the
-- workspace's custom fields (FR-03: up to 15).

alter table public.forms
  add constraint forms_fields_max_15 check (jsonb_array_length(fields) <= 15);

-- Default custom fields for new workspaces.
create or replace function app.default_inquiry_fields(p_business_type text) returns jsonb
language sql immutable
as $$
  select case p_business_type
    when 'breeder' then
      '[{"key":"looking_for","label":"What are you looking for?","type":"text","required":false},
        {"key":"sex_pref","label":"Preferred sex","type":"select","required":false,
         "options":["Male","Female","No preference"]},
        {"key":"owned_breed","label":"Have you owned this breed before?","type":"yes_no","required":false}]'::jsonb
    else
      '[{"key":"service","label":"What service are you interested in?","type":"text","required":false},
        {"key":"start_date","label":"When would you like to start?","type":"date","required":false}]'::jsonb
  end;
$$;

-- Replace the inquiry form in the seed with the new defaults.
create or replace function app.seed_inquiry_form(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.forms f
  set fields = app.default_inquiry_fields(w.business_type)
  from public.workspaces w
  where f.workspace_id = p_workspace_id and w.id = f.workspace_id and f.kind = 'inquiry';
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
  perform app.seed_inquiry_form(v_id);

  insert into public.audit_log (workspace_id, actor_user_id, action, details)
  values (v_id, p_actor_user_id, 'workspace.create',
          jsonb_build_object('slug', p_slug, 'owner_user_id', p_owner_user_id));

  return v_id;
end;
$$;

revoke all on function app.default_inquiry_fields(text) from public;
revoke all on function app.seed_inquiry_form(uuid) from public;

-- Existing workspaces: swap the old fixed-field list for the defaults, unless
-- the owner has already customized it.
update public.forms f
set fields = app.default_inquiry_fields(w.business_type)
from public.workspaces w
where w.id = f.workspace_id
  and f.kind = 'inquiry'
  and f.fields @> '[{"key":"name"},{"key":"email"},{"key":"phone"},{"key":"source"}]'::jsonb
  and jsonb_array_length(f.fields) = 4;
