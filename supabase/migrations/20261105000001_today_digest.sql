-- Week 6: Today screen and morning digest.

-- Go-home date per litter, shown on Today and in the digest. Optional; when it
-- is empty and the litter has a birth date, the app assumes 8 weeks after birth.
alter table public.litters add column go_home_date date;

-- The workspace-local date of the last digest sent, so each workspace gets at
-- most one per day even when the 1-minute tick runs late or twice.
alter table public.workspaces add column digest_sent_on date;
