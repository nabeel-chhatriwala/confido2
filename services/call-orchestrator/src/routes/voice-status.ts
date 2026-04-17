import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { supabase } from '../supabase.js';
import { enqueuePullRecording } from '../cloud-tasks.js';
import { verifyTwilioSignature } from '../twilio/signature.js';

interface StatusBody {
  CallSid: string;
  CallStatus: string;
  RecordingSid?: string;
  [k: string]: string | undefined;
}

export async function registerVoiceStatusRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: StatusBody }>('/voice/status', async (req, reply) => {
    const fullUrl = `${config.publicUrl}${req.url}`;
    const sig = req.headers['x-twilio-signature'];
    if (typeof sig !== 'string') return reply.code(403).send('missing signature');

    const params: Record<string, string> = Object.fromEntries(
      Object.entries(req.body ?? {}).filter(([, v]) => v !== undefined) as [string, string][],
    );
    if (!verifyTwilioSignature(config.twilioAuthToken, fullUrl, params, sig)) {
      return reply.code(403).send('invalid signature');
    }

    const { CallSid, CallStatus, RecordingSid } = params;
    if (!CallSid) return reply.code(400).send('missing CallSid');

    const finalStatus =
      CallStatus === 'completed'
        ? 'completed'
        : CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer'
          ? 'failed'
          : null;

    if (finalStatus) {
      const { data: call, error } = await supabase
        .from('calls')
        .update({ status: finalStatus, ended_at: new Date().toISOString() })
        .eq('twilio_call_sid', CallSid)
        .select('id')
        .maybeSingle();

      if (error) req.log.error({ CallSid, error }, 'failed to mark call ended');

      if (call && RecordingSid) {
        const taskName = await enqueuePullRecording({ callId: call.id, recordingSid: RecordingSid });
        req.log.info({ callId: call.id, taskName }, 'recording pull enqueued');
      }
    }

    return reply.code(200).send('ok');
  });
}
