import { describe, it, expect } from 'vitest';
import { AgentSchema, CallSchema, TenantSchema, ProviderKindSchema } from '../src/schemas/index.js';

describe('schemas', () => {
  it('accepts a valid agent', () => {
    const result = AgentSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      tenant_id: '00000000-0000-0000-0000-000000000002',
      name: 'intake',
      system_prompt: 'You are a helpful assistant.',
      first_message: 'Hi.',
      stt_provider: 'deepgram',
      stt_config: { model: 'nova-2' },
      llm_provider: 'openai',
      llm_config: { model: 'gpt-4o-mini', temperature: 0.7 },
      tts_provider: 'elevenlabs',
      tts_config: { voice_id: 'abc' },
      current_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an agent with unknown stt_provider', () => {
    const result = AgentSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      tenant_id: '00000000-0000-0000-0000-000000000002',
      name: 'intake',
      system_prompt: 'x',
      first_message: 'x',
      stt_provider: 'bogus',
      stt_config: {},
      llm_provider: 'openai',
      llm_config: {},
      tts_provider: 'elevenlabs',
      tts_config: {},
      current_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid call', () => {
    const result = CallSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000003',
      tenant_id: '00000000-0000-0000-0000-000000000002',
      agent_id: '00000000-0000-0000-0000-000000000001',
      twilio_call_sid: 'CA0123',
      direction: 'inbound',
      from_number: '+15551234567',
      to_number: '+15557654321',
      status: 'in_progress',
      end_reason: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_seconds: null,
      agent_version_snapshot: { stt_provider: 'deepgram' },
      transcript_json: null,
      recording_object_path: null,
      recording_pulled_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('enumerates all provider kinds', () => {
    expect(ProviderKindSchema.safeParse('stt').success).toBe(true);
    expect(ProviderKindSchema.safeParse('llm').success).toBe(true);
    expect(ProviderKindSchema.safeParse('tts').success).toBe(true);
    expect(ProviderKindSchema.safeParse('image').success).toBe(false);
  });
});
