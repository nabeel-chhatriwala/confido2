import { z } from 'zod';

export const SttProviderSchema = z.enum(['deepgram', 'assemblyai']);
export const LlmProviderSchema = z.enum(['openai', 'anthropic', 'groq']);
export const TtsProviderSchema = z.enum(['elevenlabs', 'cartesia', 'openai']);
export const ProviderKindSchema = z.enum(['stt', 'llm', 'tts']);

export const AgentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1),
  system_prompt: z.string(),
  first_message: z.string(),
  stt_provider: SttProviderSchema,
  stt_config: z.record(z.unknown()),
  llm_provider: LlmProviderSchema,
  llm_config: z.record(z.unknown()),
  tts_provider: TtsProviderSchema,
  tts_config: z.record(z.unknown()),
  current_version: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Agent = z.infer<typeof AgentSchema>;
export type SttProvider = z.infer<typeof SttProviderSchema>;
export type LlmProvider = z.infer<typeof LlmProviderSchema>;
export type TtsProvider = z.infer<typeof TtsProviderSchema>;
export type ProviderKind = z.infer<typeof ProviderKindSchema>;
