'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase-browser';

interface Row {
  id: string;
  started_at: string | null;
  direction: 'inbound' | 'outbound';
  from_number: string;
  to_number: string;
  status: string;
  end_reason: string | null;
  duration_seconds: number | null;
  agent_id: string;
  agent_version_snapshot: { llm_provider?: string; llm_config?: { model?: string }; tts_provider?: string; tts_config?: { model?: string } } | null;
}

export function CallsTable({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel('calls-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, (payload) => {
        setRows((prev) => {
          if (payload.eventType === 'INSERT') return [payload.new as Row, ...prev].slice(0, 100);
          if (payload.eventType === 'UPDATE')
            return prev.map((r) => (r.id === (payload.new as Row).id ? { ...r, ...(payload.new as Row) } : r));
          if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== (payload.old as Row).id);
          return prev;
        });
      })
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, []);

  return (
    <div className="overflow-hidden rounded-md border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Started</th>
            <th className="px-3 py-2">Dir</th>
            <th className="px-3 py-2">From</th>
            <th className="px-3 py-2">To</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">LLM</th>
            <th className="px-3 py-2">TTS</th>
            <th className="px-3 py-2">Dur</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-3 py-2 whitespace-nowrap">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</td>
              <td className="px-3 py-2">{r.direction}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.from_number}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.to_number}</td>
              <td className="px-3 py-2">
                <span className={statusClass(r.status, r.end_reason)}>{r.end_reason ?? r.status}</span>
              </td>
              <td className="px-3 py-2 text-xs text-slate-600">
                {r.agent_version_snapshot?.llm_provider ?? '—'}/{r.agent_version_snapshot?.llm_config?.model ?? '—'}
              </td>
              <td className="px-3 py-2 text-xs text-slate-600">
                {r.agent_version_snapshot?.tts_provider ?? '—'}/{r.agent_version_snapshot?.tts_config?.model ?? '—'}
              </td>
              <td className="px-3 py-2">{r.duration_seconds != null ? `${r.duration_seconds}s` : '—'}</td>
              <td className="px-3 py-2">
                <Link href={`/calls/${r.id}`} className="text-blue-600 hover:underline">
                  open
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-3 py-6 text-center text-slate-500">No calls yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function statusClass(s: string, end: string | null): string {
  if (s === 'in_progress' || s === 'dialing') return 'text-amber-600';
  if (end === 'caller_hangup' || end === 'agent_hangup') return 'text-slate-600';
  if (s === 'completed') return 'text-emerald-600';
  if (s === 'failed') return 'text-rose-600';
  return 'text-slate-600';
}
