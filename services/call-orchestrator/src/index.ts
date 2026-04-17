import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { registerHealthRoute } from './routes/health.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(formbody);
await registerHealthRoute(app);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`call-orchestrator listening on :${port}`);
