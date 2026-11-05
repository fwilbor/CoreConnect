-- New-lead notifications to the owner and assignee (Automations: "New lead
-- created: notify owner and assignee by email ... immediately"), and inbound
-- email (FR-04, FR-24).

-- Outbox for emails to workspace members, filled in the same transaction that
-- creates the lead and delivered by the 1-minute tick, like messages.
create table public.notifications (
  id            uuid primary key default app.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  lead_id       uuid not null,
  user_id       uuid not null references public.users (id) on delete cascade,
  kind          text not null check (kind in ('new_lead')),
  status        text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts      integer not null default 0,
  last_error    text,
  send_after    timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (lead_id, user_id, kind),
  foreign key (workspace_id, lead_id) references public.leads (workspace_id, id) on delete cascade
);
create index notifications_queue_idx on public.notifications (coalesce(send_after, created_at)) where status = 'queued';

alter table public.notifications enable row level security;
create policy member_access on public.notifications for all to authenticated
  using (workspace_id in (select app.my_workspace_ids()))
  with check (workspace_id in (select app.my_workspace_ids()));
revoke all on public.notifications from anon;
grant select, insert, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
create trigger notifications_touch_updated_at before update on public.notifications
  for each row execute function app.touch_updated_at();

-- Each member chooses whether to get new-lead emails. On by default.
alter table public.memberships add column notify_new_leads boolean not null default true;

-- Members switch their own new-lead emails on or off. memberships updates are
-- owner-only, so this changes just that one column, for the caller's own row.
create or replace function app.set_notify_new_leads(p_workspace_id uuid, p_on boolean)
returns void
language sql security definer set search_path = ''
as $$
  update public.memberships set notify_new_leads = p_on
  where workspace_id = p_workspace_id and user_id = (select auth.uid());
$$;
revoke all on function app.set_notify_new_leads(uuid, boolean) from public;
grant execute on function app.set_notify_new_leads(uuid, boolean) to authenticated;
