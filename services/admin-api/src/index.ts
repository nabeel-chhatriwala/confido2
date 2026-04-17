import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerHealthRoute } from './routes/health.js';
import { registerCallsSignedUrlRoute } from './routes/calls-signed-url.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(cors, { origin: true, credentials: true });
await registerHealthRoute(app);
await registerCallsSignedUrlRoute(app);

const port = Number(process.env.PORT ?? 8082);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`admin-api listening on :${port}`);
