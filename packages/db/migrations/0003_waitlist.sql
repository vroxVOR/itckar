-- Requests are created by authenticated staff, at the client's request.
alter table client add constraint client_tenant_id_id_unique unique (tenant_id, id);
alter table resource add constraint resource_tenant_id_id_unique unique (tenant_id, id);
alter table appointment add constraint appointment_tenant_id_id_unique unique (tenant_id, id);

create table waitlist_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  client_id uuid not null,
  service_ids uuid[] not null check (cardinality(service_ids) between 1 and 6),
  staff_id uuid,
  from_at timestamptz not null,
  until_at timestamptz not null check (until_at > from_at),
  channel text not null check (channel in ('email', 'sms')),
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'notified', 'closed', 'booked')),
  public_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  offer_version integer not null default 0,
  offered_start_at timestamptz,
  offered_end_at timestamptz,
  notification_id bigint references notification(id) on delete set null,
  booked_appointment_id uuid,
  requested_at timestamptz not null default now(),
  created_by uuid not null references user_account(id),
  foreign key (tenant_id, client_id) references client(tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id) references resource(tenant_id, id),
  foreign key (tenant_id, booked_appointment_id) references appointment(tenant_id, id)
);
create index waitlist_waiting on waitlist_entry (tenant_id, id) where status = 'waiting';
create index waitlist_client on waitlist_entry (tenant_id, client_id);
create unique index waitlist_duplicate on waitlist_entry (tenant_id, client_id, service_ids, coalesce(staff_id::text, ''), from_at, until_at)
  where status in ('waiting', 'offered', 'notified');
alter table waitlist_entry enable row level security;
create policy waitlist_tenant on waitlist_entry using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on waitlist_entry to itckar_app;
