# Plan B: Inbound MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the thinnest end-to-end inbound call path: a caller dials a Twilio number, `call-orchestrator` answers, Twilio opens a Media Streams WebSocket to `pipecat-worker`, the worker runs a hardcoded Deepgram→OpenAI→ElevenLabs pipeline, transcript and events persist to Supabase, and the recording is pulled to Storage after the call ends.

**Architecture:** Two Cloud Run services (Fastify + Python FastAPI/websockets). Orchestrator is stateless and mints a signed session token that the WS URL carries. Worker validates the token, loads `calls.agent_version_snapshot`, and builds a single-stack pipecat pipeline. Recording pull is a Cloud Task → Supabase Edge Function (keeps audio off GCP egress).

**Tech Stack:** Node 20, Fastify 5, Twilio SDK, Pino; Python 3.12, FastAPI, uvicorn, websockets, pipecat-ai (with Deepgram, OpenAI, ElevenLabs adapters), Supabase Python client, `google-cloud-secret-manager`, `google-cloud-tasks`; Deno (Supabase Edge Function).

---

## File Structure

```
services/
├── call-orchestrator/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.ts                 # boots Fastify
│   │   ├── config.ts                # reads env + secrets
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── voice-inbound.ts     # Twilio POST /voice/inbound
│   │   │   ├── voice-status.ts      # Twilio POST /voice/status
│   │   │   └── tasks-pull-recording.ts # Cloud Tasks target
│   │   ├── twilio/
│   │   │   ├── signature.ts         # HMAC verify
│   │   │   └── twiml.ts             # TwiML builders
│   │   ├── supabase.ts              # client singleton
│   │   └── cloud-tasks.ts           # thin enqueue helper
│   └── test/
│       ├── signature.test.ts
│       ├── twiml.test.ts
│       └── voice-inbound.test.ts
└── pipecat-worker/
    ├── pyproject.toml
    ├── Dockerfile
    ├── src/pipecat_worker/
    │   ├── __init__.py
    │   ├── main.py                  # FastAPI app
    │   ├── config.py                # env + Secret Manager
    │   ├── ws.py                    # /ws handler
    │   ├── session.py               # builds pipecat pipeline (single stack)
    │   ├── events.py                # batch writer
    │   ├── token.py                 # verify HMAC session token
    │   └── supabase_client.py
    └── tests/
        ├── test_token.py
        ├── test_events.py
        └── test_session.py

supabase/functions/pull-twilio-recording/
├── index.ts                          # Deno
└── deno.json
```

---

## Task 1: Scaffold call-orchestrator service

**Files:**
- Create: `services/call-orchestrator/package.json`
- Create: `services/call-orchestrator/tsconfig.json`
- Create: `services/call-orchestrator/src/index.ts`
- Create: `services/call-orchestrator/src/routes/health.ts`

- [ ] **Step 1.1: package.json**

Create `services/call-orchestrator/package.json`:

```json
{
  "name": "@confido/call-orchestrator",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p .",
    "start": "node dist/index.js",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@confido/shared": "*",
    "@fastify/formbody": "^8.0.1",
    "@google-cloud/tasks": "^5.4.0",
    "@supabase/supabase-js": "^2.47.0",
    "fastify": "^5.0.0",
    "pino": "^9.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 1.2: tsconfig.json**

Create `services/call-orchestrator/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 1.3: Health route**

Create `services/call-orchestrator/src/routes/health.ts`:

```typescript
import type { FastifyInstance } from 'fastify';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, service: 'call-orchestrator' }));
}
```

- [ ] **Step 1.4: index.ts**

Create `services/call-orchestrator/src/index.ts`:

```typescript
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { registerHealthRoute } from './routes/health.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(formbody);
await registerHealthRoute(app);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`call-orchestrator listening on :${port}`);
```

- [ ] **Step 1.5: Install + smoke-test**

Run: `npm install`
Then: `npm run dev --workspace=@confido/call-orchestrator`
In another terminal: `curl http://localhost:8080/health`
Expected: `{"ok":true,"service":"call-orchestrator"}`. Ctrl-C the dev server.

- [ ] **Step 1.6: Commit**

```bash
git add services/call-orchestrator package.json package-lock.json
git commit -m "feat(orchestrator): scaffold Fastify service with health route"
```

---

## Task 2: Twilio signature verification

**Files:**
- Create: `services/call-orchestrator/src/twilio/signature.ts`
- Create: `services/call-orchestrator/test/signature.test.ts`

- [ ] **Step 2.1: Failing test**

Create `services/call-orchestrator/test/signature.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyTwilioSignature } from '../src/twilio/signature.js';

const AUTH_TOKEN = 'test-twilio-auth-token';
const URL = 'https://example.com/voice/inbound';

function computeSig(url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join('');
  return createHmac('sha1', AUTH_TOKEN).update(url + sorted).digest('base64');
}

describe('verifyTwilioSignature', () => {
  const params = { CallSid: 'CA1', From: '+15551234567', To: '+15557654321' };

  it('accepts a valid signature', () => {
    const sig = computeSig(URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, sig)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const sig = computeSig(URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, sig.slice(0, -2) + 'xx')).toBe(false);
  });

  it('rejects when params differ', () => {
    const sig = computeSig(URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, { ...params, From: '+10000000000' }, sig)).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2.2: Run test to verify fail**

Run: `npm run test --workspace=@confido/call-orchestrator -- signature`
Expected: FAIL.

- [ ] **Step 2.3: Implement signature.ts**

Create `services/call-orchestrator/src/twilio/signature.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyTwilioSignature(
  authToken: string,
  fullUrl: string,
  params: Record<string, string>,
  headerSignature: string,
): boolean {
  const sortedConcat = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join('');
  const expected = createHmac('sha1', authToken).update(fullUrl + sortedConcat).digest('base64');
  const a = Buffer.from(headerSignature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 2.4: Run test to verify pass**

Run: `npm run test --workspace=@confido/call-orchestrator -- signature`
Expected: 3 PASS.

- [ ] **Step 2.5: Commit**

```bash
git add services/call-orchestrator/src/twilio services/call-orchestrator/test/signature.test.ts
git commit -m "feat(orchestrator): add Twilio signature verification"
```

---

## Task 3: TwiML builders

**Files:**
- Create: `services/call-orchestrator/src/twilio/twiml.ts`
- Create: `services/call-orchestrator/test/twiml.test.ts`

- [ ] **Step 3.1: Failing test**

Create `services/call-orchestrator/test/twiml.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { connectStreamTwiml, hangupTwiml } from '../src/twilio/twiml.js';

describe('TwiML builders', () => {
  it('emits a Connect/Stream with token', () => {
    const xml = connectStreamTwiml('wss://worker.example.com/ws?token=abc.def');
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Connect>');
    expect(xml).toContain('wss://worker.example.com/ws?token=abc.def');
    expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('emits hangup TwiML', () => {
    const xml = hangupTwiml();
    expect(xml).toContain('<Hangup/>');
  });

  it('escapes ampersands in WS URL', () => {
    const xml = connectStreamTwiml('wss://a?x=1&y=2');
    expect(xml).toContain('x=1&amp;y=2');
  });
});
```

- [ ] **Step 3.2: Run fail**

Run: `npm run test --workspace=@confido/call-orchestrator -- twiml`
Expected: FAIL.

- [ ] **Step 3.3: Implement twiml.ts**

Create `services/call-orchestrator/src/twilio/twiml.ts`:

```typescript
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function connectStreamTwiml(wsUrl: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Connect>\n` +
    `    <Stream url="${xmlEscape(wsUrl)}"/>\n` +
    `  </Connect>\n` +
    `</Response>`
  );
}

export function hangupTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`;
}
```

- [ ] **Step 3.4: Run pass**

Run: `npm run test --workspace=@confido/call-orchestrator -- twiml`
Expected: 3 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add services/call-orchestrator/src/twilio/twiml.ts services/call-orchestrator/test/twiml.test.ts
git commit -m "feat(orchestrator): add TwiML builders"
```

---

## Task 4: Config + Supabase client singletons

**Files:**
- Create: `services/call-orchestrator/src/config.ts`
- Create: `services/call-orchestrator/src/supabase.ts`

- [ ] **Step 4.1: config.ts**

Create `services/call-orchestrator/src/config.ts`:

```typescript
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  publicUrl: required('PUBLIC_URL'),                     // e.g. https://orchestrator-xxxxxx.a.run.app
  workerWsUrl: required('WORKER_WS_URL'),                // e.g. wss://worker-xxxxxx.a.run.app/ws
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  twilioAuthToken: required('TWILIO_AUTH_TOKEN'),
  twilioSigningKey: required('TWILIO_SIGNING_KEY'),      // Twilio public signing key (optional; we use auth token)
  internalSvcToken: required('INTERNAL_SVC_TOKEN'),
  gcpProject: required('GCP_PROJECT'),
  gcpTaskLocation: process.env.GCP_TASK_LOCATION ?? 'us-central1',
  recordingPullQueue: process.env.RECORDING_PULL_QUEUE ?? 'recording-pull',
  recordingPullHandlerUrl: required('RECORDING_PULL_HANDLER_URL'), // points at this service's /tasks/pull-recording
} as const;
```

- [ ] **Step 4.2: supabase.ts**

Create `services/call-orchestrator/src/supabase.ts`:

```typescript
import { createServiceClient } from '@confido/shared';
import { config } from './config.js';

export const supabase = createServiceClient({
  supabaseUrl: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey,
});
```

- [ ] **Step 4.3: Commit**

```bash
git add services/call-orchestrator/src/config.ts services/call-orchestrator/src/supabase.ts
git commit -m "feat(orchestrator): add config + supabase client"
```

---

## Task 5: Cloud Tasks enqueue helper

**Files:**
- Create: `services/call-orchestrator/src/cloud-tasks.ts`

- [ ] **Step 5.1: Write cloud-tasks.ts**

Create `services/call-orchestrator/src/cloud-tasks.ts`:

```typescript
import { CloudTasksClient } from '@google-cloud/tasks';
import { config } from './config.js';

const client = new CloudTasksClient();

function queuePath(queueId: string): string {
  return client.queuePath(config.gcpProject, config.gcpTaskLocation, queueId);
}

export async function enqueuePullRecording(params: {
  callId: string;
  recordingSid: string;
}): Promise<string> {
  const [task] = await client.createTask({
    parent: queuePath(config.recordingPullQueue),
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: config.recordingPullHandlerUrl,
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Svc-Token': config.internalSvcToken,
        },
        body: Buffer.from(JSON.stringify(params)).toString('base64'),
      },
      dispatchDeadline: { seconds: 600 },
    },
  });
  return task.name ?? '';
}
```

- [ ] **Step 5.2: Commit**

```bash
git add services/call-orchestrator/src/cloud-tasks.ts
git commit -m "feat(orchestrator): add Cloud Tasks enqueue helper"
```

---

## Task 6: POST /voice/inbound route

**Files:**
- Create: `services/call-orchestrator/src/routes/voice-inbound.ts`
- Create: `services/call-orchestrator/test/voice-inbound.test.ts`
- Modify: `services/call-orchestrator/src/index.ts`

- [ ] **Step 6.1: Failing test**

Create `services/call-orchestrator/test/voice-inbound.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';

vi.mock('../src/supabase.js', () => {
  const fromMock = vi.fn();
  return {
    supabase: {
      from: fromMock,
    },
    __mocks: { fromMock },
  };
});
vi.mock('../src/config.js', () => ({
  config: {
    publicUrl: 'https://orch.example.com',
    workerWsUrl: 'wss://worker.example.com/ws',
    twilioAuthToken: 'test-twilio-auth-token',
    internalSvcToken: 'x'.repeat(40),
  },
}));

import { registerVoiceInboundRoute } from '../src/routes/voice-inbound.js';

async function buildApp() {
  const app = Fastify();
  await app.register(formbody);
  await registerVoiceInboundRoute(app);
  return app;
}

describe('POST /voice/inbound', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects without a valid Twilio signature', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/voice/inbound',
      headers: { 'x-twilio-signature': 'bad' },
      payload: 'CallSid=CA1&From=%2B15551234567&To=%2B15557654321',
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 6.2: Run fail**

Run: `npm run test --workspace=@confido/call-orchestrator -- voice-inbound`
Expected: FAIL (module not found).

- [ ] **Step 6.3: Implement route**

Create `services/call-orchestrator/src/routes/voice-inbound.ts`:

```typescript
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

    // Resolve agent from the dialed number.
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
      120, // 2-minute TTL; Twilio connects within seconds.
    );
    const wsUrl = `${config.workerWsUrl}?token=${encodeURIComponent(token)}`;

    reply.type('application/xml');
    return reply.send(connectStreamTwiml(wsUrl));
  });
}
```

- [ ] **Step 6.4: Register route in index.ts**

Modify `services/call-orchestrator/src/index.ts`:

```typescript
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { registerHealthRoute } from './routes/health.js';
import { registerVoiceInboundRoute } from './routes/voice-inbound.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(formbody);
await registerHealthRoute(app);
await registerVoiceInboundRoute(app);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`call-orchestrator listening on :${port}`);
```

- [ ] **Step 6.5: Run test**

Run: `npm run test --workspace=@confido/call-orchestrator -- voice-inbound`
Expected: 1 PASS.

- [ ] **Step 6.6: Commit**

```bash
git add services/call-orchestrator/src/routes/voice-inbound.ts services/call-orchestrator/test/voice-inbound.test.ts services/call-orchestrator/src/index.ts
git commit -m "feat(orchestrator): add POST /voice/inbound with signature + agent resolution"
```

---

## Task 7: POST /voice/status route (enqueues recording pull)

**Files:**
- Create: `services/call-orchestrator/src/routes/voice-status.ts`
- Modify: `services/call-orchestrator/src/index.ts`

- [ ] **Step 7.1: Implement route**

Create `services/call-orchestrator/src/routes/voice-status.ts`:

```typescript
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
      CallStatus === 'completed' ? 'completed' :
      CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' ? 'failed' :
      null;

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
        req.log.info({ callId: call.id, taskName }, 'enqueued recording pull');
      }
    }

    return reply.code(200).send('ok');
  });
}
```

- [ ] **Step 7.2: Register route**

Modify `services/call-orchestrator/src/index.ts` — add import and register line:

```typescript
import { registerVoiceStatusRoute } from './routes/voice-status.js';
// ...
await registerVoiceStatusRoute(app);
```

- [ ] **Step 7.3: Build + typecheck**

Run: `npm run typecheck --workspace=@confido/call-orchestrator`
Expected: no errors.

- [ ] **Step 7.4: Commit**

```bash
git add services/call-orchestrator/src/routes/voice-status.ts services/call-orchestrator/src/index.ts
git commit -m "feat(orchestrator): add /voice/status with recording enqueue"
```

---

## Task 8: POST /tasks/pull-recording (Cloud Tasks target)

**Files:**
- Create: `services/call-orchestrator/src/routes/tasks-pull-recording.ts`
- Modify: `services/call-orchestrator/src/index.ts`

- [ ] **Step 8.1: Implement route**

Create `services/call-orchestrator/src/routes/tasks-pull-recording.ts`:

```typescript
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

    // Invoke the Supabase Edge Function that owns the Twilio-fetch-to-Storage transfer.
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
      return reply.code(500).send('edge function failed'); // Cloud Tasks will retry.
    }
    return reply.code(200).send('ok');
  });
}
```

- [ ] **Step 8.2: Register**

Modify `services/call-orchestrator/src/index.ts`:

```typescript
import { registerPullRecordingTaskRoute } from './routes/tasks-pull-recording.js';
// ...
await registerPullRecordingTaskRoute(app);
```

- [ ] **Step 8.3: Typecheck + commit**

Run: `npm run typecheck --workspace=@confido/call-orchestrator`
Expected: clean.

```bash
git add services/call-orchestrator/src/routes/tasks-pull-recording.ts services/call-orchestrator/src/index.ts
git commit -m "feat(orchestrator): add Cloud Tasks recording-pull handler"
```

---

## Task 9: Orchestrator Dockerfile

**Files:**
- Create: `services/call-orchestrator/Dockerfile`
- Create: `services/call-orchestrator/.dockerignore`

- [ ] **Step 9.1: Dockerfile**

Create `services/call-orchestrator/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/call-orchestrator/package.json services/call-orchestrator/
RUN npm ci --workspace=@confido/shared --workspace=@confido/call-orchestrator --include-workspace-root
COPY packages/shared packages/shared
COPY services/call-orchestrator services/call-orchestrator
RUN npm run build --workspace=@confido/shared
RUN npm run build --workspace=@confido/call-orchestrator

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/services/call-orchestrator/dist ./services/call-orchestrator/dist
COPY --from=builder /app/services/call-orchestrator/package.json ./services/call-orchestrator/package.json
EXPOSE 8080
CMD ["node", "services/call-orchestrator/dist/index.js"]
```

Create `services/call-orchestrator/.dockerignore`:

```
node_modules
dist
.turbo
test
coverage
```

- [ ] **Step 9.2: Commit**

```bash
git add services/call-orchestrator/Dockerfile services/call-orchestrator/.dockerignore
git commit -m "chore(orchestrator): add Dockerfile"
```

---

## Task 10: pipecat-worker — config + secret loader

**Files:**
- Modify: `services/pipecat-worker/pyproject.toml`
- Create: `services/pipecat-worker/src/pipecat_worker/config.py`
- Create: `services/pipecat-worker/tests/test_config.py`

- [ ] **Step 10.1: Add runtime deps**

Modify `services/pipecat-worker/pyproject.toml`:

```toml
[project]
name = "pipecat-worker"
version = "0.0.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "websockets>=13",
  "pipecat-ai[deepgram,openai,elevenlabs]>=0.0.50",
  "supabase>=2.9",
  "google-cloud-secret-manager>=2.21",
  "httpx>=0.27",
  "pydantic>=2.9",
  "structlog>=24.4",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "pytest-asyncio>=0.24",
  "ruff>=0.6",
  "mypy>=1.11",
]
```

- [ ] **Step 10.2: Failing test**

Create `services/pipecat-worker/tests/test_config.py`:

```python
import pytest
from pipecat_worker.config import Config, _load_secret_value

def test_config_defaults_from_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "srv")
    monkeypatch.setenv("INTERNAL_SVC_TOKEN", "x" * 40)
    monkeypatch.setenv("PROVIDER_KEY_DEEPGRAM", "dg")
    monkeypatch.setenv("PROVIDER_KEY_OPENAI", "oai")
    monkeypatch.setenv("PROVIDER_KEY_ELEVENLABS", "el")
    cfg = Config.from_env()
    assert cfg.supabase_url == "https://x.supabase.co"
    assert cfg.provider_keys["deepgram"] == "dg"
    assert cfg.provider_keys["openai"] == "oai"
    assert cfg.provider_keys["elevenlabs"] == "el"

def test_config_missing_required(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        Config.from_env()
```

- [ ] **Step 10.3: Run fail**

Run: `cd services/pipecat-worker && uv pip install -e '.[dev]' && .venv/bin/pytest tests/test_config.py && cd ../..`
Expected: FAIL — module not found.

- [ ] **Step 10.4: Implement config.py**

Create `services/pipecat-worker/src/pipecat_worker/config.py`:

```python
from __future__ import annotations
import os
from dataclasses import dataclass
from typing import Any

REQUIRED = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "INTERNAL_SVC_TOKEN",
    "PROVIDER_KEY_DEEPGRAM",
    "PROVIDER_KEY_OPENAI",
    "PROVIDER_KEY_ELEVENLABS",
]

def _load_secret_value(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"Missing required env: {name}")
    return v

@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_role_key: str
    internal_svc_token: str
    provider_keys: dict[str, str]
    host: str
    port: int

    @classmethod
    def from_env(cls) -> "Config":
        for name in REQUIRED:
            if not os.environ.get(name):
                raise RuntimeError(f"Missing required env: {name}")
        return cls(
            supabase_url=os.environ["SUPABASE_URL"],
            supabase_service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
            internal_svc_token=os.environ["INTERNAL_SVC_TOKEN"],
            provider_keys={
                "deepgram": os.environ["PROVIDER_KEY_DEEPGRAM"],
                "openai": os.environ["PROVIDER_KEY_OPENAI"],
                "elevenlabs": os.environ["PROVIDER_KEY_ELEVENLABS"],
            },
            host=os.environ.get("HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", "8080")),
        )
```

- [ ] **Step 10.5: Run pass**

Run: `cd services/pipecat-worker && .venv/bin/pytest tests/test_config.py && cd ../..`
Expected: 2 PASS.

- [ ] **Step 10.6: Commit**

```bash
git add services/pipecat-worker/pyproject.toml services/pipecat-worker/src/pipecat_worker/config.py services/pipecat-worker/tests/test_config.py
git commit -m "feat(pipecat-worker): add config loader"
```

---

## Task 11: pipecat-worker — HMAC token verify

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/token.py`
- Create: `services/pipecat-worker/tests/test_token.py`

- [ ] **Step 11.1: Failing test**

Create `services/pipecat-worker/tests/test_token.py`:

```python
import base64
import hmac
import hashlib
import json
import time

import pytest

from pipecat_worker.token import verify_session_token, TokenInvalid

SECRET = "x" * 40

def _sign(payload: dict, secret: str, ttl: int) -> str:
    body = {**payload, "exp": int(time.time()) + ttl}
    body_b64 = base64.urlsafe_b64encode(json.dumps(body).encode()).rstrip(b"=").decode()
    mac = hmac.new(secret.encode(), body_b64.encode(), hashlib.sha256).digest()
    mac_b64 = base64.urlsafe_b64encode(mac).rstrip(b"=").decode()
    return f"{body_b64}.{mac_b64}"

def test_round_trip():
    t = _sign({"call_id": "c1", "tenant_id": "t1", "agent_id": "a1"}, SECRET, 60)
    p = verify_session_token(t, SECRET)
    assert p.call_id == "c1"
    assert p.tenant_id == "t1"
    assert p.agent_id == "a1"

def test_expired():
    t = _sign({"call_id": "c1", "tenant_id": "t1", "agent_id": "a1"}, SECRET, -1)
    with pytest.raises(TokenInvalid, match="expired"):
        verify_session_token(t, SECRET)

def test_tampered():
    t = _sign({"call_id": "c1", "tenant_id": "t1", "agent_id": "a1"}, SECRET, 60)
    with pytest.raises(TokenInvalid):
        verify_session_token(t[:-2] + "xx", SECRET)

def test_wrong_secret():
    t = _sign({"call_id": "c1", "tenant_id": "t1", "agent_id": "a1"}, SECRET, 60)
    with pytest.raises(TokenInvalid):
        verify_session_token(t, "y" * 40)
```

- [ ] **Step 11.2: Run fail**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_token.py`
Expected: FAIL.

- [ ] **Step 11.3: Implement token.py**

Create `services/pipecat-worker/src/pipecat_worker/token.py`:

```python
from __future__ import annotations
import base64
import hmac
import hashlib
import json
import time
from dataclasses import dataclass

class TokenInvalid(Exception):
    pass

@dataclass(frozen=True)
class SessionPayload:
    call_id: str
    tenant_id: str
    agent_id: str

def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)

def verify_session_token(token: str, secret: str) -> SessionPayload:
    try:
        body_b64, mac_b64 = token.split(".")
    except ValueError as e:
        raise TokenInvalid("malformed") from e
    expected = hmac.new(secret.encode(), body_b64.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64d(mac_b64), expected):
        raise TokenInvalid("signature mismatch")
    try:
        body = json.loads(_b64d(body_b64))
    except Exception as e:
        raise TokenInvalid("body not JSON") from e
    if body.get("exp", 0) < int(time.time()):
        raise TokenInvalid("expired")
    try:
        return SessionPayload(
            call_id=body["call_id"],
            tenant_id=body["tenant_id"],
            agent_id=body["agent_id"],
        )
    except KeyError as e:
        raise TokenInvalid(f"missing field: {e}") from e
```

- [ ] **Step 11.4: Run pass**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_token.py`
Expected: 4 PASS.

- [ ] **Step 11.5: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/token.py services/pipecat-worker/tests/test_token.py
git commit -m "feat(pipecat-worker): add session token verify"
```

---

## Task 12: pipecat-worker — Supabase client + event batch writer

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/supabase_client.py`
- Create: `services/pipecat-worker/src/pipecat_worker/events.py`
- Create: `services/pipecat-worker/tests/test_events.py`

- [ ] **Step 12.1: supabase_client.py**

Create `services/pipecat-worker/src/pipecat_worker/supabase_client.py`:

```python
from supabase import Client, create_client
from .config import Config

def make_client(cfg: Config) -> Client:
    return create_client(cfg.supabase_url, cfg.supabase_service_role_key)
```

- [ ] **Step 12.2: Failing test**

Create `services/pipecat-worker/tests/test_events.py`:

```python
import asyncio
from unittest.mock import MagicMock
from pipecat_worker.events import EventBatcher

def test_batcher_flushes_on_size():
    client = MagicMock()
    insert_mock = MagicMock()
    client.table.return_value.insert.return_value.execute = insert_mock
    batcher = EventBatcher(client, call_id="c1", batch_size=3, flush_interval_ms=10000)
    batcher.append("turn", {"text": "a"})
    batcher.append("turn", {"text": "b"})
    batcher.append("turn", {"text": "c"})
    asyncio.run(batcher._flush())
    assert client.table.call_args[0][0] == "call_events"
    inserted = client.table.return_value.insert.call_args[0][0]
    assert len(inserted) == 3
    assert all(e["call_id"] == "c1" for e in inserted)

def test_batcher_flushes_on_interval():
    client = MagicMock()
    batcher = EventBatcher(client, call_id="c1", batch_size=100, flush_interval_ms=50)
    batcher.append("turn", {"text": "a"})
    async def _run():
        await asyncio.sleep(0.1)
        await batcher.close()
    asyncio.run(_run())
    # One flush should have happened.
    assert client.table.return_value.insert.called
```

- [ ] **Step 12.3: Run fail**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_events.py`
Expected: FAIL.

- [ ] **Step 12.4: Implement events.py**

Create `services/pipecat-worker/src/pipecat_worker/events.py`:

```python
from __future__ import annotations
import asyncio
import time
from typing import Any
import structlog

log = structlog.get_logger()

class EventBatcher:
    def __init__(
        self,
        supabase_client,
        call_id: str,
        batch_size: int = 10,
        flush_interval_ms: int = 500,
    ) -> None:
        self._client = supabase_client
        self._call_id = call_id
        self._buf: list[dict[str, Any]] = []
        self._batch_size = batch_size
        self._flush_interval_s = flush_interval_ms / 1000
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._closed = False

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    def append(self, kind: str, payload: dict[str, Any]) -> None:
        self._buf.append({
            "call_id": self._call_id,
            "kind": kind,
            "payload": payload,
            "occurred_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })
        if len(self._buf) >= self._batch_size:
            asyncio.create_task(self._flush())

    async def _run(self) -> None:
        while not self._closed:
            await asyncio.sleep(self._flush_interval_s)
            await self._flush()

    async def _flush(self) -> None:
        async with self._lock:
            if not self._buf:
                return
            rows, self._buf = self._buf, []
        try:
            self._client.table("call_events").insert(rows).execute()
        except Exception as e:
            log.warning("event_batch_flush_failed", err=str(e), n=len(rows))

    async def close(self) -> None:
        self._closed = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._flush()
```

- [ ] **Step 12.5: Run pass**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_events.py`
Expected: 2 PASS.

- [ ] **Step 12.6: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/supabase_client.py services/pipecat-worker/src/pipecat_worker/events.py services/pipecat-worker/tests/test_events.py
git commit -m "feat(pipecat-worker): add supabase client + event batcher"
```

---

## Task 13: pipecat-worker — session builder (single-stack)

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/session.py`
- Create: `services/pipecat-worker/tests/test_session.py`

- [ ] **Step 13.1: Failing test**

Create `services/pipecat-worker/tests/test_session.py`:

```python
from pipecat_worker.session import build_pipeline_single_stack

def test_build_pipeline_returns_services():
    snapshot = {
        "system_prompt": "be terse",
        "first_message": "hi.",
        "stt_provider": "deepgram",
        "stt_config": {"model": "nova-2"},
        "llm_provider": "openai",
        "llm_config": {"model": "gpt-4o-mini"},
        "tts_provider": "elevenlabs",
        "tts_config": {"voice_id": "v1"},
    }
    creds = {"deepgram": "dg", "openai": "oai", "elevenlabs": "el"}
    stt, llm, tts, system_prompt, first_message = build_pipeline_single_stack(snapshot, creds)
    assert stt is not None
    assert llm is not None
    assert tts is not None
    assert system_prompt == "be terse"
    assert first_message == "hi."
```

- [ ] **Step 13.2: Run fail**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_session.py`
Expected: FAIL.

- [ ] **Step 13.3: Implement session.py**

Create `services/pipecat-worker/src/pipecat_worker/session.py`:

```python
from __future__ import annotations
from typing import Any

from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

def build_pipeline_single_stack(
    snapshot: dict[str, Any],
    creds: dict[str, str],
) -> tuple[Any, Any, Any, str, str]:
    """Plan B hardcodes Deepgram/OpenAI/ElevenLabs. Plan C replaces this with the registry."""
    if snapshot["stt_provider"] != "deepgram":
        raise ValueError("Plan B only supports deepgram STT")
    if snapshot["llm_provider"] != "openai":
        raise ValueError("Plan B only supports openai LLM")
    if snapshot["tts_provider"] != "elevenlabs":
        raise ValueError("Plan B only supports elevenlabs TTS")

    stt = DeepgramSTTService(
        api_key=creds["deepgram"],
        model=snapshot["stt_config"].get("model", "nova-2"),
    )
    llm = OpenAILLMService(
        api_key=creds["openai"],
        model=snapshot["llm_config"].get("model", "gpt-4o-mini"),
    )
    tts = ElevenLabsTTSService(
        api_key=creds["elevenlabs"],
        voice_id=snapshot["tts_config"]["voice_id"],
    )
    return stt, llm, tts, snapshot.get("system_prompt", ""), snapshot.get("first_message", "")
```

- [ ] **Step 13.4: Run pass**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_session.py`
Expected: PASS.

- [ ] **Step 13.5: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/session.py services/pipecat-worker/tests/test_session.py
git commit -m "feat(pipecat-worker): add single-stack session builder"
```

---

## Task 14: pipecat-worker — WS handler

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/ws.py`

- [ ] **Step 14.1: Implement ws.py**

Create `services/pipecat-worker/src/pipecat_worker/ws.py`:

```python
from __future__ import annotations
import json
import structlog
from fastapi import WebSocket, WebSocketDisconnect

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.transports.serializers.twilio import TwilioFrameSerializer
from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams,
)
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext

from .config import Config
from .token import verify_session_token, TokenInvalid
from .session import build_pipeline_single_stack
from .events import EventBatcher
from .supabase_client import make_client

log = structlog.get_logger()

async def handle_ws(ws: WebSocket, cfg: Config) -> None:
    token = ws.query_params.get("token", "")
    try:
        payload = verify_session_token(token, cfg.internal_svc_token)
    except TokenInvalid as e:
        log.warning("token_invalid", err=str(e))
        await ws.close(code=4401)
        return

    supabase = make_client(cfg)
    call_row = (
        supabase.table("calls")
        .select("id, agent_version_snapshot")
        .eq("id", payload.call_id)
        .single()
        .execute()
    )
    if not call_row.data:
        log.error("call_not_found", call_id=payload.call_id)
        await ws.close(code=4404)
        return

    snapshot = call_row.data["agent_version_snapshot"]
    batcher = EventBatcher(supabase, call_id=payload.call_id)
    batcher.start()

    try:
        stt, llm, tts, system_prompt, first_message = build_pipeline_single_stack(
            snapshot, cfg.provider_keys
        )
    except Exception as e:
        log.error("pipeline_build_failed", err=str(e))
        supabase.table("calls").update(
            {"status": "failed", "end_reason": "error"}
        ).eq("id", payload.call_id).execute()
        await ws.close(code=4500)
        return

    await ws.accept()
    transport = FastAPIWebsocketTransport(
        websocket=ws,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=TwilioFrameSerializer(stream_sid=""),
        ),
    )

    context = OpenAILLMContext(
        messages=[{"role": "system", "content": system_prompt}],
    )
    context_agg = llm.create_context_aggregator(context)

    pipeline = Pipeline([
        transport.input(),
        stt,
        context_agg.user(),
        llm,
        tts,
        transport.output(),
        context_agg.assistant(),
    ])

    @stt.event_handler("on_transcription")
    async def _on_transcription(service, frame):
        batcher.append("transcription", {"text": frame.text, "final": frame.is_final})

    task = PipelineTask(pipeline)

    if first_message:
        # Kick off with the agent's greeting.
        await task.queue_frame(
            transport.output().create_text_frame(first_message)  # adapt if lib surface differs
        )

    runner = PipelineRunner()
    try:
        await runner.run(task)
    except WebSocketDisconnect:
        log.info("ws_disconnected", call_id=payload.call_id)
    except Exception as e:
        log.exception("pipeline_error", err=str(e))
        supabase.table("calls").update(
            {"status": "failed", "end_reason": "error"}
        ).eq("id", payload.call_id).execute()
    finally:
        await batcher.close()
        # Finalize transcript — assistant message log lives in the context aggregator.
        transcript = {
            "text": "",
            "turns": context.messages,
        }
        # Best-effort in-process retry of the final update.
        for _ in range(3):
            try:
                supabase.table("calls").update(
                    {"transcript_json": transcript, "ended_at": "now()"}
                ).eq("id", payload.call_id).execute()
                break
            except Exception as e:
                log.warning("finalize_retry", err=str(e))
```

- [ ] **Step 14.2: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/ws.py
git commit -m "feat(pipecat-worker): add WS handler with pipeline + finalize"
```

---

## Task 15: pipecat-worker — FastAPI app

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/main.py`

- [ ] **Step 15.1: Implement main.py**

Create `services/pipecat-worker/src/pipecat_worker/main.py`:

```python
from __future__ import annotations
from fastapi import FastAPI, WebSocket
from .config import Config
from .ws import handle_ws

cfg = Config.from_env()
app = FastAPI()

@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "pipecat-worker"}

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await handle_ws(websocket, cfg)
```

- [ ] **Step 15.2: Smoke boot**

Run:
```
cd services/pipecat-worker
SUPABASE_URL=https://x.supabase.co SUPABASE_SERVICE_ROLE_KEY=s INTERNAL_SVC_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx PROVIDER_KEY_DEEPGRAM=a PROVIDER_KEY_OPENAI=b PROVIDER_KEY_ELEVENLABS=c \
  .venv/bin/uvicorn pipecat_worker.main:app --host 127.0.0.1 --port 8081 &
sleep 2
curl http://127.0.0.1:8081/health
kill %1
cd ../..
```
Expected: `{"ok":true,"service":"pipecat-worker"}`.

- [ ] **Step 15.3: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/main.py
git commit -m "feat(pipecat-worker): add FastAPI app"
```

---

## Task 16: pipecat-worker Dockerfile

**Files:**
- Create: `services/pipecat-worker/Dockerfile`
- Create: `services/pipecat-worker/.dockerignore`

- [ ] **Step 16.1: Dockerfile**

Create `services/pipecat-worker/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS builder
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY services/pipecat-worker/pyproject.toml ./pyproject.toml
COPY services/pipecat-worker/src ./src
RUN uv pip install --system .

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY services/pipecat-worker/src /app/src
EXPOSE 8080
CMD ["uvicorn", "pipecat_worker.main:app", "--host", "0.0.0.0", "--port", "8080", "--app-dir", "src"]
```

Create `services/pipecat-worker/.dockerignore`:

```
.venv
__pycache__
.pytest_cache
.ruff_cache
tests
```

- [ ] **Step 16.2: Commit**

```bash
git add services/pipecat-worker/Dockerfile services/pipecat-worker/.dockerignore
git commit -m "chore(pipecat-worker): add Dockerfile"
```

---

## Task 17: Supabase Edge Function — pull-twilio-recording

**Files:**
- Create: `supabase/functions/pull-twilio-recording/deno.json`
- Create: `supabase/functions/pull-twilio-recording/index.ts`

- [ ] **Step 17.1: deno.json**

Create `supabase/functions/pull-twilio-recording/deno.json`:

```json
{
  "imports": {
    "supabase": "npm:@supabase/supabase-js@^2.47.0"
  }
}
```

- [ ] **Step 17.2: index.ts**

Create `supabase/functions/pull-twilio-recording/index.ts`:

```typescript
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'supabase';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const authHeader = req.headers.get('authorization') ?? '';
  const expectedAuth = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`;
  if (authHeader !== expectedAuth) return new Response('forbidden', { status: 403 });

  const { callId, recordingSid } = (await req.json()) as { callId: string; recordingSid: string };
  if (!callId || !recordingSid) return new Response('bad request', { status: 400 });

  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const basic = btoa(`${twilioSid}:${twilioToken}`);
  const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Recordings/${recordingSid}.mp3`;

  const twilioResp = await fetch(mediaUrl, { headers: { Authorization: `Basic ${basic}` } });
  if (!twilioResp.ok) {
    return new Response(`twilio fetch failed: ${twilioResp.status}`, { status: 502 });
  }
  const audio = await twilioResp.arrayBuffer();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: call, error: callErr } = await supabase
    .from('calls')
    .select('id, tenant_id, started_at')
    .eq('id', callId)
    .single();
  if (callErr || !call) return new Response('call not found', { status: 404 });

  const started = new Date(call.started_at);
  const key = `${call.tenant_id}/${started.getUTCFullYear()}/${String(
    started.getUTCMonth() + 1,
  ).padStart(2, '0')}/${String(started.getUTCDate()).padStart(2, '0')}/${call.id}.mp3`;

  const { error: uploadErr } = await supabase.storage
    .from('call-recordings')
    .upload(key, new Uint8Array(audio), { contentType: 'audio/mpeg', upsert: true });
  if (uploadErr) return new Response(`upload failed: ${uploadErr.message}`, { status: 500 });

  await supabase
    .from('calls')
    .update({ recording_object_path: key, recording_pulled_at: new Date().toISOString() })
    .eq('id', callId);

  return new Response(JSON.stringify({ ok: true, key }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 17.3: Deploy Edge Function**

Run: `supabase functions deploy pull-twilio-recording --no-verify-jwt`
Expected: deployment summary with URL printed.

Note: `--no-verify-jwt` skips Supabase's built-in JWT check; we enforce auth manually using the service role Bearer token (matches the existing `Authorization` header check).

- [ ] **Step 17.4: Set function secrets**

Run: `supabase secrets set TWILIO_ACCOUNT_SID=<sid> TWILIO_AUTH_TOKEN=<token>` (operator fills in real values).

- [ ] **Step 17.5: Commit**

```bash
git add supabase/functions/pull-twilio-recording
git commit -m "feat(edge-fn): add pull-twilio-recording"
```

---

## Task 18: End-to-end local smoke test

**Files:**
- Create: `scripts/local-smoke-inbound.sh`

- [ ] **Step 18.1: Write smoke script**

Create `scripts/local-smoke-inbound.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Local smoke: insert a tenant, agent, and twilio_number, then POST a forged Twilio
# /voice/inbound request with a correctly-signed signature and assert we get TwiML back.

PORT=8080
TWILIO_TOKEN="test-twilio-auth-token"

export PUBLIC_URL=http://localhost:$PORT
export WORKER_WS_URL=wss://worker.local/ws
export SUPABASE_URL=http://localhost:54321
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output json | jq -r .SERVICE_ROLE_KEY)
export TWILIO_AUTH_TOKEN=$TWILIO_TOKEN
export TWILIO_SIGNING_KEY=not-used
export INTERNAL_SVC_TOKEN=$(printf 'x%.0s' {1..40})
export GCP_PROJECT=clinical-workflow-lakeway
export RECORDING_PULL_HANDLER_URL=http://localhost:$PORT/tasks/pull-recording

# Seed.
supabase db execute --local "
  insert into tenants (id, name) values ('11111111-1111-1111-1111-111111111111','t') on conflict do nothing;
  insert into agents (id, tenant_id, name, stt_provider, llm_provider, tts_provider, tts_config)
    values ('22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111',
            'smoke','deepgram','openai','elevenlabs','{\"voice_id\":\"v1\"}')
    on conflict do nothing;
  insert into twilio_numbers (tenant_id, agent_id, phone_number, direction)
    values ('11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
            '+15557654321','inbound')
    on conflict do nothing;
"

# Start orchestrator.
npm run dev --workspace=@confido/call-orchestrator &
ORCH_PID=$!
trap "kill $ORCH_PID" EXIT
sleep 3

# Compute Twilio signature over "PUBLIC_URL/voice/inbound" + sorted params concatenation.
URL="http://localhost:$PORT/voice/inbound"
CALL_SID="CAtest0000000000000000000000000000"
FROM="+15551234567"
TO="+15557654321"
CONCAT="CallSid${CALL_SID}From${FROM}To${TO}"
SIG=$(printf "%s%s" "$URL" "$CONCAT" | openssl dgst -sha1 -hmac "$TWILIO_TOKEN" -binary | base64)

RESP=$(curl -sS -X POST "$URL" \
  -H "X-Twilio-Signature: $SIG" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "CallSid=$CALL_SID" \
  --data-urlencode "From=$FROM" \
  --data-urlencode "To=$TO")

echo "$RESP"
echo "$RESP" | grep -q "<Connect>" || { echo "no TwiML <Connect>"; exit 1; }
echo "$RESP" | grep -q "wss://worker.local/ws" || { echo "no WS URL"; exit 1; }

supabase db execute --local "select status, twilio_call_sid from calls where twilio_call_sid='$CALL_SID'" | tee /tmp/call.out
grep -q "in_progress" /tmp/call.out || { echo "call row not in progress"; exit 1; }

echo "OK"
```

Make executable: `chmod +x scripts/local-smoke-inbound.sh`

- [ ] **Step 18.2: Run it**

Prereq: `supabase start` is up; migrations applied.
Run: `bash scripts/local-smoke-inbound.sh`
Expected: prints TwiML response, ends with `OK`.

- [ ] **Step 18.3: Commit**

```bash
git add scripts/local-smoke-inbound.sh
git commit -m "test(orchestrator): add local inbound smoke script"
```

---

## Task 19: Plan B exit gate

- [ ] **Step 19.1: All unit tests green**

Run: `npm run test`
Run: `(cd services/pipecat-worker && .venv/bin/pytest)`
Expected: all pass.

- [ ] **Step 19.2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 19.3: Push**

```bash
git push origin main
```

---

## What's done after Plan B

- `call-orchestrator` runs a Fastify service that verifies Twilio signatures, upserts `calls` rows idempotently, snapshots the agent config, mints a signed session token, and returns TwiML to connect Twilio to the worker WS URL.
- `pipecat-worker` runs a FastAPI app that validates the session token, builds a hardcoded Deepgram/OpenAI/ElevenLabs pipecat pipeline, writes batched `call_events`, and finalizes the transcript on disconnect.
- Recording pull is wired: `/voice/status` enqueues a Cloud Task; the handler calls the Supabase Edge Function; the function streams the recording from Twilio directly into Supabase Storage.
- Local smoke script exercises the whole flow against a locally-running `supabase start`.

**Next:** Plan C replaces the hardcoded single-stack session builder with a provider registry and adds the rest of the day-1 providers, agent versioning publish flow, and failure-mode handling.
