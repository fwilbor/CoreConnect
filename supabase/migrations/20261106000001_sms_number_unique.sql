-- Inbound texts are routed to a workspace by the number they were sent to
-- (lib/messaging/inbound.ts), so a number can belong to one workspace only.
create unique index workspaces_sms_number_unique on public.workspaces (sms_number_e164)
  where sms_number_e164 is not null;
