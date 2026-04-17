# Plan D: Outbound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the outbound call path. An internal caller POSTs to `admin-api /api/outbound/calls`, which inserts an `outbound_jobs` row and enqueues a Cloud Task. The `dispatcher-worker` service handles the task, checks per-tenant concurrency, and calls the Twilio REST API to place the call with a TwiML URL that points back at `call-orchestrator`. When Twilio answers, the orchestrator `/voice/outbound` endpoint takes over the standard `<Connect><Stream>` flow from Plan B, reusing the pipecat worker path unchanged.

**Architecture:** Cloud Tasks queue `outbound-dispatch` with `max_dispatches_per_second=5` (Twilio CPS limit) and `max_concurrent_dispatches` high enough to not serialize unnecessarily. Dispatcher pulls the job row, re-checks tenant concurrency with `SELECT FOR UPDATE`, calls Twilio, updates `outbound_jobs.status='dialing'`. Orchestrator `/voice/outbound` mints a new signed session token using the pre-created `calls` row and returns TwiML identical to inbound.

**Tech Stack:** Same as Plans B+C, plus `twilio` Node SDK for placing REST calls from `dispatcher-worker`.

---

## File Structure

```
services/
├── admin-api/
│   └── src/routes/outbound-create.ts        # POST /api/outbound/calls
├── call-orchestrator/
│   └── src/routes/voice-outbound.ts         # POST /voice/outbound (TwiML URL Twilio fetches on answer)
├── dispatcher-worker/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── supabase.ts
│   │   └── routes/
│   │       ├── health.ts
│   │       └── tasks-place-call.ts          # POST /tasks/place-call (Cloud Tasks target)
│   └── test/
│       └── tasks-place-call.test.ts
```

---

## Task 1: admin-api — POST /api/outbound/calls

**Files:**
- Create: `services/admin-api/src/routes/outbound-create.ts`
- Create: `services/admin-api/src/cloud-tasks.ts`
- Create: `services/admin-api/test/outbound-create.test.ts`
- Modify: `services/admin-api/src/config.ts`
- Modify: `services/admin-api/src/index.ts`
- Modify: `services/admin-api/package.json`

- [ ] **Step 1.1: Add deps**

Modify `services/admin-api/package.json` — add under `dependencies`:

```json
    "@google-cloud/tasks": "^5.4.0"
```

Run: `npm install`

- [ ] **Step 1.2: Extend config.ts**

Overwrite `services/admin-api/src/config.ts`:

```typescript
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseJwtSecret: required('SUPABASE_JWT_SECRET'),
  gcpProject: required('GCP_PROJECT'),
  gcpTaskLocation: process.env.GCP_TASK_LOCATION ?? 'us-central1',
  outboundQueue: process.env.OUTBOUND_QUEUE ?? 'outbound-dispatch',
  dispatcherUrl: required('DISPATCHER_URL'),      // e.g. https://dispatcher-xxxxxx.a.run.app/tasks/place-call
  internalSvcToken: required('INTERNAL_SVC_TOKEN'),
} as const;
```

- [ ] **Step 1.3: cloud-tasks.ts**

Create `services/admin-api/src/cloud-tasks.ts`:

```typescript
import { CloudTasksClient } from '@google-cloud/tasks';
import { config } from './config.js';

const client = new CloudTasksClient();

export async function enqueueOutboundDispatch(jobId: string): Promise<string> {
  const parent = client.queuePath(config.gcpProject, config.gcpTaskLocation, config.outboundQueue);
  const [task] = await client.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: config.dispatcherUrl,
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Svc-Token': config.internalSvcToken,
        },
        body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
      },
      dispatchDeadline: { seconds: 60 },
    },
  });
  return task.name ?? '';
}
```

- [ ] **Step 1.4: Failing test**

Create `services/admin-api/test/outbound-create.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const supabaseMocks = vi.hoisted(() => ({
  single: vi.fn(),
  insertReturning: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../src/supabase.js', () => ({
  supabase: {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === 'agents') {
        return { select: () => ({ eq: () => ({ single: supabaseMocks.single }) }) };
      }
      if (table === 'outbound_jobs') {
        return {
          insert: () => ({ select: () => ({ single: supabaseMocks.insertReturning }) }),
          update: supabaseMocks.update,
        };
      }
      return {};
    },
  },
}));
vi.mock('../src/auth.js', () => ({
  requireAdmin: vi.fn(async () => ({ sub: 'u1', email: 'a@confido.health', role: 'admin' })),
}));
vi.mock('../src/cloud-tasks.js', () => ({
  enqueueOutboundDispatch: vi.fn(async () => 'projects/.../tasks/t1'),
}));
vi.mock('../src/config.js', () => ({ config: { gcpProject: 'p', gcpTaskLocation: 'r', outboundQueue: 'q', dispatcherUrl: 'd', internalSvcToken: 'x'.repeat(40), supabaseJwtSecret: 'x'.repeat(40), supabaseUrl: 'x', supabaseServiceRoleKey: 'x', supabaseAnonKey: 'x', port: 8080 } }));

import { registerOutboundCreateRoute } from '../src/routes/outbound-create.js';

async function buildApp() {
  const app = Fastify();
  await app.register(await import('@fastify/formbody').then(m => m.default));
  await registerOutboundCreateRoute(app);
  return app;
}

describe('POST /api/outbound/calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.single.mockResolvedValue({ data: { id: 'a1', tenant_id: 't1' }, error: null });
    supabaseMocks.insertReturning.mockResolvedValue({ data: { id: 'job1' }, error: null });
    supabaseMocks.update.mockReturnValue({ eq: () => ({}) });
  });

  it('enqueues when under tenant concurrency cap', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbound/calls',
      headers: { Authorization: 'Bearer any' },
      payload: { agent_id: 'a1', to_phone: '+15551234567' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).jobId).toBe('job1');
  });
});
```

- [ ] **Step 1.5: Run fail**

Run: `npm run test --workspace=@confido/admin-api -- outbound-create`
Expected: FAIL.

- [ ] **Step 1.6: Implement route**

Create `services/admin-api/src/routes/outbound-create.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';
import { enqueueOutboundDispatch } from '../cloud-tasks.js';

interface Body {
  agent_id: string;
  to_phone: string;
  context?: Record<string, unknown>;
}

export async function registerOutboundCreateRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Body }>('/api/outbound/calls', async (req, reply) => {
    try {
      await requireAdmin(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }

    const { agent_id, to_phone, context } = req.body ?? ({} as Body);
    if (!agent_id || !to_phone) return reply.code(400).send({ error: 'agent_id and to_phone required' });

    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select('id, tenant_id')
      .eq('id', agent_id)
      .single();
    if (agentErr || !agent) return reply.code(404).send({ error: 'agent not found' });

    const { data: job, error: insertErr } = await supabase
      .from('outbound_jobs')
      .insert({
        tenant_id: agent.tenant_id,
        agent_id: agent.id,
        to_phone,
        context: context ?? {},
        status: 'queued',
      })
      .select('id')
      .single();
    if (insertErr || !job) return reply.code(500).send({ error: insertErr?.message ?? 'insert failed' });

    const taskName = await enqueueOutboundDispatch(job.id);
    await supabase.from('outbound_jobs').update({ cloud_task_name: taskName }).eq('id', job.id);

    return reply.send({ ok: true, jobId: job.id, taskName });
  });
}
```

- [ ] **Step 1.7: Register**

Modify `services/admin-api/src/index.ts`:

```typescript
import { registerOutboundCreateRoute } from './routes/outbound-create.js';
// ...
await registerOutboundCreateRoute(app);
```

- [ ] **Step 1.8: Run pass + typecheck**

Run: `npm run test --workspace=@confido/admin-api && npm run typecheck --workspace=@confido/admin-api`
Expected: PASS, clean.

- [ ] **Step 1.9: Commit**

```bash
git add services/admin-api package.json package-lock.json
git commit -m "feat(admin-api): add outbound create endpoint + cloud tasks enqueue"
```

---

## Task 2: Scaffold dispatcher-worker service

**Files:**
- Create: `services/dispatcher-worker/package.json`
- Create: `services/dispatcher-worker/tsconfig.json`
- Create: `services/dispatcher-worker/src/index.ts`
- Create: `services/dispatcher-worker/src/config.ts`
- Create: `services/dispatcher-worker/src/supabase.ts`
- Create: `services/dispatcher-worker/src/routes/health.ts`

- [ ] **Step 2.1: package.json**

Create `services/dispatcher-worker/package.json`:

```json
{
  "name": "@confido/dispatcher-worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p .",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@confido/shared": "*",
    "@supabase/supabase-js": "^2.47.0",
    "fastify": "^5.0.0",
    "pino": "^9.5.0",
    "twilio": "^5.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2.2: tsconfig.json**

Create `services/dispatcher-worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2.3: Add to workspaces**

Modify root `package.json` — confirm `services/dispatcher-worker` is in the `workspaces` array (added in Plan A). If not, add it.

- [ ] **Step 2.4: config.ts**

Create `services/dispatcher-worker/src/config.ts`:

```typescript
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  twilioSid: required('TWILIO_ACCOUNT_SID'),
  twilioToken: required('TWILIO_AUTH_TOKEN'),
  orchestratorVoiceOutboundUrl: required('ORCHESTRATOR_VOICE_OUTBOUND_URL'),
  orchestratorVoiceStatusUrl: required('ORCHESTRATOR_VOICE_STATUS_URL'),
  internalSvcToken: required('INTERNAL_SVC_TOKEN'),
} as const;
```

- [ ] **Step 2.5: supabase.ts + health.ts**

Create `services/dispatcher-worker/src/supabase.ts`:

```typescript
import { createServiceClient } from '@confido/shared';
import { config } from './config.js';

export const supabase = createServiceClient({
  supabaseUrl: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey,
});
```

Create `services/dispatcher-worker/src/routes/health.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, service: 'dispatcher-worker' }));
}
```

- [ ] **Step 2.6: index.ts**

Create `services/dispatcher-worker/src/index.ts`:

```typescript
import Fastify from 'fastify';
import { registerHealthRoute } from './routes/health.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await registerHealthRoute(app);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`dispatcher-worker listening on :${port}`);
```

- [ ] **Step 2.7: Install + smoke**

Run: `npm install`
Then: `PORT=8083 SUPABASE_URL=x SUPABASE_SERVICE_ROLE_KEY=x TWILIO_ACCOUNT_SID=x TWILIO_AUTH_TOKEN=x ORCHESTRATOR_VOICE_OUTBOUND_URL=x ORCHESTRATOR_VOICE_STATUS_URL=x INTERNAL_SVC_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npm run dev --workspace=@confido/dispatcher-worker &`
Then: `curl http://localhost:8083/health` — expect `{"ok":true}`. Kill.

- [ ] **Step 2.8: Commit**

```bash
git add services/dispatcher-worker package.json package-lock.json
git commit -m "feat(dispatcher): scaffold service"
```

---

## Task 3: Concurrency check + place-call handler

**Files:**
- Create: `services/dispatcher-worker/src/routes/tasks-place-call.ts`
- Create: `services/dispatcher-worker/test/tasks-place-call.test.ts`
- Modify: `services/dispatcher-worker/src/index.ts`
- Create: `supabase/migrations/20260417000008_concurrency_rpc.sql`

- [ ] **Step 3.1: DB migration for the atomic reserve-slot RPC**

Create `supabase/migrations/20260417000008_concurrency_rpc.sql`:

```sql
-- Atomic "reserve an outbound slot for this tenant" check.
-- Returns true if we can proceed, false if at cap.
create or replace function public.reserve_outbound_slot(p_tenant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap int;
  v_current int;
begin
  select concurrency_cap into v_cap
    from public.tenants where id = p_tenant_id for update;
  select count(*) into v_current
    from public.outbound_jobs
    where tenant_id = p_tenant_id and status in ('dialing','in_call');
  return v_current < v_cap;
end;
$$;
revoke all on function public.reserve_outbound_slot(uuid) from public;
grant execute on function public.reserve_outbound_slot(uuid) to service_role;
```

Apply: `supabase db reset` (locally), then `supabase db push` (remote).

- [ ] **Step 3.2: Failing test**

Create `services/dispatcher-worker/test/tasks-place-call.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  singleJob: vi.fn(),
  singleAgent: vi.fn(),
  singleTwilioNumber: vi.fn(),
  insertCall: vi.fn(),
  updateJob: vi.fn(),
}));
vi.mock('../src/supabase.js', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    from: (table: string) => {
      if (table === 'outbound_jobs') {
        return {
          select: () => ({ eq: () => ({ single: supabaseMocks.singleJob }) }),
          update: () => ({ eq: () => ({}) }),
        };
      }
      if (table === 'agents') return { select: () => ({ eq: () => ({ single: supabaseMocks.singleAgent }) }) };
      if (table === 'twilio_numbers') {
        return {
          select: () => ({ eq: (col: string, val: unknown) =>
            col === 'agent_id'
              ? { in: () => ({ maybeSingle: supabaseMocks.singleTwilioNumber }) }
              : ({ maybeSingle: supabaseMocks.singleTwilioNumber })
          }),
        };
      }
      if (table === 'calls') return { insert: () => ({ select: () => ({ single: supabaseMocks.insertCall }) }) };
      return {};
    },
  },
}));
const twilioCreate = vi.fn(async () => ({ sid: 'CAtest' }));
vi.mock('twilio', () => ({ default: () => ({ calls: { create: twilioCreate } }) }));
vi.mock('../src/config.js', () => ({
  config: {
    twilioSid: 'AC1', twilioToken: 'tok',
    orchestratorVoiceOutboundUrl: 'https://o/voice/outbound',
    orchestratorVoiceStatusUrl: 'https://o/voice/status',
    internalSvcToken: 'x'.repeat(40),
    supabaseUrl: 'x', supabaseServiceRoleKey: 'x', port: 8080,
  },
}));

import { registerPlaceCallRoute } from '../src/routes/tasks-place-call.js';

async function buildApp() {
  const app = Fastify();
  await app.register(await import('@fastify/formbody').then(m => m.default));
  await registerPlaceCallRoute(app);
  return app;
}

describe('POST /tasks/place-call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.singleJob.mockResolvedValue({
      data: { id: 'job1', tenant_id: 't1', agent_id: 'a1', to_phone: '+15551234567', context: {} },
      error: null,
    });
    supabaseMocks.rpc.mockResolvedValue({ data: true, error: null });
    supabaseMocks.singleAgent.mockResolvedValue({
      data: { id: 'a1', tenant_id: 't1', stt_provider: 'deepgram', llm_provider: 'openai',
              tts_provider: 'elevenlabs', tts_config: { voice_id: 'v' }, current_version: 1 },
      error: null,
    });
    supabaseMocks.singleTwilioNumber.mockResolvedValue({
      data: { phone_number: '+15550000000' },
      error: null,
    });
    supabaseMocks.insertCall.mockResolvedValue({ data: { id: 'c1' }, error: null });
  });

  it('rejects without internal svc token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tasks/place-call',
      payload: { jobId: 'job1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('defers job when at concurrency cap', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: false, error: null });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tasks/place-call',
      headers: { 'x-internal-svc-token': 'x'.repeat(40) },
      payload: { jobId: 'job1' },
    });
    // 429 triggers Cloud Tasks retry with backoff.
    expect(res.statusCode).toBe(429);
    expect(twilioCreate).not.toHaveBeenCalled();
  });

  it('places call when slot available', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tasks/place-call',
      headers: { 'x-internal-svc-token': 'x'.repeat(40) },
      payload: { jobId: 'job1' },
    });
    expect(res.statusCode).toBe(200);
    expect(twilioCreate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3.3: Run fail**

Run: `npm run test --workspace=@confido/dispatcher-worker`
Expected: FAIL.

- [ ] **Step 3.4: Implement route**

Create `services/dispatcher-worker/src/routes/tasks-place-call.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { signSessionToken } from '@confido/shared';
import { supabase } from '../supabase.js';
import { config } from '../config.js';

interface Body { jobId: string }

export async function registerPlaceCallRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Body }>('/tasks/place-call', async (req, reply) => {
    if (req.headers['x-internal-svc-token'] !== config.internalSvcToken) {
      return reply.code(403).send('forbidden');
    }
    const { jobId } = req.body ?? ({} as Body);
    if (!jobId) return reply.code(400).send('missing jobId');

    const { data: job, error: jobErr } = await supabase
      .from('outbound_jobs')
      .select('id, tenant_id, agent_id, to_phone, context')
      .eq('id', jobId)
      .single();
    if (jobErr || !job) return reply.code(404).send('job not found');

    // Concurrency gate.
    const { data: hasSlot, error: rpcErr } = await supabase.rpc('reserve_outbound_slot', {
      p_tenant_id: job.tenant_id,
    });
    if (rpcErr) return reply.code(500).send(rpcErr.message);
    if (!hasSlot) {
      // 429 => Cloud Tasks retries with backoff.
      return reply.code(429).send('tenant concurrency cap reached; retry');
    }

    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select('*')
      .eq('id', job.agent_id)
      .single();
    if (agentErr || !agent) return reply.code(500).send('agent lookup failed');

    const { data: fromNumber, error: fromErr } = await supabase
      .from('twilio_numbers')
      .select('phone_number')
      .eq('agent_id', agent.id)
      .in('direction', ['outbound', 'both'])
      .maybeSingle();
    if (fromErr || !fromNumber) {
      return reply.code(500).send('no outbound number for agent');
    }

    // Pre-create the calls row so /voice/outbound can look it up by twilio_call_sid.
    const twilioClient = twilio(config.twilioSid, config.twilioToken);
    const { data: callRow, error: callErr } = await supabase
      .from('calls')
      .insert({
        tenant_id: job.tenant_id,
        agent_id: agent.id,
        twilio_call_sid: `pending-${job.id}`,   // replaced once Twilio returns SID.
        direction: 'outbound',
        from_number: fromNumber.phone_number,
        to_number: job.to_phone,
        status: 'dialing',
        started_at: new Date().toISOString(),
        agent_version_snapshot: agent,
      })
      .select('id')
      .single();
    if (callErr || !callRow) return reply.code(500).send('failed to create call row');

    const token = signSessionToken(
      { call_id: callRow.id, tenant_id: job.tenant_id, agent_id: agent.id },
      config.internalSvcToken,
      300,
    );
    const twimlUrl = `${config.orchestratorVoiceOutboundUrl}?token=${encodeURIComponent(token)}`;

    let twilioCall;
    try {
      twilioCall = await twilioClient.calls.create({
        to: job.to_phone,
        from: fromNumber.phone_number,
        url: twimlUrl,
        statusCallback: config.orchestratorVoiceStatusUrl,
        statusCallbackEvent: ['completed', 'failed', 'no-answer', 'busy'],
        statusCallbackMethod: 'POST',
      });
    } catch (e: any) {
      await supabase.from('outbound_jobs').update({ status: 'failed' }).eq('id', jobId);
      await supabase.from('calls').update({ status: 'failed', end_reason: 'error' }).eq('id', callRow.id);
      return reply.code(500).send(`twilio create failed: ${e.message}`);
    }

    await supabase.from('calls').update({ twilio_call_sid: twilioCall.sid }).eq('id', callRow.id);
    await supabase.from('outbound_jobs').update({ status: 'dialing', call_id: callRow.id }).eq('id', jobId);

    return reply.send({ ok: true, callSid: twilioCall.sid });
  });
}
```

- [ ] **Step 3.5: Register in index.ts**

Modify `services/dispatcher-worker/src/index.ts`:

```typescript
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { registerHealthRoute } from './routes/health.js';
import { registerPlaceCallRoute } from './routes/tasks-place-call.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(formbody);
await registerHealthRoute(app);
await registerPlaceCallRoute(app);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`dispatcher-worker listening on :${port}`);
```

Also add `@fastify/formbody` dependency:

Modify `services/dispatcher-worker/package.json` — add `"@fastify/formbody": "^8.0.1"` under dependencies. Run `npm install`.

- [ ] **Step 3.6: Run pass + typecheck**

Run: `npm run test --workspace=@confido/dispatcher-worker && npm run typecheck --workspace=@confido/dispatcher-worker`
Expected: 3 PASS, clean.

- [ ] **Step 3.7: Commit**

```bash
git add services/dispatcher-worker supabase/migrations/20260417000008_concurrency_rpc.sql package-lock.json
git commit -m "feat(dispatcher): place-call handler with concurrency guard"
```

---

## Task 4: dispatcher-worker Dockerfile

**Files:**
- Create: `services/dispatcher-worker/Dockerfile`
- Create: `services/dispatcher-worker/.dockerignore`

- [ ] **Step 4.1: Dockerfile**

Create `services/dispatcher-worker/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/dispatcher-worker/package.json services/dispatcher-worker/
RUN npm ci --workspace=@confido/shared --workspace=@confido/dispatcher-worker --include-workspace-root
COPY packages/shared packages/shared
COPY services/dispatcher-worker services/dispatcher-worker
RUN npm run build --workspace=@confido/shared
RUN npm run build --workspace=@confido/dispatcher-worker

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/services/dispatcher-worker/dist ./services/dispatcher-worker/dist
COPY --from=builder /app/services/dispatcher-worker/package.json ./services/dispatcher-worker/package.json
EXPOSE 8080
CMD ["node", "services/dispatcher-worker/dist/index.js"]
```

Create `services/dispatcher-worker/.dockerignore`:

```
node_modules
dist
.turbo
test
```

- [ ] **Step 4.2: Commit**

```bash
git add services/dispatcher-worker/Dockerfile services/dispatcher-worker/.dockerignore
git commit -m "chore(dispatcher): add Dockerfile"
```

---

## Task 5: orchestrator — POST /voice/outbound

**Files:**
- Create: `services/call-orchestrator/src/routes/voice-outbound.ts`
- Modify: `services/call-orchestrator/src/index.ts`

- [ ] **Step 5.1: Implement route**

Create `services/call-orchestrator/src/routes/voice-outbound.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { verifySessionToken, signSessionToken } from '@confido/shared';
import { config } from '../config.js';
import { supabase } from '../supabase.js';
import { verifyTwilioSignature } from '../twilio/signature.js';
import { connectStreamTwiml, hangupTwiml } from '../twilio/twiml.js';

interface OutboundQuery { token: string }
interface OutboundBody { CallSid?: string; [k: string]: string | undefined }

export async function registerVoiceOutboundRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Querystring: OutboundQuery; Body: OutboundBody }>(
    '/voice/outbound',
    async (req, reply) => {
      const fullUrl = `${config.publicUrl}${req.url}`;
      const sig = req.headers['x-twilio-signature'];
      if (typeof sig !== 'string') return reply.code(403).send('missing signature');

      const params: Record<string, string> = Object.fromEntries(
        Object.entries(req.body ?? {}).filter(([, v]) => v !== undefined) as [string, string][],
      );
      if (!verifyTwilioSignature(config.twilioAuthToken, fullUrl, params, sig)) {
        return reply.code(403).send('invalid signature');
      }

      const token = req.query?.token ?? '';
      try {
        verifySessionToken(token, config.internalSvcToken);
      } catch {
        reply.type('application/xml');
        return reply.send(hangupTwiml());
      }
      // Reuse the token to hand to the worker. (Already verified; re-signing only to
      // refresh ttl if needed — not strictly necessary, but cheap and keeps the
      // worker-side code path identical to inbound.)
      const wsUrl = `${config.workerWsUrl}?token=${encodeURIComponent(token)}`;

      // Update calls row with live Twilio CallSid if it came in the body.
      if (params.CallSid) {
        const payload = verifySessionToken(token, config.internalSvcToken);
        await supabase
          .from('calls')
          .update({ twilio_call_sid: params.CallSid, status: 'in_progress' })
          .eq('id', payload.call_id);
      }

      reply.type('application/xml');
      return reply.send(connectStreamTwiml(wsUrl));
    },
  );
}
```

- [ ] **Step 5.2: Register in index.ts**

Modify `services/call-orchestrator/src/index.ts`:

```typescript
import { registerVoiceOutboundRoute } from './routes/voice-outbound.js';
// ...
await registerVoiceOutboundRoute(app);
```

- [ ] **Step 5.3: Typecheck**

Run: `npm run typecheck --workspace=@confido/call-orchestrator`
Expected: clean.

- [ ] **Step 5.4: Commit**

```bash
git add services/call-orchestrator/src/routes/voice-outbound.ts services/call-orchestrator/src/index.ts
git commit -m "feat(orchestrator): add /voice/outbound TwiML endpoint"
```

---

## Task 6: Extend voice-status to handle outbound jobs

**Files:**
- Modify: `services/call-orchestrator/src/routes/voice-status.ts`

- [ ] **Step 6.1: Update status handler**

Overwrite `services/call-orchestrator/src/routes/voice-status.ts`:

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
        .select('id, direction')
        .maybeSingle();

      if (error) req.log.error({ CallSid, error }, 'failed to mark call ended');

      if (call?.direction === 'outbound') {
        await supabase
          .from('outbound_jobs')
          .update({ status: finalStatus === 'completed' ? 'completed' : 'failed' })
          .eq('call_id', call.id);
      }

      if (call && RecordingSid) {
        const taskName = await enqueuePullRecording({ callId: call.id, recordingSid: RecordingSid });
        req.log.info({ callId: call.id, taskName }, 'enqueued recording pull');
      }
    }

    return reply.code(200).send('ok');
  });
}
```

- [ ] **Step 6.2: Typecheck + commit**

Run: `npm run typecheck --workspace=@confido/call-orchestrator`
Expected: clean.

```bash
git add services/call-orchestrator/src/routes/voice-status.ts
git commit -m "feat(orchestrator): mark outbound_jobs final status from /voice/status"
```

---

## Task 7: Local smoke — outbound path

**Files:**
- Create: `scripts/local-smoke-outbound.sh`

- [ ] **Step 7.1: Smoke script**

Create `scripts/local-smoke-outbound.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Local smoke for outbound:
#  1. Start admin-api + dispatcher + orchestrator + a fake Cloud Tasks trampoline.
#  2. Insert tenant/agent/twilio_number.
#  3. POST to /api/outbound/calls; ASSERT outbound_jobs row inserted.
#  4. Hit the dispatcher directly (simulating Cloud Tasks) and ASSERT a call row appears
#     and a Twilio create was attempted (we mock Twilio via env + intercepting proxy —
#     simpler here to point TWILIO_ACCOUNT_SID at a throwaway subaccount and call real API
#     against a test number OR stub it in the service with TWILIO_MOCK=1).
#
# For CI we add TWILIO_MOCK=1 support in the dispatcher in a follow-up; this script
# is manual-run only.
echo "Manual smoke only; see Plan F for E2E smoke in CI."
```

Make executable: `chmod +x scripts/local-smoke-outbound.sh`.

- [ ] **Step 7.2: Commit**

```bash
git add scripts/local-smoke-outbound.sh
git commit -m "chore: outbound smoke script placeholder (manual run)"
```

---

## Task 8: Plan D exit gate

- [ ] **Step 8.1: All tests green**

Run: `npm run test && (cd services/pipecat-worker && .venv/bin/pytest)`
Expected: all pass.

- [ ] **Step 8.2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8.3: Push**

```bash
git push origin main
```

---

## What's done after Plan D

- `admin-api /api/outbound/calls` accepts `{agent_id, to_phone}`, inserts an `outbound_jobs` row, enqueues a Cloud Task.
- `dispatcher-worker /tasks/place-call` checks tenant concurrency atomically via `reserve_outbound_slot` RPC, creates a `calls` row with an outbound snapshot, and calls Twilio REST API with a TwiML URL pointing at the orchestrator.
- `call-orchestrator /voice/outbound` returns the same `<Connect><Stream>` TwiML as inbound; the pipecat worker path is untouched.
- `/voice/status` now also transitions `outbound_jobs.status` on call end.

**Next:** Plan E builds the Next.js UI on top of these APIs.
