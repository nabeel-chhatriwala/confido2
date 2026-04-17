import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { registerHealthRoute } from './routes/health.js';
import { registerVoiceInboundRoute } from './routes/voice-inbound.js';
import { registerVoiceStatusRoute } from './routes/voice-status.js';
import { registerPullRecordingTaskRoute } from './routes/tasks-pull-recording.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(formbody);
await registerHealthRoute(app);
await registerVoiceInboundRoute(app);
await registerVoiceStatusRoute(app);
await registerPullRecordingTaskRoute(app);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`call-orchestrator listening on :${port}`);
