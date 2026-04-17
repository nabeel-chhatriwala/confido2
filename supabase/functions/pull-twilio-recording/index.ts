// deno-lint-ignore-file no-explicit-any
import { createClient } from 'supabase';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const authHeader = req.headers.get('authorization') ?? '';
  const expectedAuth = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`;
  if (authHeader !== expectedAuth) return new Response('forbidden', { status: 403 });

  const { callId, recordingSid } = (await req.json()) as { callId: string; recordingSid: string };
  if (!callId || !recordingSid) return new Response('bad request', { status: 400 });

  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const basic = btoa(`${twilioSid}:${twilioToken}`);
  const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Recordings/${recordingSid}.mp3`;

  const twilioResp = await fetch(mediaUrl, { headers: { Authorization: `Basic ${basic}` } });
  if (!twilioResp.ok) {
    return new Response(`twilio fetch failed: ${twilioResp.status}`, { status: 502 });
  }
  const audio = await twilioResp.arrayBuffer();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: call, error: callErr } = await supabase
    .from('calls')
    .select('id, tenant_id, started_at')
    .eq('id', callId)
    .single();
  if (callErr || !call) return new Response('call not found', { status: 404 });

  const started = new Date(call.started_at);
  const key = `${call.tenant_id}/${started.getUTCFullYear()}/${String(
    started.getUTCMonth() + 1,
  ).padStart(2, '0')}/${String(started.getUTCDate()).padStart(2, '0')}/${call.id}.mp3`;

  const { error: uploadErr } = await supabase.storage
    .from('call-recordings')
    .upload(key, new Uint8Array(audio), { contentType: 'audio/mpeg', upsert: true });
  if (uploadErr) return new Response(`upload failed: ${uploadErr.message}`, { status: 500 });

  await supabase
    .from('calls')
    .update({ recording_object_path: key, recording_pulled_at: new Date().toISOString() })
    .eq('id', callId);

  return new Response(JSON.stringify({ ok: true, key }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
