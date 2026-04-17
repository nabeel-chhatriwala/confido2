-- Enable Realtime replication for call updates.
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.call_events;
