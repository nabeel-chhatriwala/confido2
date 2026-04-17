import type { FastifyInstance } from 'fastify';
import { supabase } from '../supabase.js';
import { requireAuthenticated } from '../auth.js';

interface Params { id: string }

export async function registerCallsSignedUrlRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: Params }>('/api/calls/:id/signed-url', async (req, reply) => {
    try {
      await requireAuthenticated(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }
    const { id } = req.params;
    const { data: call, error: callErr } = await supabase
      .from('calls')
      .select('recording_object_path')
      .eq('id', id)
      .single();
    if (callErr || !call?.recording_object_path) {
      return reply.code(404).send({ error: 'no recording' });
    }
    const { data, error } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(call.recording_object_path, 300);
    if (error || !data) return reply.code(500).send({ error: error?.message ?? 'sign failed' });
    return reply.send({ url: data.signedUrl, expiresIn: 300 });
  });
}
