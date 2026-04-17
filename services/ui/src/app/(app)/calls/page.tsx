import { supabaseServer } from '@/lib/supabase-server';
import { CallsTable } from '@/components/calls-table';

export const dynamic = 'force-dynamic';

export default async function CallsPage() {
  const supabase = await supabaseServer();
  const { data: calls } = await supabase
    .from('calls')
    .select(
      'id, started_at, direction, from_number, to_number, status, end_reason, duration_seconds, agent_id, agent_version_snapshot',
    )
    .order('started_at', { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Calls</h1>
      <p className="mt-1 text-sm text-slate-500">Latest 100 calls. Updates live.</p>
      <div className="mt-6">
        <CallsTable initial={calls ?? []} />
      </div>
    </div>
  );
}
