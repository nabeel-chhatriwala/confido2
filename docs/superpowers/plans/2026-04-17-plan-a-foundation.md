# Plan A: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, the Supabase schema (all tables, RLS, partitioning, retention, Storage bucket), the shared TS package, and the GCP secret scaffolding that every later plan depends on.

**Architecture:** npm workspaces + turbo for TS services; `uv` for the Python pipecat-worker (scaffolded here, implemented in Plan B); Supabase CLI for schema migrations and local dev; `gcloud` CLI for secret-name scaffolding (values entered manually, never committed).

**Tech Stack:** Node 20, TypeScript 5.x, npm workspaces, turbo, Python 3.12 + uv, Supabase CLI, Postgres 15 (Supabase), `pg_partman`, `pg_cron`, GCP Secret Manager, Artifact Registry.

---

## File Structure

```
confido2/
├── package.json                 # npm workspace root
├── turbo.json                   # turbo task graph
├── tsconfig.base.json           # shared TS config
├── .eslintrc.cjs                # shared lint config
├── .prettierrc
├── .nvmrc                       # node 20
├── .gitignore                   # extend existing
├── .env.example                 # placeholders only
├── pyproject.toml               # root Python project (pipecat-worker)
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── db/
│       │   │   ├── client.ts          # Supabase client + pooler-URL guard
│       │   │   └── types.ts           # generated Supabase types (regen script)
│       │   ├── schemas/
│       │   │   ├── agent.ts           # zod schemas
│       │   │   ├── call.ts
│       │   │   ├── tenant.ts
│       │   │   └── index.ts
│       │   └── session-token.ts       # HMAC sign/verify
│       └── test/
│           ├── db.client.test.ts
│           └── session-token.test.ts
├── services/
│   ├── pipecat-worker/
│   │   ├── pyproject.toml
│   │   └── src/pipecat_worker/__init__.py    # empty module; Plan B fills it
│   ├── call-orchestrator/       # scaffolded in Plan B
│   ├── dispatcher-worker/       # scaffolded in Plan D
│   ├── admin-api/               # scaffolded in Plan D/E
│   └── ui/                      # scaffolded in Plan E
├── supabase/
│   ├── config.toml
│   └── migrations/
│       ├── 20260417000001_core_tables.sql
│       ├── 20260417000002_rls_policies.sql
│       ├── 20260417000003_indexes_and_fts.sql
│       ├── 20260417000004_storage_bucket.sql
│       ├── 20260417000005_partman_and_retention.sql
│       └── 20260417000006_auth_trigger.sql
└── scripts/
    ├── gcp-secrets-scaffold.sh           # creates secret NAMES (not values)
    └── db-types-gen.sh                   # regen packages/shared/src/db/types.ts
```

---

## Task 1: Initialize monorepo with npm workspaces

**Files:**
- Create: `package.json`
- Create: `.nvmrc`
- Modify: `.gitignore`

- [ ] **Step 1.1: Pin Node version**

Create `.nvmrc`:

```
20.18.0
```

- [ ] **Step 1.2: Create root package.json**

Create `package.json`:

```json
{
  "name": "confido2",
  "version": "0.0.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "services/call-orchestrator",
    "services/dispatcher-worker",
    "services/admin-api",
    "services/ui"
  ],
  "packageManager": "npm@10.9.0",
  "engines": {
    "node": "20.x"
  },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "dev": "turbo run dev --parallel"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "prettier": "^3.3.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
```

- [ ] **Step 1.3: Extend .gitignore**

Overwrite `.gitignore`:

```
.superpowers/
.env
.env.local
node_modules/
dist/
.turbo/
coverage/
*.log
.supabase/
__pycache__/
.venv/
.pytest_cache/
.ruff_cache/
```

- [ ] **Step 1.4: Install and verify**

Run: `npm install`
Expected: `added N packages` with no errors, no lockfile conflict.

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json .nvmrc .gitignore
git commit -m "chore: initialize npm workspace monorepo"
```

---

## Task 2: Configure turbo + shared TS/lint config

**Files:**
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`

- [ ] **Step 2.1: turbo.json**

Create `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 2.2: tsconfig.base.json**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 2.3: Prettier + ESLint configs**

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

Create `.eslintrc.cjs`:

```javascript
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  ignorePatterns: ['dist', 'node_modules', '.next', '.turbo'],
};
```

- [ ] **Step 2.4: Verify turbo resolves**

Run: `npx turbo run build --dry-run`
Expected: `No tasks were executed as part of this run` (no workspaces have build yet — that's fine).

- [ ] **Step 2.5: Commit**

```bash
git add turbo.json tsconfig.base.json .eslintrc.cjs .prettierrc
git commit -m "chore: add turbo + shared ts/lint config"
```

---

## Task 3: Scaffold the shared package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 3.1: shared/package.json**

Create `packages/shared/package.json`:

```json
{
  "name": "@confido/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./schemas": "./dist/schemas/index.js",
    "./db": "./dist/db/client.js",
    "./session-token": "./dist/session-token.js"
  },
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.47.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3.2: shared/tsconfig.json**

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3.3: shared/src/index.ts (re-exports)**

Create `packages/shared/src/index.ts`:

```typescript
export * from './schemas/index.js';
export { createServiceClient } from './db/client.js';
export { signSessionToken, verifySessionToken, SessionTokenPayload } from './session-token.js';
```

- [ ] **Step 3.4: Install**

Run: `npm install`
Expected: `@confido/shared` linked into workspace.

- [ ] **Step 3.5: Commit**

```bash
git add packages/shared package.json package-lock.json
git commit -m "feat(shared): scaffold package"
```

---

## Task 4: shared — zod schemas for core tables

**Files:**
- Create: `packages/shared/src/schemas/tenant.ts`
- Create: `packages/shared/src/schemas/agent.ts`
- Create: `packages/shared/src/schemas/call.ts`
- Create: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/test/schemas.test.ts`

- [ ] **Step 4.1: Write failing test for schemas**

Create `packages/shared/test/schemas.test.ts`:

```typescript
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
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npm run test --workspace=@confido/shared`
Expected: FAIL — `Cannot find module '../src/schemas/index.js'`.

- [ ] **Step 4.3: Implement schemas/tenant.ts**

Create `packages/shared/src/schemas/tenant.ts`:

```typescript
import { z } from 'zod';

export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  concurrency_cap: z.number().int().positive(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Tenant = z.infer<typeof TenantSchema>;
```

- [ ] **Step 4.4: Implement schemas/agent.ts**

Create `packages/shared/src/schemas/agent.ts`:

```typescript
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
```

- [ ] **Step 4.5: Implement schemas/call.ts**

Create `packages/shared/src/schemas/call.ts`:

```typescript
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
```

- [ ] **Step 4.6: Implement schemas/index.ts**

Create `packages/shared/src/schemas/index.ts`:

```typescript
export * from './tenant.js';
export * from './agent.js';
export * from './call.js';
```

- [ ] **Step 4.7: Run test to verify pass**

Run: `npm run test --workspace=@confido/shared`
Expected: PASS — 4 tests.

- [ ] **Step 4.8: Commit**

```bash
git add packages/shared/src/schemas packages/shared/test/schemas.test.ts
git commit -m "feat(shared): add zod schemas for tenant, agent, call"
```

---

## Task 5: shared — Supabase client with pooler-URL guard

**Files:**
- Create: `packages/shared/src/db/client.ts`
- Create: `packages/shared/test/db.client.test.ts`

- [ ] **Step 5.1: Write failing test**

Create `packages/shared/test/db.client.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { assertPoolerUrl } from '../src/db/client.js';

describe('assertPoolerUrl', () => {
  it('accepts aws-0-us-east-1.pooler.supabase.com', () => {
    expect(() =>
      assertPoolerUrl('postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres'),
    ).not.toThrow();
  });

  it('rejects the direct db host', () => {
    expect(() =>
      assertPoolerUrl('postgresql://postgres:pw@db.abc.supabase.co:5432/postgres'),
    ).toThrow(/pooler/i);
  });

  it('rejects any non-pooler host', () => {
    expect(() =>
      assertPoolerUrl('postgresql://postgres:pw@localhost:5432/postgres'),
    ).toThrow(/pooler/i);
  });
});
```

- [ ] **Step 5.2: Run test to verify fail**

Run: `npm run test --workspace=@confido/shared -- db.client`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement client.ts**

Create `packages/shared/src/db/client.ts`:

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function assertPoolerUrl(dbUrl: string): void {
  try {
    const host = new URL(dbUrl).host;
    if (!host.includes('.pooler.supabase.com')) {
      throw new Error(
        `Refusing to use non-pooler Supabase URL (host=${host}). Cloud Run requires the IPv4 pooler.`,
      );
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`Invalid database URL: ${dbUrl}`);
    }
    throw err;
  }
}

export interface ServiceClientConfig {
  supabaseUrl: string;          // https://<ref>.supabase.co
  serviceRoleKey: string;       // from Secret Manager
  dbPoolerUrl?: string;         // optional; validated if present
}

export function createServiceClient(cfg: ServiceClientConfig): SupabaseClient {
  if (cfg.dbPoolerUrl) {
    assertPoolerUrl(cfg.dbPoolerUrl);
  }
  return createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 5.4: Run test to verify pass**

Run: `npm run test --workspace=@confido/shared -- db.client`
Expected: PASS — 3 tests.

- [ ] **Step 5.5: Commit**

```bash
git add packages/shared/src/db packages/shared/test/db.client.test.ts
git commit -m "feat(shared): add Supabase service client with pooler URL guard"
```

---

## Task 6: shared — HMAC signed session token

**Files:**
- Create: `packages/shared/src/session-token.ts`
- Create: `packages/shared/test/session-token.test.ts`

- [ ] **Step 6.1: Write failing test**

Create `packages/shared/test/session-token.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { signSessionToken, verifySessionToken } from '../src/session-token.js';

const SECRET = 'test-secret-at-least-32-characters-long-okay';

describe('session token', () => {
  it('round-trips a payload', () => {
    const payload = { call_id: 'c1', tenant_id: 't1', agent_id: 'a1' };
    const token = signSessionToken(payload, SECRET, 60);
    const verified = verifySessionToken(token, SECRET);
    expect(verified.call_id).toBe('c1');
  });

  it('rejects a tampered token', () => {
    const payload = { call_id: 'c1', tenant_id: 't1', agent_id: 'a1' };
    const token = signSessionToken(payload, SECRET, 60);
    const tampered = token.slice(0, -2) + 'xx';
    expect(() => verifySessionToken(tampered, SECRET)).toThrow(/invalid/i);
  });

  it('rejects an expired token', () => {
    const payload = { call_id: 'c1', tenant_id: 't1', agent_id: 'a1' };
    const token = signSessionToken(payload, SECRET, -1);
    expect(() => verifySessionToken(token, SECRET)).toThrow(/expired/i);
  });

  it('rejects a wrong-secret verify', () => {
    const payload = { call_id: 'c1', tenant_id: 't1', agent_id: 'a1' };
    const token = signSessionToken(payload, SECRET, 60);
    expect(() => verifySessionToken(token, 'different-secret-at-least-32-characters-x')).toThrow(
      /invalid/i,
    );
  });
});
```

- [ ] **Step 6.2: Run test to verify fail**

Run: `npm run test --workspace=@confido/shared -- session-token`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement session-token.ts**

Create `packages/shared/src/session-token.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionTokenPayload {
  call_id: string;
  tenant_id: string;
  agent_id: string;
}

interface EncodedToken extends SessionTokenPayload {
  exp: number;  // unix seconds
}

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}
function fromB64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

export function signSessionToken(
  payload: SessionTokenPayload,
  secret: string,
  ttlSeconds: number,
): string {
  if (secret.length < 32) {
    throw new Error('Session-token secret must be at least 32 chars.');
  }
  const body: EncodedToken = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const bodyB64 = b64url(JSON.stringify(body));
  const mac = createHmac('sha256', secret).update(bodyB64).digest('base64url');
  return `${bodyB64}.${mac}`;
}

export function verifySessionToken(token: string, secret: string): SessionTokenPayload {
  const [bodyB64, mac] = token.split('.');
  if (!bodyB64 || !mac) {
    throw new Error('invalid token: malformed');
  }
  const expectedMac = createHmac('sha256', secret).update(bodyB64).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('invalid token: signature mismatch');
  }
  const body = JSON.parse(fromB64url(bodyB64)) as EncodedToken;
  if (body.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('invalid token: expired');
  }
  return { call_id: body.call_id, tenant_id: body.tenant_id, agent_id: body.agent_id };
}
```

- [ ] **Step 6.4: Run tests to verify pass**

Run: `npm run test --workspace=@confido/shared`
Expected: PASS — 7 tests total (3 new + 3 earlier + schema 4... recount).

- [ ] **Step 6.5: Build shared**

Run: `npm run build --workspace=@confido/shared`
Expected: `dist/` populated, no errors.

- [ ] **Step 6.6: Commit**

```bash
git add packages/shared/src/session-token.ts packages/shared/test/session-token.test.ts
git commit -m "feat(shared): add HMAC signed session token utility"
```

---

## Task 7: Supabase CLI init

**Files:**
- Create: `supabase/config.toml`

- [ ] **Step 7.1: Install Supabase CLI (global)**

Run: `brew install supabase/tap/supabase`
Expected: success, then `supabase --version` prints v1.200+ .

- [ ] **Step 7.2: Initialize the supabase folder**

Run: `supabase init`
Expected: creates `supabase/config.toml` and `supabase/migrations/` (empty).

- [ ] **Step 7.3: Link to the remote project**

Run: `supabase link --project-ref ktfhsoajopeapqprmioj`
If prompted for a database password, use the project password (user has it).
Expected: `Finished supabase link.`

- [ ] **Step 7.4: Commit scaffolding**

```bash
git add supabase/
git commit -m "chore(supabase): init CLI config and link project"
```

---

## Task 8: Migration — core tables

**Files:**
- Create: `supabase/migrations/20260417000001_core_tables.sql`

- [ ] **Step 8.1: Write the migration**

Create `supabase/migrations/20260417000001_core_tables.sql`:

```sql
-- Core tables for voice agent platform.

create schema if not exists internal;
create extension if not exists "uuid-ossp";

create table public.tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  concurrency_cap int not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'viewer' check (role in ('viewer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  system_prompt text not null default '',
  first_message text not null default '',
  stt_provider text not null,
  stt_config jsonb not null default '{}'::jsonb,
  llm_provider text not null,
  llm_config jsonb not null default '{}'::jsonb,
  tts_provider text not null,
  tts_config jsonb not null default '{}'::jsonb,
  llm_fallback_provider text,
  current_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_versions (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create table public.twilio_numbers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  phone_number text not null unique,
  direction text not null check (direction in ('inbound','outbound','both')),
  created_at timestamptz not null default now()
);

create table public.calls (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  twilio_call_sid text not null unique,
  direction text not null check (direction in ('inbound','outbound')),
  from_number text not null,
  to_number text not null,
  status text not null default 'queued'
    check (status in ('queued','dialing','in_progress','completed','failed')),
  end_reason text check (end_reason in (
    'caller_hangup','agent_hangup','stt_failed','llm_failed','tts_failed','error'
  )),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int generated always as (
    case when ended_at is not null and started_at is not null
      then extract(epoch from (ended_at - started_at))::int
      else null end
  ) stored,
  agent_version_snapshot jsonb not null,
  transcript_json jsonb,
  recording_object_path text,
  recording_pulled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Declare parent partitioned table; partitions created by pg_partman in migration 5.
create table public.call_events (
  id bigserial,
  call_id uuid not null references public.calls(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  primary key (occurred_at, id)
) partition by range (occurred_at);

create table public.outbound_jobs (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  to_phone text not null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','dialing','in_call','completed','failed')),
  cloud_task_name text,
  call_id uuid references public.calls(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  actor_id uuid references public.users(id),
  action text not null,
  target_table text not null,
  target_id uuid,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now()
);

-- is_admin helper in the internal schema (not public); RLS uses it.
create or replace function internal.is_admin(uid uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.users u where u.id = uid and u.role = 'admin');
$$;
revoke all on function internal.is_admin(uuid) from public;
grant execute on function internal.is_admin(uuid) to authenticated;

-- updated_at triggers.
create or replace function internal.set_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger tenants_updated before update on public.tenants
  for each row execute function internal.set_updated_at();
create trigger users_updated before update on public.users
  for each row execute function internal.set_updated_at();
create trigger agents_updated before update on public.agents
  for each row execute function internal.set_updated_at();
create trigger calls_updated before update on public.calls
  for each row execute function internal.set_updated_at();
create trigger outbound_jobs_updated before update on public.outbound_jobs
  for each row execute function internal.set_updated_at();
```

- [ ] **Step 8.2: Apply locally**

Run: `supabase start`
Then: `supabase db reset`
Expected: migration applies with no errors; prints `Finished supabase db reset`.

- [ ] **Step 8.3: Verify tables exist**

Run: `supabase db execute --local "select table_name from information_schema.tables where table_schema='public' order by 1"`
Expected: list includes `agent_versions, agents, audit_log, call_events, calls, outbound_jobs, tenants, twilio_numbers, users`.

- [ ] **Step 8.4: Commit**

```bash
git add supabase/migrations/20260417000001_core_tables.sql
git commit -m "feat(db): add core tables migration"
```

---

## Task 9: Migration — RLS policies

**Files:**
- Create: `supabase/migrations/20260417000002_rls_policies.sql`

- [ ] **Step 9.1: Write migration**

Create `supabase/migrations/20260417000002_rls_policies.sql`:

```sql
-- RLS. Services use the service_role key (bypasses RLS);
-- the UI uses the anon key with a signed-in JWT and hits these policies.

alter table public.tenants enable row level security;
create policy tenants_read_all on public.tenants
  for select using (auth.role() = 'authenticated');
create policy tenants_admin_write on public.tenants
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.users enable row level security;
create policy users_self_read on public.users
  for select using (id = auth.uid());
create policy users_admin_all on public.users
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.agents enable row level security;
create policy agents_read_all on public.agents
  for select using (auth.role() = 'authenticated');
create policy agents_admin_write on public.agents
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.agent_versions enable row level security;
create policy agent_versions_read_all on public.agent_versions
  for select using (auth.role() = 'authenticated');
create policy agent_versions_admin_write on public.agent_versions
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.twilio_numbers enable row level security;
create policy twilio_numbers_read_all on public.twilio_numbers
  for select using (auth.role() = 'authenticated');
create policy twilio_numbers_admin_write on public.twilio_numbers
  for all using (internal.is_admin(auth.uid())) with check (internal.is_admin(auth.uid()));

alter table public.calls enable row level security;
create policy calls_read_all on public.calls
  for select using (auth.role() = 'authenticated');
-- No UI write policies on calls; service_role only.

alter table public.call_events enable row level security;
create policy call_events_read_all on public.call_events
  for select using (auth.role() = 'authenticated');

alter table public.outbound_jobs enable row level security;
create policy outbound_jobs_read_all on public.outbound_jobs
  for select using (auth.role() = 'authenticated');

alter table public.audit_log enable row level security;
create policy audit_admin_read on public.audit_log
  for select using (internal.is_admin(auth.uid()));
```

- [ ] **Step 9.2: Apply locally**

Run: `supabase db reset`
Expected: both migrations apply cleanly.

- [ ] **Step 9.3: Smoke-test policy presence**

Run:
```
supabase db execute --local "select schemaname, tablename, policyname from pg_policies where schemaname='public' order by 1,2,3"
```
Expected: policies listed, matching the migration.

- [ ] **Step 9.4: Commit**

```bash
git add supabase/migrations/20260417000002_rls_policies.sql
git commit -m "feat(db): add RLS policies"
```

---

## Task 10: Migration — indexes + full-text search

**Files:**
- Create: `supabase/migrations/20260417000003_indexes_and_fts.sql`

- [ ] **Step 10.1: Write migration**

Create `supabase/migrations/20260417000003_indexes_and_fts.sql`:

```sql
create index calls_tenant_started_idx on public.calls (tenant_id, started_at desc);
create index calls_agent_started_idx on public.calls (agent_id, started_at desc);
create index outbound_jobs_tenant_status_idx on public.outbound_jobs (tenant_id, status, created_at desc);
create index twilio_numbers_agent_idx on public.twilio_numbers (agent_id);
create index agents_tenant_idx on public.agents (tenant_id);

-- Full-text search over transcript text.
alter table public.calls add column transcript_tsv tsvector generated always as (
  to_tsvector('english', coalesce(transcript_json->>'text', ''))
) stored;
create index calls_transcript_fts_idx on public.calls using gin (transcript_tsv);
```

- [ ] **Step 10.2: Apply and verify**

Run: `supabase db reset`
Then: `supabase db execute --local "select indexname from pg_indexes where tablename='calls'"`
Expected: includes `calls_tenant_started_idx`, `calls_transcript_fts_idx`.

- [ ] **Step 10.3: Commit**

```bash
git add supabase/migrations/20260417000003_indexes_and_fts.sql
git commit -m "feat(db): add indexes and transcript FTS"
```

---

## Task 11: Migration — Storage bucket

**Files:**
- Create: `supabase/migrations/20260417000004_storage_bucket.sql`

- [ ] **Step 11.1: Write migration**

Create `supabase/migrations/20260417000004_storage_bucket.sql`:

```sql
-- Private bucket for call recordings.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'call-recordings',
  'call-recordings',
  false,
  524288000,  -- 500 MB
  array['audio/wav','audio/x-wav','audio/mpeg','audio/mp3']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Deny all anon+authenticated access via Storage RLS; service_role bypasses.
-- (Not creating any policies == deny by default with RLS enabled.)
```

- [ ] **Step 11.2: Apply locally**

Run: `supabase db reset`
Expected: migration applies.

- [ ] **Step 11.3: Verify bucket**

Run: `supabase db execute --local "select id, public from storage.buckets"`
Expected: `call-recordings | f`.

- [ ] **Step 11.4: Commit**

```bash
git add supabase/migrations/20260417000004_storage_bucket.sql
git commit -m "feat(storage): add private call-recordings bucket"
```

---

## Task 12: Migration — pg_partman + retention jobs

**Files:**
- Create: `supabase/migrations/20260417000005_partman_and_retention.sql`

- [ ] **Step 12.1: Write migration**

Create `supabase/migrations/20260417000005_partman_and_retention.sql`:

```sql
create extension if not exists pg_partman;
create extension if not exists pg_cron;

-- Turn call_events into a partman-managed monthly partitioned table.
select partman.create_parent(
  p_parent_table => 'public.call_events',
  p_control      => 'occurred_at',
  p_type         => 'range',
  p_interval     => '1 month',
  p_premake      => 3
);

-- Drop partitions older than 90 days (3 months).
update partman.part_config
   set retention = '90 days',
       retention_keep_table = false,
       retention_keep_index = false
 where parent_table = 'public.call_events';

-- Nightly maintenance.
select cron.schedule(
  'partman-maintenance',
  '15 4 * * *',
  $$ call partman.run_maintenance_proc(); $$
);

-- Recording + calls retention: delete rows and their Storage objects at 90 days.
create or replace function internal.retire_old_calls() returns void
  language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
begin
  -- Delete storage objects for retiring calls.
  delete from storage.objects o
   using public.calls c
   where c.created_at < v_cutoff
     and c.recording_object_path is not null
     and o.bucket_id = 'call-recordings'
     and o.name = c.recording_object_path;

  -- Delete the calls rows (cascade drops call_events children for rows not yet covered by partman).
  delete from public.calls where created_at < v_cutoff;
end;
$$;
revoke all on function internal.retire_old_calls() from public;

select cron.schedule(
  'retire-old-calls',
  '30 4 * * *',
  $$ select internal.retire_old_calls(); $$
);
```

- [ ] **Step 12.2: Apply**

Run: `supabase db reset`
Expected: migration applies; extensions install without error.

- [ ] **Step 12.3: Verify partman rows**

Run: `supabase db execute --local "select parent_table, retention from partman.part_config"`
Expected: `public.call_events | 90 days`.

- [ ] **Step 12.4: Commit**

```bash
git add supabase/migrations/20260417000005_partman_and_retention.sql
git commit -m "feat(db): add pg_partman and retention cron jobs"
```

---

## Task 13: Migration — auth trigger for hd=confido.health

**Files:**
- Create: `supabase/migrations/20260417000006_auth_trigger.sql`

- [ ] **Step 13.1: Write migration**

Create `supabase/migrations/20260417000006_auth_trigger.sql`:

```sql
-- Reject non-@confido.health sign-ups as defense-in-depth.
-- Primary enforcement is the Google OAuth hd= parameter.

create or replace function internal.enforce_confido_email() returns trigger
  language plpgsql security definer set search_path = auth, pg_temp as $$
begin
  if new.email is null or lower(new.email) !~ '@confido\.health$' then
    raise exception 'Sign-up blocked: only @confido.health emails allowed.';
  end if;
  return new;
end;
$$;

drop trigger if exists confido_email_only on auth.users;
create trigger confido_email_only
  before insert on auth.users
  for each row execute function internal.enforce_confido_email();

-- Also auto-create a public.users row on first sign-in.
create or replace function internal.mirror_auth_user() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.users (id, email, role)
    values (new.id, new.email, 'viewer')
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists mirror_auth_user on auth.users;
create trigger mirror_auth_user
  after insert on auth.users
  for each row execute function internal.mirror_auth_user();
```

- [ ] **Step 13.2: Apply + verify triggers**

Run: `supabase db reset`
Then: `supabase db execute --local "select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal"`
Expected: includes `confido_email_only` and `mirror_auth_user`.

- [ ] **Step 13.3: Commit**

```bash
git add supabase/migrations/20260417000006_auth_trigger.sql
git commit -m "feat(auth): restrict sign-ups to @confido.health and mirror users"
```

---

## Task 14: Scripts — generate TS types + push migrations to remote

**Files:**
- Create: `scripts/db-types-gen.sh`
- Modify: `packages/shared/package.json` (add `types:gen` script)

- [ ] **Step 14.1: Create types-gen script**

Create `scripts/db-types-gen.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Regenerates packages/shared/src/db/types.ts from the LOCAL Supabase DB.
# Prereq: `supabase start` is running.

out=packages/shared/src/db/types.ts
mkdir -p "$(dirname "$out")"
supabase gen types typescript --local --schema public > "$out"
echo "Wrote $out"
```

Make executable: `chmod +x scripts/db-types-gen.sh`

- [ ] **Step 14.2: Add package script**

Modify `packages/shared/package.json` — add under `scripts`:

```json
    "types:gen": "../../scripts/db-types-gen.sh"
```

- [ ] **Step 14.3: Generate types**

Run: `supabase start` (if not running), then `npm run types:gen --workspace=@confido/shared`
Expected: `Wrote packages/shared/src/db/types.ts`.

- [ ] **Step 14.4: Push migrations to remote (prod)**

Run: `supabase db push`
Expected: `Applying migration 20260417000001_core_tables.sql ... Finished supabase db push.` (all 6 migrations applied to the remote project).

If the remote complains about existing extensions (pg_partman, pg_cron), enable them from the Supabase dashboard → Database → Extensions first, then re-run push.

- [ ] **Step 14.5: Commit**

```bash
git add scripts/db-types-gen.sh packages/shared/package.json packages/shared/src/db/types.ts
git commit -m "chore(db): add types generator and push remote"
```

---

## Task 15: GCP secret-name scaffold script

**Files:**
- Create: `scripts/gcp-secrets-scaffold.sh`

- [ ] **Step 15.1: Write script**

Create `scripts/gcp-secrets-scaffold.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Creates Secret Manager secret NAMES in the project.
# Values are entered manually by an operator via `gcloud secrets versions add`.

PROJECT=${PROJECT:-clinical-workflow-lakeway}

SECRETS=(
  supabase-db-url
  supabase-service-role-key
  supabase-anon-key
  twilio-account-sid
  twilio-auth-token
  twilio-signing-key
  internal-svc-token
  provider-key-openai
  provider-key-anthropic
  provider-key-groq
  provider-key-deepgram
  provider-key-assemblyai
  provider-key-elevenlabs
  provider-key-cartesia
)

for s in "${SECRETS[@]}"; do
  if gcloud secrets describe "$s" --project="$PROJECT" >/dev/null 2>&1; then
    echo "exists: $s"
  else
    gcloud secrets create "$s" \
      --replication-policy=automatic \
      --project="$PROJECT"
    echo "created: $s"
  fi
done

echo
echo "Operator must now run, once per secret:"
echo "  echo -n 'VALUE' | gcloud secrets versions add <secret> --data-file=- --project=$PROJECT"
```

Make executable: `chmod +x scripts/gcp-secrets-scaffold.sh`

- [ ] **Step 15.2: Dry-run check**

Run: `bash -n scripts/gcp-secrets-scaffold.sh`
Expected: no syntax errors.

- [ ] **Step 15.3: Commit**

```bash
git add scripts/gcp-secrets-scaffold.sh
git commit -m "chore(gcp): add secret-name scaffold script"
```

(The operator runs this with `PROJECT=clinical-workflow-lakeway ./scripts/gcp-secrets-scaffold.sh` when ready — no need to run during this plan.)

---

## Task 16: Python scaffold — pipecat-worker stub

**Files:**
- Create: `services/pipecat-worker/pyproject.toml`
- Create: `services/pipecat-worker/src/pipecat_worker/__init__.py`
- Create: `services/pipecat-worker/tests/test_smoke.py`

- [ ] **Step 16.1: pyproject.toml**

Create `services/pipecat-worker/pyproject.toml`:

```toml
[project]
name = "pipecat-worker"
version = "0.0.0"
requires-python = ">=3.12"
dependencies = []

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "ruff>=0.6",
  "mypy>=1.11",
]

[tool.setuptools.packages.find]
where = ["src"]

[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"
```

- [ ] **Step 16.2: Module stub**

Create `services/pipecat-worker/src/pipecat_worker/__init__.py`:

```python
"""pipecat-worker package. Scaffolded in Plan A, implemented in Plan B."""
__version__ = "0.0.0"
```

- [ ] **Step 16.3: Smoke test**

Create `services/pipecat-worker/tests/test_smoke.py`:

```python
import pipecat_worker

def test_version():
    assert pipecat_worker.__version__ == "0.0.0"
```

- [ ] **Step 16.4: Install with uv + run test**

Run:
```
cd services/pipecat-worker
uv venv
uv pip install -e '.[dev]'
.venv/bin/pytest
cd ../..
```
Expected: `1 passed`.

- [ ] **Step 16.5: Commit**

```bash
git add services/pipecat-worker
git commit -m "feat(pipecat-worker): scaffold Python package"
```

---

## Task 17: .env.example + README

**Files:**
- Create: `.env.example`
- Modify: `README.md`

- [ ] **Step 17.1: .env.example**

Create `.env.example`:

```
# Copy to .env.local for local dev. Never commit .env.local.
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SIGNING_KEY=

INTERNAL_SVC_TOKEN=change-me-to-random-32-plus-chars

PROVIDER_KEY_OPENAI=
PROVIDER_KEY_ANTHROPIC=
PROVIDER_KEY_GROQ=
PROVIDER_KEY_DEEPGRAM=
PROVIDER_KEY_ASSEMBLYAI=
PROVIDER_KEY_ELEVENLABS=
PROVIDER_KEY_CARTESIA=
```

- [ ] **Step 17.2: Update README**

Overwrite `README.md`:

```markdown
# confido2

Voice agent platform — Pipecat on GCP, Supabase for state.

Design: [docs/superpowers/specs/2026-04-17-voice-agent-infra-design.md](docs/superpowers/specs/2026-04-17-voice-agent-infra-design.md)

## Local dev

```
npm install
supabase start
supabase db reset
cp .env.example .env.local   # then fill in
npm run test
```

## Plans

- Plan A — Foundation (this plan)
- Plan B — Inbound MVP
- Plan C — Provider abstraction
- Plan D — Outbound
- Plan E — Admin UI
- Plan F — IaC + CI/CD
- Plan G — Observability
```

- [ ] **Step 17.3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add .env.example and README"
```

---

## Task 18: End-of-plan verification

- [ ] **Step 18.1: All tests green**

Run: `npm run test`
Expected: `@confido/shared` tests pass.

Run: `(cd services/pipecat-worker && .venv/bin/pytest)`
Expected: pass.

- [ ] **Step 18.2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 18.3: Local Supabase schema complete**

Run: `supabase db execute --local "select count(*) from information_schema.tables where table_schema='public'"`
Expected: `>= 9` tables.

- [ ] **Step 18.4: Push all**

```bash
git push origin main
```

Expected: clean push.

---

## What's done after Plan A

- Monorepo, shared package, schemas, Supabase client, HMAC signed tokens — all tested.
- Supabase schema applied locally and to the remote project, with RLS, partitioning, retention jobs, storage bucket, and auth trigger.
- GCP secret names scaffolded (values left for operator).
- Pipecat-worker package stub ready for Plan B.

**Next:** Plan B implements the inbound call path end-to-end with a single hardcoded provider stack.
