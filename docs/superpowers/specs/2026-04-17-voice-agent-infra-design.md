# Voice Agent Infrastructure — Design

**Date:** 2026-04-17
**Status:** Design approved, ready for implementation plan
**GCP project:** `clinical-workflow-lakeway`
**Supabase project:** `ktfhsoajopeapqprmioj`

## Goals

Build a production-ready platform on Google Cloud that runs Pipecat voice agents connected via Twilio telephony, stores call recordings and transcripts in Supabase, and exposes a simple internal UI to view calls and manage agents. Agents must support swappable STT, LLM, and TTS providers at per-agent granularity.

## Scope & Constraints

Decisions locked before the design:

- **Compliance:** Non-HIPAA. No PHI handling, no BAAs required.
- **Scale target:** 100-500 concurrent peak today; design must absorb 50k calls/day (~1,500 concurrent peak at 5-min avg duration) without a replatform.
- **Call direction:** Inbound + outbound, balanced.
- **Tenancy:** Multi-tenant at the data-model level; tenants are Confido product lines (not external customers).
- **UI audience:** Internal Confido staff only. Google Workspace SSO via Supabase Auth with `hd=confido.health` restriction.
- **Recording fidelity:** Mixed single-track audio, live-STT transcript is canonical, 90-day retention.
- **Provider credentials:** Platform-managed. Confido holds all keys in GCP Secret Manager.
- **Outbound dispatch:** API with platform-managed pacing (respect Twilio CPS, per-tenant concurrency caps). No campaign UI.
- **Stack:** TypeScript/Node for all services except `pipecat-worker` (Python, required by Pipecat).
- **Config management:** Admin UI + API. Config stored in Supabase.

## Architecture

Approach: **service-per-role on Cloud Run, Supabase for all persistent state**. Chosen over a monolithic Cloud Run service (couples scaling domains) and over GKE (unnecessary ops burden at this scale). Pipecat worker is a separate Cloud Run service so that if sustained-load economics demand GKE Autopilot later, it is a single-service migration with no blast radius into API/UI/DB.

### Services

| Service | Runtime | Purpose |
|---|---|---|
| `pipecat-worker` | Python (Cloud Run) | Terminates Twilio Media Streams WS, runs pipecat pipeline (STT→LLM→TTS), writes events to Supabase. |
| `call-orchestrator` | TS/Node (Cloud Run) | Handles Twilio webhooks (`/voice/inbound`, `/voice/status`), mints signed WS URLs, creates `calls` rows, enqueues recording pulls. |
| `dispatcher-worker` | TS/Node (Cloud Run) | Cloud Tasks handler. Places outbound calls via Twilio REST API with pacing + retry. |
| `admin-api` | TS/Node (Cloud Run) | Backend for UI. CRUD for tenants/agents, mints signed URLs for recording playback, serves public outbound API. |
| `ui` | Next.js (Cloud Run) | Internal dashboard. Supabase Auth (Google SSO), live call list, agent editor. |
| `shared` | TS package (no deploy) | Zod schemas, types, DB client helpers consumed by all TS services. |

### External systems

- **Supabase** (project `ktfhsoajopeapqprmioj`): Postgres (tenants, agents, calls, events, transcripts, users, audit), Auth (Google OAuth, `hd=confido.health`), Storage (`call-recordings` bucket), Realtime (publications on `calls` and `call_events`), one Edge Function `pull-twilio-recording` that pulls audio from Twilio directly into Storage (avoids GCP egress).
- **GCP:** Cloud Run (services), Cloud Tasks (outbound queue + dead-letter queue), Secret Manager (provider keys, Twilio creds, Supabase creds, internal service-to-service tokens), Cloud Monitoring (alerts + custom metrics), Artifact Registry (container images).
- **Twilio:** Media Streams for audio (not SIP on day 1). Webhooks point at `call-orchestrator`. Recording is done by Twilio; we pull after call completion.

### Inbound call flow

1. Caller dials a Twilio number.
2. Twilio POSTs `/voice/inbound` to `call-orchestrator`.
3. Orchestrator upserts `calls` row keyed on `CallSid` (idempotent), snapshots the current `agents` row (resolved with any provider defaults) into `calls.agent_version_snapshot` so the config is immutable for the duration of the call, mints a signed session token, responds with TwiML `<Connect><Stream url="wss://pipecat-worker/ws?token=...">`.
4. Twilio opens a WS to `pipecat-worker` with the token.
5. Worker validates token, loads agent config from snapshot (not fresh from DB — immutability mid-call), builds the pipecat pipeline from the provider registry, runs the call.
6. On call end, worker finalizes transcript into `calls.transcript_json` (3 retries in-process, then Cloud Task fallback).
7. Twilio's `/voice/status` webhook signals completion; orchestrator enqueues a Cloud Task that invokes the Supabase Edge Function `pull-twilio-recording` to copy the recording to Storage.

### Outbound call flow

1. Caller POSTs to `admin-api /api/outbound/calls` with `{agent_id, to_phone, context?}`.
2. `admin-api` validates, inserts `outbound_jobs` row (status=`queued`), enqueues a Cloud Task with per-queue rate limit and per-tenant concurrency check.
3. Cloud Tasks delivers to `dispatcher-worker`.
4. Dispatcher checks tenant concurrency, calls Twilio REST API to place the call with a TwiML URL that points at `call-orchestrator /voice/outbound`.
5. When Twilio answers, it fetches TwiML from `call-orchestrator` → same signed-token → `<Connect><Stream>` flow as inbound.
6. From here the pipecat path is identical to inbound.

## Data Model

All persistent state lives in Supabase Postgres. `public` schema.

### Tables

```
tenants               id uuid pk, name text, concurrency_cap int default 50,
                      created_at timestamptz, updated_at timestamptz.

agents                id uuid pk, tenant_id uuid fk, name text,
                      system_prompt text, first_message text,
                      stt_provider text, stt_config jsonb,
                      llm_provider text, llm_config jsonb,
                      tts_provider text, tts_config jsonb,
                      current_version int, created_at, updated_at.

agent_versions        id uuid pk, agent_id uuid fk, version int,
                      snapshot jsonb,  -- full agent row at publish time
                      created_by uuid fk auth.users, created_at.
                      unique(agent_id, version).
                      -- agents holds the live/editable config.
                      -- admin-api inserts an agent_versions row on every
                      -- publish action (explicit save), enabling rollback.
                      -- Live edits between publishes do not create rows.

twilio_numbers        id uuid pk, tenant_id uuid fk, agent_id uuid fk,
                      phone_number text unique, direction text check ('inbound','outbound','both'),
                      created_at.

calls                 id uuid pk, tenant_id uuid fk, agent_id uuid fk,
                      twilio_call_sid text unique,
                      direction text, from_number text, to_number text,
                      status text, end_reason text,
                      started_at timestamptz, ended_at timestamptz,
                      duration_seconds int generated,
                      agent_version_snapshot jsonb not null,  -- immutable mid-call
                      transcript_json jsonb,
                      recording_object_path text,             -- supabase storage path
                      recording_pulled_at timestamptz,
                      created_at, updated_at.

call_events           id bigserial, call_id uuid fk, kind text,
                      payload jsonb, occurred_at timestamptz,
                      primary key (occurred_at, id).  -- monthly partitioned by pg_partman

outbound_jobs         id uuid pk, tenant_id uuid fk, agent_id uuid fk,
                      to_phone text, context jsonb,
                      status text check ('queued','dialing','in_call','completed','failed'),
                      cloud_task_name text,
                      call_id uuid fk nullable,
                      created_at, updated_at.

users                 id uuid pk = auth.users.id,
                      email text unique, role text check ('viewer','admin'),
                      created_at, updated_at.

audit_log             id bigserial pk, actor_id uuid fk users, action text,
                      target_table text, target_id uuid, before jsonb, after jsonb,
                      occurred_at timestamptz default now().
```

### Indexes

- `calls (tenant_id, started_at desc)` — main UI list query.
- `calls (twilio_call_sid)` — unique for idempotent webhook upserts.
- `call_events (call_id, occurred_at)`.
- `outbound_jobs (tenant_id, status, created_at desc)`.
- Full-text search on transcript: generated `tsvector` column on `calls` derived from `transcript_json->>'text'`, GIN index.

### Partitioning & retention

- `call_events` is partitioned monthly via `pg_partman`. Partitions older than 90 days are dropped by `pg_partman.run_maintenance_proc` on a `pg_cron` job, matching recording retention so events never outlive the audio they describe.
- `calls` is **not** partitioned (low row count, UI needs point lookups).
- `recording_object_path` + its Storage object are deleted at 90 days via a nightly `pg_cron` job that soft-deletes the row and drops the Storage object.

### Storage

- Bucket `call-recordings`, private, default ACL denies all public access.
- Object key: `tenant_id/YYYY/MM/DD/<call_id>.<ext>` (Twilio delivers `audio/x-wav` or `audio/mpeg`).
- Lifecycle: 30-day transition to infrequent-access class (Supabase's equivalent), delete at 90 days (matches the DB retention job).
- UI access via signed URLs (5-minute TTL) minted by `admin-api` only after JWT verification + RLS check.

### Secrets (GCP Secret Manager)

Platform-managed. Each secret has versions; Cloud Run services mount the latest version at deploy time.

- `supabase-db-url` — pooler connection string (IPv4 pooler, never the direct host).
- `supabase-service-role-key` — for service-to-service Supabase access bypassing RLS.
- `twilio-account-sid`, `twilio-auth-token`, `twilio-signing-key`.
- `provider-key-{openai,anthropic,groq,deepgram,assemblyai,elevenlabs,cartesia}` — one per provider.
- `internal-svc-token` — shared secret for service-to-service HTTPS (orchestrator → worker signed token verification).

## Provider Abstraction

The feature-defining design element. Per-agent, independent choice of STT, LLM, and TTS. Swapping any of the three is a row update on `agents`; in-flight calls are unaffected because they read from `calls.agent_version_snapshot`.

### Registry (Python, in `pipecat-worker`)

```
pipecat_worker/providers/
├── registry.py          # PROVIDERS: dict[Kind, dict[Name, Factory]]
├── types.py             # ProviderKind, Factory = Callable[[cfg, creds], Service]
├── stt/
│   ├── deepgram.py
│   ├── assemblyai.py
│   └── __init__.py      # registers into PROVIDERS
├── llm/
│   ├── openai.py
│   ├── anthropic.py
│   ├── groq.py
│   └── __init__.py
└── tts/
    ├── elevenlabs.py
    ├── cartesia.py
    ├── openai.py
    └── __init__.py
```

A single call `PROVIDERS["tts"]["cartesia"](cfg, creds)` returns a pipecat service instance. Adding a provider: one file + one registration line.

### Credential injection

Worker boots and pulls all `provider-key-*` secrets from Secret Manager into an in-memory `dict`. Factories receive credentials via dependency injection; no provider module reads environment variables. Consequences:

- Rotation: write new secret version, recycle workers (natural or triggered via `gcloud run services update --env=<bump>`). No code change.
- Tests: pass fake credentials into the factory. No mocks on env or module globals.

### Day-1 provider catalog

| Kind | Providers | Why |
|---|---|---|
| STT | Deepgram, AssemblyAI | Deepgram for real-time latency, AssemblyAI as second source for quality comparisons. |
| LLM | OpenAI, Anthropic, Groq | OpenAI baseline reliability; Anthropic for quality-first agents; Groq when latency dominates. |
| TTS | ElevenLabs, Cartesia, OpenAI | ElevenLabs for voice quality; Cartesia for the lowest time-to-first-audio; OpenAI as a cheap fallback. |

### Pipeline shape (per call)

```
Twilio Media Streams WS
  → FrameProcessor: μ-law@8kHz → PCM@16kHz
  → STT (selected)           — emits TranscriptionFrame
  → ContextAggregator
  → LLM (selected)           — emits streaming TextFrame
  → TTS (selected)           — emits AudioRawFrame
  → FrameProcessor: PCM@16kHz → μ-law@8kHz
  → Twilio Media Streams WS out
```

Side channels:

- Each `TranscriptionFrame` → batch buffer (flush every 500ms or 10 events) → `call_events` insert.
- Call end (clean or error) → finalize `calls.transcript_json`, set `status`, `ended_at`, `end_reason`.
- Unhandled error → `call_events` row with `kind='provider_error'`.

### Failure modes

| Failure | Behavior |
|---|---|
| STT disconnect / rate limit | Log; emit filler ("Sorry, I didn't catch that"); reconnect. 3 failures in 30s → end call with `end_reason='stt_failed'`. |
| LLM error | Log; emit filler ("One moment please"); retry once. If `agents.llm_fallback_provider` is set, use it on retry. Second failure → end call with `end_reason='llm_failed'`. Default fallback off. |
| TTS error | Immediate call end with `end_reason='tts_failed'`. Silence = dead call from the caller's perspective; degradation would be worse than termination. |

No mid-call failover beyond what the table describes. Retrying more aggressively consumes time the caller can hear.

## Reliability

1. **Idempotent webhooks.** `call-orchestrator` upserts on `twilio_call_sid`. Twilio retries on 5xx; duplicate inserts are a correctness bug.
2. **Cloud Tasks for everything deferrable.** Outbound dispatch, recording pulls, transcript finalization fallback. Exponential backoff, max 5 retries in 10 minutes, failures land in a dead-letter Cloud Tasks queue that feeds a Cloud Monitoring alert.
3. **Ephemeral workers.** A pipecat worker crash drops the call. No resume — state recovery is more likely to produce corrupt audio than to help at 2-5 min call length.
4. **Best-effort event writes, authoritative finalization.** `call_events` writes log WARN on failure and the voice path continues. The `calls` row update at call end is authoritative: retried 3x in-process, then handed to a Cloud Task if still failing.
5. **Cold-start budget.** `pipecat-worker` runs `min-instances=2` to eat the Python import cost (~5-8s) on the first idle request. Cost: ~$60/mo.
6. **Connection pooling.** Workers connect only to the Supabase Transaction Pooler (IPv4, pgbouncer). Direct `db.*.supabase.co` host is IPv6-only and unusable from Cloud Run. Making the pooler URL the only connection string is enforced by Secret Manager naming (`supabase-db-url` is always the pooler string).

## Observability

- **Custom metrics** (OpenTelemetry → Cloud Monitoring):
  - `voice.call.duration_seconds` histogram (tags: `agent_id`, `end_reason`).
  - `voice.call.concurrent` gauge.
  - `voice.stt.latency_ms`, `voice.llm.first_token_ms`, `voice.tts.first_audio_ms` histograms (tag: `provider`).
  - `voice.provider.errors_total` counter (tags: `provider`, `kind`).
- **Structured logs.** Every log line carries `call_id`, `tenant_id`, `agent_id`, `session_id`. Cloud Logging queries filter by these.
- **Supabase logs explorer** covers slow queries and Auth events. Nothing custom needed there.

### Alerts

| Alert | Condition | Severity |
|---|---|---|
| Call failure rate | `provider_errors_total / calls_started > 5%` over 10 min | Page |
| Concurrency near quota | `voice.call.concurrent > 80% of max-instances` | Page |
| Cloud Tasks dead-letter non-empty | any message in DLQ | Page |
| Recording pull lag | p95 `recording_pull_lag_seconds > 5 min` | Email |
| Supabase pooler exhausted | Cloud Run logs match `pool exhausted` > 10 in 5 min | Page |

No per-provider latency alerts. Provider swaps are expected to shift latency; noise would hide real regressions. Latency lives on the dashboard.

## Auth, RLS, Secrets

### UI auth

Supabase Auth with Google OAuth, `hd=confido.health` restricts to Confido Workspace. A DB trigger on `auth.users` rejects inserts with a non-`@confido.health` email as a belt-and-suspenders check.

### Service auth

Service-to-service requests carry a signed JWT minted by the caller using `internal-svc-token` (HMAC). Receivers verify the token before acting. No IAM-based Cloud Run invocation auth on the pipecat WS endpoint (Twilio can't sign those) — the signed session token in the WS URL is the auth boundary.

### RLS policies

Services connect with the `service_role` key and bypass RLS. RLS is the defense boundary for the UI path (anon JWT).

```sql
alter table users enable row level security;
create policy users_self_read on users for select using (id = auth.uid());
create policy users_admin_all  on users for all    using (internal.is_admin(auth.uid()));

alter table tenants enable row level security;
create policy tenants_read_all    on tenants for select using (auth.role() = 'authenticated');
create policy tenants_admin_write on tenants for all    using (internal.is_admin(auth.uid()));

alter table agents enable row level security;
create policy agents_read_all    on agents for select using (auth.role() = 'authenticated');
create policy agents_admin_write on agents for all    using (internal.is_admin(auth.uid()));

alter table calls enable row level security;
create policy calls_read_all on calls for select using (auth.role() = 'authenticated');
-- no UI writes. service_role only.

alter table call_events enable row level security;
create policy events_read_all on call_events for select using (auth.role() = 'authenticated');

alter table audit_log enable row level security;
create policy audit_admin_read on audit_log for select using (internal.is_admin(auth.uid()));
```

`internal.is_admin(uuid)` is a `SECURITY DEFINER` function in a non-`public` schema that reads `users.role`. Role assignment is admin-UI-only and emits an `audit_log` row.

Every table with an UPDATE policy has a matching SELECT policy (required by Postgres RLS for UPDATE to see its own rows).

### Storage RLS

`call-recordings` bucket has no public policies. Only `service_role` reads/writes. UI obtains a signed URL from `admin-api`, which enforces JWT validation and optional agent-scope checks before signing.

## Repo Layout (monorepo)

```
confido2/
├── docs/superpowers/specs/
├── services/
│   ├── pipecat-worker/      # Python, uv
│   ├── call-orchestrator/
│   ├── dispatcher-worker/
│   ├── admin-api/
│   └── ui/                  # Next.js
├── packages/
│   └── shared/              # TS: zod schemas, types, DB helpers
├── supabase/
│   ├── migrations/
│   ├── config.toml
│   └── functions/pull-twilio-recording/
├── infra/terraform/
│   ├── envs/{dev,prod}/
│   └── modules/{cloud-run,cloud-tasks,secrets,monitoring,dns}/
├── .github/workflows/
├── package.json             # npm workspaces + turbo
└── pyproject.toml           # pipecat-worker
```

## IaC

- **Terraform manages:** Cloud Run services (image digest pinned), Cloud Tasks queues (`outbound`, `outbound-dlq`, `recording-pull`), Secret Manager secrets (names only, values written by humans), IAM bindings, Cloud Monitoring alert policies, DNS records, Artifact Registry.
- **Terraform does not manage:** Supabase schema (owned by `supabase/migrations/`), Twilio phone numbers (owned by Twilio console; mapping lives in `twilio_numbers` table).
- **State:** GCS backend at `gs://tfstate-clinical-workflow-lakeway/<env>`, object locking on.
- **Two envs:** `dev` (separate Supabase project ref) and `prod` (`ktfhsoajopeapqprmioj`). No staging.

## CI/CD (GitHub Actions)

Three pipelines:

1. **PR checks** — typecheck, lint, Jest/Vitest, pytest, `supabase db diff` drift check, `terraform plan` against dev. No deploy.
2. **Deploy dev** (merge to `main`) — run Supabase migrations, build + push images (Cloud Build), `terraform apply` with new digests, run E2E smoke (one synthetic inbound call to a dev test number, assert recording + transcript lands).
3. **Deploy prod** (manual `workflow_dispatch` with approval) — same steps against prod.

Rollback: redeploy previous image digest. `terraform apply` is deterministic given the digest.

## Testing

- **Unit:** Jest/Vitest (TS), pytest (Python). Provider registry aims for 100% coverage — it's the thing that breaks if a factory signature drifts.
- **Integration:** `pipecat-worker` runs locally against `supabase start`; a fake Twilio WS client streams pre-recorded μ-law audio and asserts transcript + events. Runs in CI.
- **E2E smoke on deploy:** one real Twilio inbound call per deploy against a dedicated test number + test agent. Assertions: answered < 2s, first_message spoken, clean end, recording present, transcript row. Failure rolls back the deploy.
- **Load test:** scripted ramp 0→300 concurrent over 10 min, run pre-launch and after structural pipecat changes. Not every deploy.

## Non-goals

Explicit to prevent scope creep:

1. No HIPAA, BAAs, or PHI safeguards.
2. No tenant-facing UI or tenant auth. Second UI is a separate project if ever needed.
3. No multi-region. `us-central1` for GCP; single Supabase region.
4. No call resume on worker crash.
5. No mid-call provider failover beyond the optional LLM fallback flag (default off).
6. No campaign / list upload UI. Outbound is API-triggered.
7. No SIP trunking on day 1. Elastic SIP is a later lever; orchestrator must accept a trunking provider as config.
8. No BYO provider keys. Platform-managed only.
9. No analytics dashboards / aggregates. The UI shows individual calls.
10. No audio re-transcription pass. Live STT is canonical.

## Open items before implementation

Not engineering decisions; need product input:

- **Twilio numbers.** Who buys them, how many, area codes, pool vs. dedicated per tenant.
- **Test number + test agent** for the prod smoke test.
- **Supabase Auth Google provider** configured with `hd=confido.health` — Supabase dashboard click, not code.
