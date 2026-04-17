import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const supabase = await supabaseServer();
  const { data: agents } = await supabase
    .from('agents')
    .select('id, name, stt_provider, stt_config, llm_provider, llm_config, tts_provider, tts_config, current_version')
    .order('name');
  return (
    <div>
      <h1 className="text-2xl font-semibold">Agents</h1>
      <div className="mt-6 overflow-hidden rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">STT</th>
              <th className="px-3 py-2">LLM</th>
              <th className="px-3 py-2">TTS</th>
              <th className="px-3 py-2">Version</th>
            </tr>
          </thead>
          <tbody>
            {(agents ?? []).map((a: any) => (
              <tr key={a.id} className="border-t">
                <td className="px-3 py-2">
                  <Link href={`/calls?agent=${a.id}`} className="text-blue-600 hover:underline">{a.name}</Link>
                </td>
                <td className="px-3 py-2 text-xs">{a.stt_provider}/{a.stt_config?.model ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{a.llm_provider}/{a.llm_config?.model ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{a.tts_provider}/{a.tts_config?.model ?? '—'}</td>
                <td className="px-3 py-2">{a.current_version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
