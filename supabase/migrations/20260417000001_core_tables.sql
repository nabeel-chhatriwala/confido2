-- Core tables for voice agent platform.

create schema if not exists internal;
create extension if not exists "uuid-ossp";

create table public.tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  concurrency_cap int not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'viewer' check (role in ('viewer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  system_prompt text not null default '',
  first_message text not null default '',
  stt_provider text not null,
  stt_config jsonb not null default '{}'::jsonb,
  llm_provider text not null,
  llm_config jsonb not null default '{}'::jsonb,
  tts_provider text not null,
  tts_config jsonb not null default '{}'::jsonb,
  llm_fallback_provider text,
  current_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_versions (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create table public.twilio_numbers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  phone_number text not null unique,
  direction text not null check (direction in ('inbound','outbound','both')),
  created_at timestamptz not null default now()
);

create table public.calls (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  twilio_call_sid text not null unique,
  direction text not null check (direction in ('inbound','outbound')),
  from_number text not null,
  to_number text not null,
  status text not null default 'queued'
    check (status in ('queued','dialing','in_progress','completed','failed')),
  end_reason text check (end_reason in (
    'caller_hangup','agent_hangup','stt_failed','llm_failed','tts_failed','error'
  )),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int generated always as (
    case when ended_at is not null and started_at is not null
      then extract(epoch from (ended_at - started_at))::int
      else null end
  ) stored,
  agent_version_snapshot jsonb not null,
  transcript_json jsonb,
  recording_object_path text,
  recording_pulled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Declare parent partitioned table; partitions created by pg_partman in migration 5.
create table public.call_events (
  id bigserial,
  call_id uuid not null references public.calls(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  primary key (occurred_at, id)
) partition by range (occurred_at);

create table public.outbound_jobs (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  to_phone text not null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','dialing','in_call','completed','failed')),
  cloud_task_name text,
  call_id uuid references public.calls(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  actor_id uuid references public.users(id),
  action text not null,
  target_table text not null,
  target_id uuid,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now()
);

-- is_admin helper in the internal schema (not public); RLS uses it.
create or replace function internal.is_admin(uid uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.users u where u.id = uid and u.role = 'admin');
$$;
revoke all on function internal.is_admin(uuid) from public;
grant execute on function internal.is_admin(uuid) to authenticated;

-- updated_at triggers.
create or replace function internal.set_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger tenants_updated before update on public.tenants
  for each row execute function internal.set_updated_at();
create trigger users_updated before update on public.users
  for each row execute function internal.set_updated_at();
create trigger agents_updated before update on public.agents
  for each row execute function internal.set_updated_at();
create trigger calls_updated before update on public.calls
  for each row execute function internal.set_updated_at();
create trigger outbound_jobs_updated before update on public.outbound_jobs
  for each row execute function internal.set_updated_at();
