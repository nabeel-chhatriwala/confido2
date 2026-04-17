'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

interface Call {
  id: string;
  tenant_id: string;
  agent_id: string;
  twilio_call_sid: string;
  direction: 'inbound' | 'outbound';
  from_number: string;
  to_number: string;
  status: string;
  end_reason: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  agent_version_snapshot: Record<string, unknown> | null;
  transcript_json: { text?: string; turns?: Array<{ role: string; content: string }> } | null;
  recording_object_path: string | null;
  recording_pulled_at: string | null;
}
interface Event {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

const TOOL_KINDS = new Set(['tool_call', 'tool_result', 'function_call', 'function_result']);

export function CallDetail({ call, initialEvents }: { call: Call; initialEvents: Event[] }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [liveCall, setLiveCall] = useState<Call>(call);

  // Realtime updates on this specific call.
  useEffect(() => {
    const supabase = supabaseBrowser();
    const ch = supabase
      .channel(`call-${call.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${call.id}` },
        (payload) => setLiveCall((prev) => ({ ...prev, ...(payload.new as Call) })),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_events', filter: `call_id=eq.${call.id}` },
        (payload) => setEvents((prev) => [...prev, payload.new as Event]),
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [call.id]);

  // Mint a signed audio URL from admin-api when a recording is available.
  useEffect(() => {
    if (!liveCall.recording_object_path) return;
    const supabase = supabaseBrowser();
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) return;
      const base = process.env.NEXT_PUBLIC_ADMIN_API_URL ?? 'http://localhost:8082';
      try {
        const resp = await fetch(`${base}/api/calls/${call.id}/signed-url`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          setAudioError(`HTTP ${resp.status}`);
          return;
        }
        const body = (await resp.json()) as { url: string };
        setAudioUrl(body.url);
      } catch (e: any) {
        setAudioError(e.message);
      }
    })();
  }, [call.id, liveCall.recording_object_path]);

  const turns = liveCall.transcript_json?.turns ?? [];
  const snapshot = liveCall.agent_version_snapshot as {
    llm_provider?: string;
    llm_config?: { model?: string };
    tts_provider?: string;
    tts_config?: { model?: string };
    stt_provider?: string;
    stt_config?: { model?: string };
    system_prompt?: string;
    first_message?: string;
  } | null;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Call {liveCall.id.slice(0, 8)}</h1>
        <span
          className={
            'rounded-full px-2 py-0.5 text-xs font-medium ' +
            (liveCall.status === 'in_progress'
              ? 'bg-amber-100 text-amber-800'
              : liveCall.status === 'completed'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-rose-100 text-rose-800')
          }
        >
          {liveCall.end_reason ?? liveCall.status}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
        <Dt k="Direction" v={liveCall.direction} />
        <Dt k="Twilio SID" v={liveCall.twilio_call_sid} mono />
        <Dt k="From" v={liveCall.from_number} mono />
        <Dt k="To" v={liveCall.to_number} mono />
        <Dt k="Started" v={liveCall.started_at ? new Date(liveCall.started_at).toLocaleString() : '—'} />
        <Dt k="Ended" v={liveCall.ended_at ? new Date(liveCall.ended_at).toLocaleString() : '—'} />
        <Dt k="Duration" v={liveCall.duration_seconds != null ? `${liveCall.duration_seconds}s` : '—'} />
        <Dt
          k="Stack"
          v={`${snapshot?.stt_provider}/${snapshot?.stt_config?.model} · ${snapshot?.llm_provider}/${snapshot?.llm_config?.model} · ${snapshot?.tts_provider}/${snapshot?.tts_config?.model}`}
        />
      </dl>

      {snapshot?.system_prompt && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-slate-700">System prompt</h2>
          <pre className="mt-1 whitespace-pre-wrap rounded border bg-white p-3 text-xs">{snapshot.system_prompt}</pre>
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">Recording</h2>
        {audioUrl ? (
          <audio controls src={audioUrl} preload="none" className="mt-2 w-full" />
        ) : liveCall.recording_object_path ? (
          <div className="mt-2 text-sm text-slate-500">{audioError ? `Failed to load: ${audioError}` : 'Loading signed URL…'}</div>
        ) : (
          <div className="mt-2 text-sm text-slate-500">No recording yet — pull runs after the call ends.</div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">Transcript</h2>
        <div className="mt-2 space-y-2 rounded border bg-white p-4 text-sm">
          {turns.length === 0 ? (
            <div className="text-slate-500">No transcript captured.</div>
          ) : (
            turns.map((t, i) => (
              <div key={i} className="flex gap-2">
                <div className={'w-20 shrink-0 text-xs font-medium ' + (t.role === 'user' ? 'text-blue-700' : 'text-emerald-700')}>{t.role}</div>
                <div className="flex-1 whitespace-pre-wrap">{t.content}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">Events ({events.length})</h2>
        <ul className="mt-2 space-y-1 rounded border bg-white p-3 font-mono text-xs">
          {events.map((e) => (
            <li key={e.id} className={TOOL_KINDS.has(e.kind) ? 'rounded bg-violet-50 px-2 py-1' : ''}>
              <span className="text-slate-500">{new Date(e.occurred_at).toISOString().slice(11, 23)}</span>{' '}
              <span className="font-semibold">{e.kind}</span>{' '}
              <span className="text-slate-700">{JSON.stringify(e.payload)}</span>
            </li>
          ))}
          {events.length === 0 && <li className="text-slate-500">No events.</li>}
        </ul>
      </div>
    </div>
  );
}

function Dt({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{v}</dd>
    </>
  );
}
