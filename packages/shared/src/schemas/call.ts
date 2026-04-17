import { z } from 'zod';

export const CallDirectionSchema = z.enum(['inbound', 'outbound']);
export const CallStatusSchema = z.enum([
  'queued',
  'dialing',
  'in_progress',
  'completed',
  'failed',
]);
export const EndReasonSchema = z
  .enum(['caller_hangup', 'agent_hangup', 'stt_failed', 'llm_failed', 'tts_failed', 'error'])
  .nullable();

export const CallSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  twilio_call_sid: z.string(),
  direction: CallDirectionSchema,
  from_number: z.string(),
  to_number: z.string(),
  status: CallStatusSchema,
  end_reason: EndReasonSchema,
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable(),
  duration_seconds: z.number().int().nullable(),
  agent_version_snapshot: z.record(z.unknown()),
  transcript_json: z.record(z.unknown()).nullable(),
  recording_object_path: z.string().nullable(),
  recording_pulled_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Call = z.infer<typeof CallSchema>;
