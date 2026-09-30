alter table public_action_limit drop constraint public_action_limit_action_check;
alter table public_action_limit add constraint public_action_limit_action_check check (action in ('hold', 'book', 'cancel', 'sms'));
create table phone_challenge (
  tenant_id uuid not null references tenant(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  phone_hash text not null check (phone_hash ~ '^[a-f0-9]{64}$'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 5),
  delivered boolean not null default false,
  verified boolean not null default false,
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  primary key (tenant_id, token_hash)
);
create index phone_challenge_expiry on phone_challenge(expires_at);
alter table phone_challenge enable row level security;
create policy phone_challenge_tenant on phone_challenge
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on phone_challenge to itckar_app;
