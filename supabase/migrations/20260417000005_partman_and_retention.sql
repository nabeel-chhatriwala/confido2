create schema if not exists partman;
create extension if not exists pg_partman with schema partman;
create extension if not exists pg_cron;

-- Turn call_events into a partman-managed monthly partitioned table.
select partman.create_parent(
  p_parent_table => 'public.call_events',
  p_control      => 'occurred_at',
  p_type         => 'range',
  p_interval     => '1 month',
  p_premake      => 3
);

-- Drop partitions older than 90 days (matches recording retention).
update partman.part_config
   set retention = '90 days',
       retention_keep_table = false,
       retention_keep_index = false
 where parent_table = 'public.call_events';

-- Nightly maintenance.
select cron.schedule(
  'partman-maintenance',
  '15 4 * * *',
  $$ call partman.run_maintenance_proc(); $$
);

-- Recording + calls retention: delete rows and their Storage objects at 90 days.
create or replace function internal.retire_old_calls() returns void
  language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
begin
  delete from storage.objects o
   using public.calls c
   where c.created_at < v_cutoff
     and c.recording_object_path is not null
     and o.bucket_id = 'call-recordings'
     and o.name = c.recording_object_path;

  delete from public.calls where created_at < v_cutoff;
end;
$$;
revoke all on function internal.retire_old_calls() from public;

select cron.schedule(
  'retire-old-calls',
  '30 4 * * *',
  $$ select internal.retire_old_calls(); $$
);
