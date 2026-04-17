create index calls_tenant_started_idx on public.calls (tenant_id, started_at desc);
create index calls_agent_started_idx on public.calls (agent_id, started_at desc);
create index outbound_jobs_tenant_status_idx on public.outbound_jobs (tenant_id, status, created_at desc);
create index twilio_numbers_agent_idx on public.twilio_numbers (agent_id);
create index agents_tenant_idx on public.agents (tenant_id);

-- Full-text search over transcript text.
alter table public.calls add column transcript_tsv tsvector generated always as (
  to_tsvector('english', coalesce(transcript_json->>'text', ''))
) stored;
create index calls_transcript_fts_idx on public.calls using gin (transcript_tsv);
