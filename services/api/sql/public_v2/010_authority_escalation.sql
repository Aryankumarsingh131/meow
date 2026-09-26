-- 010: automatic email escalation to the responsible authority (2026-09-26, owner request).
--
--  * authorities: who is responsible for a team's area, their email, and how
--    long a report may stay open before they are emailed (default 48 h).
--  * notifications gain the 'email' channel and recipient_email.
--  * reports.escalated_at: set once the authority has been emailed, so a report
--    is escalated once, not on every run.
--
-- The API's escalation worker (app/escalation.py) does the sending; it needs
-- SMTP settings in the environment. Without them the emails stay 'queued'
-- here and are sent on the first run after SMTP is configured.

create table if not exists authorities (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid not null unique references teams(id) on delete cascade,
  name                 text not null check (length(name) between 2 and 120),
  email                text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  escalate_after_hours int not null default 48 check (escalate_after_hours between 1 and 720),
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);
alter table authorities enable row level security;

alter table notifications add column if not exists recipient_email text;
alter table notifications drop constraint if exists notifications_channel_check;
alter table notifications add constraint notifications_channel_check
  check (channel in ('sms', 'ivr', 'push', 'in_app', 'email'));
alter table notifications drop constraint if exists chk_email_has_recipient;
alter table notifications add constraint chk_email_has_recipient check (channel <> 'email' or recipient_email is not null);

alter table reports add column if not exists escalated_at timestamptz;

-- One authority per demo team: the district water office for its region.
-- example.org addresses never deliver; replace them with the real offices.
insert into authorities (team_id, name, email, escalate_after_hours)
select t.id, coalesce(t.region, t.name) || ' Water Quality Office',
       'water.office.' || regexp_replace(lower(coalesce(t.region, t.name)), '[^a-z0-9]+', '.', 'g') || '@example.org', 48
from teams t
on conflict (team_id) do nothing;

revoke all on authorities from anon, authenticated;
