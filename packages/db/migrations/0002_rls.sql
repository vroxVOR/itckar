-- Row-level security: shared schema, tenant_id column, policy bound to a per-transaction
-- setting `app.tenant_id` (SET LOCAL). The application connects as role itckar_app, which
-- is NOT the table owner and has NOBYPASSRLS, so policies always apply to it.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'itckar_app') then
    execute format('create role itckar_app login nobypassrls password %L',
                   coalesce(current_setting('app.role_password', true), 'itckar_app'));
  end if;
end $$;

grant usage on schema public to itckar_app;
grant select, insert, update, delete on all tables in schema public to itckar_app;
grant usage, select on all sequences in schema public to itckar_app;
alter default privileges in schema public grant select, insert, update, delete on tables to itckar_app;
alter default privileges in schema public grant usage, select on sequences to itckar_app;

create or replace function app_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Tenant-scoped tables
do $$
declare t text;
begin
  foreach t in array array[
    'location','resource','availability_rule','availability_override','service_category','service',
    'service_requirement','service_requirement_candidate','service_segment','client','consent',
    'appointment','appointment_item','appointment_segment','resource_block','notification'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_tenant_isolation on %I using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t, t);
  end loop;
end $$;

-- tenant: visible only when selected
alter table tenant enable row level security;
create policy tenant_self on tenant using (id = app_tenant_id()) with check (id = app_tenant_id());
-- ...but the public booking page and login flow must resolve a tenant by slug before a
-- tenant context exists. That is done via security definer functions below.

-- audit_log / job: tenant rows when a tenant is set, otherwise platform-level rows
alter table audit_log enable row level security;
create policy audit_log_tenant on audit_log
  using (tenant_id = app_tenant_id() or (tenant_id is null and app_tenant_id() is null))
  with check (tenant_id = app_tenant_id() or tenant_id is null);
alter table job enable row level security;
create policy job_access on job using (true) with check (true);   -- worker runs without tenant; payload carries tenant_id

-- Platform tables (user_account, membership, session) are not tenant scoped; the app
-- layer authorizes them. Kept without RLS on purpose.

-- Security definer helpers usable before a tenant context exists.
create or replace function public_tenant_by_slug(p_slug text)
returns setof tenant
language sql security definer stable set search_path = public as $$
  select * from tenant where tenant.slug = p_slug
$$;

create or replace function tenants_for_user(p_user uuid)
returns table (id uuid, slug text, name text, role text)
language sql security definer stable set search_path = public as $$
  select t.id, t.slug, t.name, m.role from tenant t join membership m on m.tenant_id = t.id
  where m.user_id = p_user order by t.name
$$;

create or replace function create_tenant_with_owner(p_slug text, p_name text, p_timezone text, p_locale text,
                                                    p_currency char(3), p_country char(2), p_vertical text, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into tenant (slug, name, timezone, locale, currency, country, vertical)
  values (p_slug, p_name, p_timezone, p_locale, p_currency, p_country, p_vertical) returning id into v_id;
  insert into membership (user_id, tenant_id, role) values (p_owner, v_id, 'owner');
  insert into location (tenant_id, name, is_default) values (v_id, p_name, true);
  return v_id;
end $$;

-- Appointment lookup by public token (manage/cancel link) before tenant context is known.
create or replace function tenant_id_for_public_token(p_token text) returns uuid
language sql security definer stable set search_path = public as $$
  select tenant_id from appointment where public_token = p_token
$$;

revoke all on function public_tenant_by_slug(text) from public;
revoke all on function tenants_for_user(uuid) from public;
revoke all on function create_tenant_with_owner(text,text,text,text,char,char,text,uuid) from public;
revoke all on function tenant_id_for_public_token(text) from public;
grant execute on function public_tenant_by_slug(text) to itckar_app;
grant execute on function tenants_for_user(uuid) to itckar_app;
grant execute on function create_tenant_with_owner(text,text,text,text,char,char,text,uuid) to itckar_app;
grant execute on function tenant_id_for_public_token(text) to itckar_app;
