import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

interface Body {
  callId: string;
  recordingSid: string;
}

export async function registerPullRecordingTaskRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Body }>('/tasks/pull-recording', async (req, reply) => {
    if (req.headers['x-internal-svc-token'] !== config.internalSvcToken) {
      return reply.code(403).send('forbidden');
    }
    const { callId, recordingSid } = req.body ?? ({} as Body);
    if (!callId || !recordingSid) return reply.code(400).send('missing');

    const url = `${config.supabaseUrl}/functions/v1/pull-twilio-recording`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      },
      body: JSON.stringify({ callId, recordingSid }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      req.log.error({ callId, status: resp.status, text }, 'edge function failed');
      return reply.code(500).send('edge function failed');
    }
    return reply.code(200).send('ok');
  });
}
