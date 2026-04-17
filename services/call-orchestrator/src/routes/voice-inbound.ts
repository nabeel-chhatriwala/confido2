import type { FastifyInstance } from 'fastify';
import { signSessionToken } from '@confido/shared';
import { config } from '../config.js';
import { supabase } from '../supabase.js';
import { verifyTwilioSignature } from '../twilio/signature.js';
import { connectStreamTwiml, hangupTwiml } from '../twilio/twiml.js';

interface InboundBody {
  CallSid: string;
  From: string;
  To: string;
  [k: string]: string;
}

export async function registerVoiceInboundRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: InboundBody }>('/voice/inbound', async (req, reply) => {
    const fullUrl = `${config.publicUrl}${req.url}`;
    const sig = req.headers['x-twilio-signature'];
    if (typeof sig !== 'string') {
      return reply.code(403).send('missing signature');
    }
    const params = req.body ?? ({} as InboundBody);
    if (!verifyTwilioSignature(config.twilioAuthToken, fullUrl, params, sig)) {
      return reply.code(403).send('invalid signature');
    }

    const { CallSid, From, To } = params;
    if (!CallSid || !From || !To) {
      return reply.code(400).send('missing fields');
    }

    const { data: mapping, error: mapErr } = await supabase
      .from('twilio_numbers')
      .select('tenant_id, agent_id, direction')
      .eq('phone_number', To)
      .in('direction', ['inbound', 'both'])
      .maybeSingle();

    if (mapErr || !mapping) {
      req.log.warn({ CallSid, To, mapErr }, 'no inbound mapping; hanging up');
      reply.type('application/xml');
      return reply.send(hangupTwiml());
    }

    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select('*')
      .eq('id', mapping.agent_id)
      .single();
    if (agentErr || !agent) {
      req.log.error({ CallSid, agentErr }, 'agent missing');
      reply.type('application/xml');
      return reply.send(hangupTwiml());
    }

    const { data: callRow, error: upsertErr } = await supabase
      .from('calls')
      .upsert(
        {
          tenant_id: mapping.tenant_id,
          agent_id: agent.id,
          twilio_call_sid: CallSid,
          direction: 'inbound',
          from_number: From,
          to_number: To,
          status: 'in_progress',
          started_at: new Date().toISOString(),
          agent_version_snapshot: agent,
        },
        { onConflict: 'twilio_call_sid' },
      )
      .select('id, tenant_id, agent_id')
      .single();

    if (upsertErr || !callRow) {
      req.log.error({ CallSid, upsertErr }, 'failed to upsert call');
      reply.type('application/xml');
      return reply.send(hangupTwiml());
    }

    const token = signSessionToken(
      { call_id: callRow.id, tenant_id: callRow.tenant_id, agent_id: callRow.agent_id },
      config.internalSvcToken,
      120,
    );
    const wsUrl = `${config.workerWsUrl}?token=${encodeURIComponent(token)}`;

    reply.type('application/xml');
    return reply.send(connectStreamTwiml(wsUrl));
  });
}
