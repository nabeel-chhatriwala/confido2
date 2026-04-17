import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { CallDetail } from '@/components/call-detail';

export const dynamic = 'force-dynamic';

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: call } = await supabase.from('calls').select('*').eq('id', id).maybeSingle();
  if (!call) notFound();

  const { data: events } = await supabase
    .from('call_events')
    .select('id, kind, payload, occurred_at')
    .eq('call_id', id)
    .order('occurred_at', { ascending: true })
    .limit(500);

  return <CallDetail call={call} initialEvents={events ?? []} />;
}
