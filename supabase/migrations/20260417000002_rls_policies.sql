-- RLS. Services use the service_role key (bypasses RLS);
-- the UI uses the anon key with a signed-in JWT and hits these policies.

alter table public.tenants enable row level security;
create policy tenants_read_all on public.tenants
  for select using (auth.role() = 'authenticated');
create policy tenants_admin_write on public.tenants
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.users enable row level security;
create policy users_self_read on public.users
  for select using (id = auth.uid());
create policy users_admin_all on public.users
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.agents enable row level security;
create policy agents_read_all on public.agents
  for select using (auth.role() = 'authenticated');
create policy agents_admin_write on public.agents
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.agent_versions enable row level security;
create policy agent_versions_read_all on public.agent_versions
  for select using (auth.role() = 'authenticated');
create policy agent_versions_admin_write on public.agent_versions
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.twilio_numbers enable row level security;
create policy twilio_numbers_read_all on public.twilio_numbers
  for select using (auth.role() = 'authenticated');
create policy twilio_numbers_admin_write on public.twilio_numbers
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.calls enable row level security;
create policy calls_read_all on public.calls
  for select using (auth.role() = 'authenticated');
-- No UI write policies on calls; service_role only.

alter table public.call_events enable row level security;
create policy call_events_read_all on public.call_events
  for select using (auth.role() = 'authenticated');

alter table public.outbound_jobs enable row level security;
create policy outbound_jobs_read_all on public.outbound_jobs
  for select using (auth.role() = 'authenticated');

alter table public.audit_log enable row level security;
create policy audit_admin_read on public.audit_log
  for select using (internal.is_admin(auth.uid()));
