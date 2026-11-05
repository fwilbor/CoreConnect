-- Week 6: data export and contact delete (FR-28).

-- audit_log has no insert policy: only server code writes it. This lets a
-- workspace owner (or the platform admin during a support session) record
-- their own export or contact delete, with their own user id as the actor.
-- Other actions can't be written this way.
create or replace function app.write_audit(p_workspace_id uuid, p_action text, p_details jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_action not in ('export', 'contact.delete') then
    raise exception 'unknown audit action %', p_action using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from app.my_admin_workspace_ids() w where w = p_workspace_id) then
    raise exception 'only the workspace owner can do that' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_log (workspace_id, actor_user_id, action, details)
  values (p_workspace_id, (select auth.uid()), p_action, coalesce(p_details, '{}'));
end;
$$;

revoke all on function app.write_audit(uuid, text, jsonb) from public;
grant execute on function app.write_audit(uuid, text, jsonb) to authenticated;
