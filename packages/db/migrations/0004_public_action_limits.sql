-- Shared counters for public booking mutations. Identifiers are HMAC hashes, never raw IPs.
create table public_action_limit (
  tenant_id uuid not null references tenant(id) on delete cascade,
  action text not null check (action in ('hold', 'book', 'cancel')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  hits integer not null check (hits > 0),
  expires_at timestamptz not null,
  primary key (tenant_id, action, key_hash)
);
create index public_action_limit_expiry on public_action_limit(expires_at);
alter table public_action_limit enable row level security;
create policy public_action_limit_tenant on public_action_limit
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on public_action_limit to itckar_app;
