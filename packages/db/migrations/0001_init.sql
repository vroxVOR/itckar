-- itckar: initial schema
-- Conventions: every tenant-scoped table has tenant_id + RLS; instants are timestamptz;
-- local times (rota) are stored as time/date in the tenant's IANA zone (tenant.timezone).

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- platform
create table tenant (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'),
  name            text not null,
  timezone        text not null default 'Europe/Prague',
  locale          text not null default 'cs',
  currency        char(3) not null default 'CZK',
  country         char(2) not null default 'CZ',
  vertical        text not null default 'hair',          -- hair | barber | beauty | nails | massage | wellness | other
  slot_step_min   int  not null default 15 check (slot_step_min between 5 and 120),
  min_notice_min  int  not null default 60 check (min_notice_min >= 0),
  max_advance_days int not null default 60 check (max_advance_days between 1 and 365),
  cancel_until_min int not null default 1440 check (cancel_until_min >= 0),
  reminder_hours  int[] not null default '{24}',
  settings        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table user_account (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  password_hash text not null,
  name          text not null,
  locale        text not null default 'cs',
  created_at    timestamptz not null default now()
);
-- case-insensitive uniqueness without the citext extension
create unique index user_account_email_key on user_account (lower(email));

create table membership (
  user_id    uuid not null references user_account(id) on delete cascade,
  tenant_id  uuid not null references tenant(id) on delete cascade,
  role       text not null check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table session (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references user_account(id) on delete cascade,
  tenant_id  uuid references tenant(id) on delete set null,   -- currently selected tenant
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index session_user_idx on session(user_id);

-- ---------------------------------------------------------------- tenant data
create table location (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  name       text not null,
  address    text,
  phone      text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index location_tenant_idx on location(tenant_id);

create table resource (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  location_id     uuid references location(id) on delete set null,
  kind            text not null check (kind in ('staff','chair','room','device','other')),
  name            text not null,
  color           text,
  user_id         uuid references user_account(id) on delete set null,  -- staff login
  bookable_online boolean not null default true,
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index resource_tenant_idx on resource(tenant_id);

create table availability_rule (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  resource_id uuid not null references resource(id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7),   -- 1 = Monday
  start_time  time not null,
  end_time    time not null
);
create index availability_rule_resource_idx on availability_rule(tenant_id, resource_id);

create table availability_override (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  resource_id uuid not null references resource(id) on delete cascade,
  date        date not null,
  intervals   jsonb not null default '[]',   -- [{"start":"HH:mm","end":"HH:mm"}], [] = day off
  note        text,
  unique (resource_id, date)
);

create table service_category (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0
);
create index service_category_tenant_idx on service_category(tenant_id);

create table service (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  category_id       uuid references service_category(id) on delete set null,
  name              text not null,
  description       text,
  price_cents       int not null default 0 check (price_cents >= 0),
  price_from        boolean not null default false,           -- "od 450 Kč"
  buffer_before_min int not null default 0 check (buffer_before_min >= 0),
  buffer_after_min  int not null default 0 check (buffer_after_min >= 0),
  bookable_online   boolean not null default true,
  active            boolean not null default true,
  color             text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);
create index service_tenant_idx on service(tenant_id);

create table service_requirement (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  service_id uuid not null references service(id) on delete cascade,
  key        text not null,
  kind       text not null check (kind in ('staff','chair','room','device','other')),
  sort_order int not null default 0,
  unique (service_id, key)
);

create table service_requirement_candidate (
  requirement_id uuid not null references service_requirement(id) on delete cascade,
  resource_id    uuid not null references resource(id) on delete cascade,
  tenant_id      uuid not null references tenant(id) on delete cascade,
  primary key (requirement_id, resource_id)
);

create table service_segment (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  service_id   uuid not null references service(id) on delete cascade,
  position     int not null,
  name         text,
  duration_min int not null check (duration_min > 0),
  kind         text not null check (kind in ('active','processing')),
  occupies     text[] not null,                 -- requirement keys
  unique (service_id, position)
);

create table client (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant(id) on delete cascade,
  first_name       text not null,
  last_name        text,
  email            text,
  phone            text,                          -- E.164
  locale           text,
  notes            text,
  health_notes     text,                          -- GDPR art. 9: only with consent kind 'health_notes'
  no_show_count    int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index client_tenant_idx on client(tenant_id);
create unique index client_tenant_phone_key on client(tenant_id, phone) where phone is not null;
create unique index client_tenant_email_key on client(tenant_id, lower(email)) where email is not null;

create table consent (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  client_id    uuid not null references client(id) on delete cascade,
  kind         text not null check (kind in ('marketing_email','marketing_sms','health_notes','terms')),
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  source       text not null,                     -- 'online_booking' | 'admin' | 'import'
  text_version text,
  ip           inet
);
create index consent_client_idx on consent(tenant_id, client_id);

create table appointment (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  location_id   uuid references location(id) on delete set null,
  client_id     uuid references client(id) on delete set null,
  status        text not null default 'confirmed'
                check (status in ('pending','confirmed','completed','cancelled','no_show')),
  start_at      timestamptz not null,
  end_at        timestamptz not null check (end_at > start_at),
  source        text not null default 'admin' check (source in ('online','admin','ai','import')),
  notes         text,                             -- internal
  client_note   text,                             -- from the client
  public_token  text not null unique default encode(gen_random_bytes(16), 'hex'),
  cancelled_at  timestamptz,
  cancel_reason text,
  created_by    uuid references user_account(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index appointment_tenant_time_idx on appointment(tenant_id, start_at);
create index appointment_client_idx on appointment(tenant_id, client_id);

create table appointment_item (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  appointment_id uuid not null references appointment(id) on delete cascade,
  service_id     uuid references service(id) on delete set null,
  position       int not null,
  service_name   text not null,                   -- snapshot
  price_cents    int not null default 0,
  unique (appointment_id, position)
);

-- Semantic segments for display (which resource does what, when).
create table appointment_segment (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  appointment_id uuid not null references appointment(id) on delete cascade,
  item_id        uuid not null references appointment_item(id) on delete cascade,
  position       int not null,
  kind           text not null check (kind in ('active','processing')),
  start_at       timestamptz not null,
  end_at         timestamptz not null check (end_at > start_at),
  resource_ids   uuid[] not null
);
create index appointment_segment_appt_idx on appointment_segment(appointment_id);

-- THE invariant: one resource can never be blocked twice at the same instant.
-- Rows are merged per resource (segments + buffers) so an appointment never conflicts with itself.
create table resource_block (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  resource_id    uuid not null references resource(id) on delete cascade,
  during         tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  kind           text not null check (kind in ('appointment','hold','timeoff')),
  appointment_id uuid references appointment(id) on delete cascade,
  hold_token     text,
  expires_at     timestamptz,                     -- holds only
  note           text,
  blocking       boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint resource_block_no_overlap
    exclude using gist (tenant_id with =, resource_id with =, during with &&) where (blocking)
);
create index resource_block_lookup_idx on resource_block using gist (tenant_id, resource_id, during);
create index resource_block_appt_idx on resource_block(appointment_id);
create index resource_block_hold_idx on resource_block(hold_token) where hold_token is not null;

create table audit_log (
  id         bigserial primary key,
  tenant_id  uuid references tenant(id) on delete cascade,
  actor_id   uuid,
  actor_type text not null default 'user' check (actor_type in ('user','client','system','ai')),
  action     text not null,
  entity     text not null,
  entity_id  text,
  data       jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_tenant_idx on audit_log(tenant_id, created_at desc);

-- ---------------------------------------------------------------- jobs & notifications
create table job (
  id           bigserial primary key,
  tenant_id    uuid references tenant(id) on delete cascade,
  kind         text not null,
  payload      jsonb not null default '{}',
  run_at       timestamptz not null default now(),
  status       text not null default 'pending' check (status in ('pending','running','done','failed','cancelled')),
  attempts     int not null default 0,
  max_attempts int not null default 5,
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  dedupe_key   text,
  created_at   timestamptz not null default now()
);
create index job_due_idx on job(run_at) where status = 'pending';
create unique index job_dedupe_key on job(dedupe_key) where dedupe_key is not null and status in ('pending','running');

create table notification (
  id                  bigserial primary key,
  tenant_id           uuid not null references tenant(id) on delete cascade,
  appointment_id      uuid references appointment(id) on delete set null,
  client_id           uuid references client(id) on delete set null,
  channel             text not null check (channel in ('email','sms','whatsapp','push')),
  template            text not null,
  recipient           text not null,
  body_preview        text,
  status              text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  provider            text,
  provider_message_id text,
  error               text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index notification_tenant_idx on notification(tenant_id, created_at desc);

-- ---------------------------------------------------------------- updated_at
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger tenant_updated_at before update on tenant for each row execute function set_updated_at();
create trigger client_updated_at before update on client for each row execute function set_updated_at();
create trigger appointment_updated_at before update on appointment for each row execute function set_updated_at();
