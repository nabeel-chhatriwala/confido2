# Plan E: Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next.js internal dashboard with Google SSO (`hd=confido.health`), a live call list (Supabase Realtime), per-call detail with transcript + audio playback via signed URL minted by `admin-api`, and an agent editor that POSTs to `admin-api /api/agents/:id/publish`.

**Architecture:** Next.js 15 app router, server components where possible, client components for Realtime + forms. Uses `@supabase/ssr` to share auth between server and client. Signed URL for audio is minted by `admin-api` — the browser never holds a service-role key.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, `@supabase/ssr`, `@supabase/supabase-js`, shadcn/ui (button, input, select, table primitives).

---

## File Structure

```
services/ui/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── Dockerfile
├── .env.example
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                  # redirect to /calls
│   │   ├── (auth)/
│   │   │   ├── layout.tsx            # minimal layout (no sidebar)
│   │   │   ├── signin/page.tsx
│   │   │   └── auth/callback/route.ts
│   │   └── (app)/
│   │       ├── layout.tsx            # sidebar + requires session
│   │       ├── calls/
│   │       │   ├── page.tsx          # live list
│   │       │   └── [id]/page.tsx     # detail
│   │       ├── agents/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx     # editor
│   │       └── tenants/page.tsx
│   ├── components/
│   │   ├── calls-table.tsx
│   │   ├── call-live-row.tsx
│   │   ├── agent-form.tsx
│   │   └── ui/                       # shadcn-style primitives
│   │       ├── button.tsx
│   │       ├── input.tsx
│   │       └── select.tsx
│   ├── lib/
│   │   ├── supabase-server.ts
│   │   ├── supabase-browser.ts
│   │   ├── admin-api.ts              # typed fetch client for admin-api
│   │   └── formatters.ts
│   └── middleware.ts                 # gate all /(app) routes
└── admin-api/src/routes/calls-signed-url.ts   # (in admin-api service) POST /api/calls/:id/signed-url
```

Also:

```
services/admin-api/src/routes/
├── calls-signed-url.ts            # mints 5-min signed URL for recording
├── calls-list.ts                  # optional: paginated list (UI can hit Supabase directly, this is for filtered queries)
└── agents-list.ts                 # ditto
```

---

## Task 1: admin-api — signed-URL route for recordings

**Files:**
- Create: `services/admin-api/src/routes/calls-signed-url.ts`
- Modify: `services/admin-api/src/index.ts`
- Modify: `services/admin-api/src/auth.ts`

- [ ] **Step 1.1: Relax auth.ts to allow any authenticated user (not just admin)**

Modify `services/admin-api/src/auth.ts` — add a `requireAuthenticated` helper alongside `requireAdmin`:

```typescript
import { jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';

export interface AuthedUser {
  sub: string;
  email: string;
  role: 'viewer' | 'admin';
}

async function verifyToken(req: FastifyRequest): Promise<{ sub: string; email: string }> {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
  const secret = new TextEncoder().encode(config.supabaseJwtSecret);
  const { payload } = await jwtVerify(token, secret);
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw Object.assign(new Error('invalid token'), { statusCode: 401 });
  }
  return { sub: payload.sub, email: payload.email };
}

async function getUserRole(userId: string): Promise<'viewer' | 'admin'> {
  const { supabase } = await import('./supabase.js');
  const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  return (data?.role as 'viewer' | 'admin') ?? 'viewer';
}

export async function requireAuthenticated(req: FastifyRequest): Promise<AuthedUser> {
  const { sub, email } = await verifyToken(req);
  const role = await getUserRole(sub);
  return { sub, email, role };
}

export async function requireAdmin(req: FastifyRequest): Promise<AuthedUser> {
  const user = await requireAuthenticated(req);
  if (user.role !== 'admin') throw Object.assign(new Error('admin required'), { statusCode: 403 });
  return user;
}
```

- [ ] **Step 1.2: Signed URL route**

Create `services/admin-api/src/routes/calls-signed-url.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { supabase } from '../supabase.js';
import { requireAuthenticated } from '../auth.js';

interface Params { id: string }

export async function registerCallsSignedUrlRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: Params }>('/api/calls/:id/signed-url', async (req, reply) => {
    try {
      await requireAuthenticated(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }
    const { id } = req.params;
    const { data: call, error: callErr } = await supabase
      .from('calls')
      .select('recording_object_path')
      .eq('id', id)
      .single();
    if (callErr || !call?.recording_object_path) {
      return reply.code(404).send({ error: 'no recording' });
    }
    const { data, error } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(call.recording_object_path, 300);
    if (error || !data) return reply.code(500).send({ error: error?.message ?? 'sign failed' });
    return reply.send({ url: data.signedUrl, expiresIn: 300 });
  });
}
```

- [ ] **Step 1.3: Register**

Modify `services/admin-api/src/index.ts`:

```typescript
import { registerCallsSignedUrlRoute } from './routes/calls-signed-url.js';
// ...
await registerCallsSignedUrlRoute(app);
```

- [ ] **Step 1.4: Typecheck + commit**

Run: `npm run typecheck --workspace=@confido/admin-api`
Expected: clean.

```bash
git add services/admin-api/src/routes/calls-signed-url.ts services/admin-api/src/auth.ts services/admin-api/src/index.ts
git commit -m "feat(admin-api): add signed-URL minting for call recordings"
```

---

## Task 2: Scaffold Next.js UI

**Files:**
- Create: `services/ui/package.json`
- Create: `services/ui/tsconfig.json`
- Create: `services/ui/next.config.mjs`
- Create: `services/ui/tailwind.config.ts`
- Create: `services/ui/postcss.config.mjs`
- Create: `services/ui/src/app/layout.tsx`
- Create: `services/ui/src/app/globals.css`
- Create: `services/ui/src/app/page.tsx`
- Create: `services/ui/.env.example`

- [ ] **Step 2.1: package.json**

Create `services/ui/package.json`:

```json
{
  "name": "@confido/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 8080",
    "lint": "next lint",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@confido/shared": "*",
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.47.0",
    "clsx": "^2.1.1",
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.5.4"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "eslint-config-next": "^15.0.3",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2.2: tsconfig.json**

Create `services/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2.3: next.config + tailwind + postcss**

Create `services/ui/next.config.mjs`:

```javascript
const config = {
  output: 'standalone',
  experimental: {
    externalDir: true,
  },
};
export default config;
```

Create `services/ui/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

Create `services/ui/postcss.config.mjs`:

```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 2.4: Global CSS**

Create `services/ui/src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body { height: 100%; }
body { @apply bg-slate-50 text-slate-900 antialiased; }
```

- [ ] **Step 2.5: Root layout + landing redirect**

Create `services/ui/src/app/layout.tsx`:

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Confido Voice' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `services/ui/src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
export default function Index() {
  redirect('/calls');
}
```

- [ ] **Step 2.6: .env.example**

Create `services/ui/.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ADMIN_API_URL=
```

- [ ] **Step 2.7: Install + smoke boot**

Run: `npm install`
Then: `npm run dev --workspace=@confido/ui`
Expected: `ready` at http://localhost:3000 — visiting redirects to `/calls` (which 404s for now; that's fine).
Ctrl-C.

- [ ] **Step 2.8: Commit**

```bash
git add services/ui package.json package-lock.json
git commit -m "feat(ui): scaffold Next.js 15 app"
```

---

## Task 3: Supabase SSR clients + middleware

**Files:**
- Create: `services/ui/src/lib/supabase-server.ts`
- Create: `services/ui/src/lib/supabase-browser.ts`
- Create: `services/ui/src/middleware.ts`

- [ ] **Step 3.1: supabase-server.ts**

Create `services/ui/src/lib/supabase-server.ts`:

```typescript
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) =>
          items.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) =>
            cookieStore.set({ name, value, ...options }),
          ),
      },
    },
  );
}
```

- [ ] **Step 3.2: supabase-browser.ts**

Create `services/ui/src/lib/supabase-browser.ts`:

```typescript
'use client';
import { createBrowserClient } from '@supabase/ssr';

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 3.3: middleware.ts**

Create `services/ui/src/middleware.ts`:

```typescript
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) =>
          items.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) =>
            response.cookies.set({ name, value, ...options }),
          ),
      },
    },
  );
  const { data } = await supabase.auth.getUser();

  const isSignin = request.nextUrl.pathname === '/signin' || request.nextUrl.pathname.startsWith('/auth');
  if (!data.user && !isSignin) {
    const url = request.nextUrl.clone();
    url.pathname = '/signin';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 3.4: Commit**

```bash
git add services/ui/src/lib services/ui/src/middleware.ts
git commit -m "feat(ui): add Supabase SSR clients + gate middleware"
```

---

## Task 4: Sign-in page + OAuth callback

**Files:**
- Create: `services/ui/src/app/(auth)/layout.tsx`
- Create: `services/ui/src/app/(auth)/signin/page.tsx`
- Create: `services/ui/src/app/(auth)/auth/callback/route.ts`

- [ ] **Step 4.1: (auth) layout**

Create `services/ui/src/app/(auth)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-slate-50">{children}</div>;
}
```

- [ ] **Step 4.2: Sign-in page**

Create `services/ui/src/app/(auth)/signin/page.tsx`:

```tsx
'use client';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function SignInPage() {
  const signIn = async () => {
    const supabase = supabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: 'confido.health' },
      },
    });
  };
  return (
    <div className="w-full max-w-sm rounded-lg border bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold">Confido Voice</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in with your @confido.health account.</p>
      <button
        className="mt-6 w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800"
        onClick={signIn}
      >
        Continue with Google
      </button>
    </div>
  );
}
```

- [ ] **Step 4.3: Callback route**

Create `services/ui/src/app/(auth)/auth/callback/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}/calls`);
}
```

- [ ] **Step 4.4: Commit**

```bash
git add "services/ui/src/app/(auth)"
git commit -m "feat(ui): add sign-in page and OAuth callback"
```

---

## Task 5: Admin-api fetch client + app layout

**Files:**
- Create: `services/ui/src/lib/admin-api.ts`
- Create: `services/ui/src/app/(app)/layout.tsx`

- [ ] **Step 5.1: admin-api client**

Create `services/ui/src/lib/admin-api.ts`:

```typescript
import { supabaseServer } from './supabase-server';

export async function adminApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('no session');

  const url = `${process.env.ADMIN_API_URL}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}
```

- [ ] **Step 5.2: App layout (sidebar)**

Create `services/ui/src/app/(app)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return (
    <div className="min-h-screen grid grid-cols-[220px_1fr]">
      <aside className="border-r bg-white p-4">
        <div className="font-semibold">Confido Voice</div>
        <nav className="mt-6 space-y-1 text-sm">
          <Link href="/calls" className="block rounded px-2 py-1 hover:bg-slate-100">Calls</Link>
          <Link href="/agents" className="block rounded px-2 py-1 hover:bg-slate-100">Agents</Link>
          <Link href="/tenants" className="block rounded px-2 py-1 hover:bg-slate-100">Tenants</Link>
        </nav>
        <div className="mt-8 text-xs text-slate-500">{data.user?.email}</div>
      </aside>
      <main className="p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 5.3: Commit**

```bash
git add services/ui/src/lib/admin-api.ts "services/ui/src/app/(app)"
git commit -m "feat(ui): add admin-api fetch client and app layout"
```

---

## Task 6: Calls list page with Realtime

**Files:**
- Create: `services/ui/src/app/(app)/calls/page.tsx`
- Create: `services/ui/src/components/calls-table.tsx`

- [ ] **Step 6.1: Server page**

Create `services/ui/src/app/(app)/calls/page.tsx`:

```tsx
import { supabaseServer } from '@/lib/supabase-server';
import { CallsTable } from '@/components/calls-table';

export const dynamic = 'force-dynamic';

export default async function CallsPage() {
  const supabase = await supabaseServer();
  const { data: calls } = await supabase
    .from('calls')
    .select('id, started_at, direction, from_number, to_number, status, end_reason, duration_seconds, agent_id')
    .order('started_at', { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Calls</h1>
      <div className="mt-6">
        <CallsTable initial={calls ?? []} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6.2: Client table with Realtime**

Create `services/ui/src/components/calls-table.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase-browser';

interface Row {
  id: string;
  started_at: string | null;
  direction: 'inbound' | 'outbound';
  from_number: string;
  to_number: string;
  status: string;
  end_reason: string | null;
  duration_seconds: number | null;
  agent_id: string;
}

export function CallsTable({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel('calls-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls' },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === 'INSERT') {
              return [payload.new as Row, ...prev].slice(0, 100);
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map((r) => (r.id === (payload.new as Row).id ? (payload.new as Row) : r));
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter((r) => r.id !== (payload.old as Row).id);
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500">
        <tr>
          <th className="py-2">Started</th>
          <th>Dir</th>
          <th>From</th>
          <th>To</th>
          <th>Status</th>
          <th>Duration</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="py-2">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</td>
            <td>{r.direction}</td>
            <td>{r.from_number}</td>
            <td>{r.to_number}</td>
            <td>
              <span className={statusClass(r.status)}>{r.end_reason ?? r.status}</span>
            </td>
            <td>{r.duration_seconds ?? '—'}</td>
            <td>
              <Link href={`/calls/${r.id}`} className="text-blue-600 hover:underline">open</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statusClass(s: string): string {
  if (s === 'in_progress' || s === 'dialing') return 'text-amber-600';
  if (s === 'completed') return 'text-emerald-600';
  if (s === 'failed') return 'text-rose-600';
  return 'text-slate-600';
}
```

- [ ] **Step 6.3: Enable Realtime in Supabase**

On the Supabase dashboard (or via SQL): enable `public.calls` for Realtime.

Create a new migration `supabase/migrations/20260417000009_realtime.sql`:

```sql
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.call_events;
```

Apply: `supabase db reset` locally, `supabase db push` to remote.

- [ ] **Step 6.4: Commit**

```bash
git add "services/ui/src/app/(app)/calls" services/ui/src/components/calls-table.tsx supabase/migrations/20260417000009_realtime.sql
git commit -m "feat(ui): add calls list with Supabase Realtime"
```

---

## Task 7: Call detail page with transcript + audio

**Files:**
- Create: `services/ui/src/app/(app)/calls/[id]/page.tsx`

- [ ] **Step 7.1: Detail page**

Create `services/ui/src/app/(app)/calls/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { adminApiFetch } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: call } = await supabase
    .from('calls')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!call) notFound();

  const { data: events } = await supabase
    .from('call_events')
    .select('id, kind, payload, occurred_at')
    .eq('call_id', id)
    .order('occurred_at', { ascending: true })
    .limit(500);

  let audioUrl: string | null = null;
  if (call.recording_object_path) {
    const resp = await adminApiFetch(`/api/calls/${id}/signed-url`, { method: 'POST' });
    if (resp.ok) {
      const body = (await resp.json()) as { url: string };
      audioUrl = body.url;
    }
  }

  const turns: Array<{ role: string; content: string }> =
    (call.transcript_json as { turns?: Array<{ role: string; content: string }> } | null)?.turns ?? [];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Call {id.slice(0, 8)}</h1>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div><span className="text-slate-500">Status:</span> {call.status}{call.end_reason ? ` (${call.end_reason})` : ''}</div>
        <div><span className="text-slate-500">Direction:</span> {call.direction}</div>
        <div><span className="text-slate-500">From:</span> {call.from_number}</div>
        <div><span className="text-slate-500">To:</span> {call.to_number}</div>
        <div><span className="text-slate-500">Started:</span> {call.started_at ? new Date(call.started_at).toLocaleString() : '—'}</div>
        <div><span className="text-slate-500">Duration:</span> {call.duration_seconds ?? '—'}s</div>
      </div>

      {audioUrl && (
        <div className="mt-6">
          <audio controls src={audioUrl} className="w-full" preload="none" />
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">Transcript</h2>
      <div className="mt-2 rounded border bg-white p-4 text-sm">
        {turns.length === 0 ? (
          <div className="text-slate-500">No transcript yet.</div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className="mb-2">
              <span className="font-medium text-slate-700">{t.role}:</span> {t.content}
            </div>
          ))
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Events</h2>
      <ul className="mt-2 text-xs text-slate-600 space-y-1 font-mono">
        {(events ?? []).map((e) => (
          <li key={e.id}>
            {new Date(e.occurred_at).toISOString()} · {e.kind} · {JSON.stringify(e.payload)}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7.2: Commit**

```bash
git add "services/ui/src/app/(app)/calls/[id]"
git commit -m "feat(ui): add call detail with transcript, events, audio playback"
```

---

## Task 8: Agents list + editor with publish

**Files:**
- Create: `services/ui/src/app/(app)/agents/page.tsx`
- Create: `services/ui/src/app/(app)/agents/[id]/page.tsx`
- Create: `services/ui/src/components/agent-form.tsx`

- [ ] **Step 8.1: Agents list**

Create `services/ui/src/app/(app)/agents/page.tsx`:

```tsx
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const supabase = await supabaseServer();
  const { data: agents } = await supabase
    .from('agents')
    .select('id, name, stt_provider, llm_provider, tts_provider, current_version')
    .order('name');
  return (
    <div>
      <h1 className="text-2xl font-semibold">Agents</h1>
      <table className="mt-6 w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr><th className="py-2">Name</th><th>STT</th><th>LLM</th><th>TTS</th><th>Version</th><th></th></tr>
        </thead>
        <tbody>
          {(agents ?? []).map((a) => (
            <tr key={a.id} className="border-t">
              <td className="py-2">{a.name}</td>
              <td>{a.stt_provider}</td>
              <td>{a.llm_provider}</td>
              <td>{a.tts_provider}</td>
              <td>{a.current_version}</td>
              <td><Link href={`/agents/${a.id}`} className="text-blue-600 hover:underline">edit</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8.2: Agent editor page (server fetch + client form)**

Create `services/ui/src/app/(app)/agents/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { AgentForm } from '@/components/agent-form';

export const dynamic = 'force-dynamic';

export default async function AgentEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: agent } = await supabase.from('agents').select('*').eq('id', id).maybeSingle();
  if (!agent) notFound();
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Agent: {agent.name}</h1>
      <AgentForm agent={agent} />
    </div>
  );
}
```

- [ ] **Step 8.3: AgentForm client component**

Create `services/ui/src/components/agent-form.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Agent = {
  id: string;
  name: string;
  system_prompt: string;
  first_message: string;
  stt_provider: string;
  stt_config: Record<string, unknown>;
  llm_provider: string;
  llm_config: Record<string, unknown>;
  tts_provider: string;
  tts_config: Record<string, unknown>;
  current_version: number;
};

const STT = ['deepgram', 'assemblyai'] as const;
const LLM = ['openai', 'anthropic', 'groq'] as const;
const TTS = ['elevenlabs', 'cartesia', 'openai'] as const;

export function AgentForm({ agent }: { agent: Agent }) {
  const [state, setState] = useState(agent);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const save = async () => {
    const supabase = supabaseBrowser();
    const { error } = await supabase
      .from('agents')
      .update({
        name: state.name,
        system_prompt: state.system_prompt,
        first_message: state.first_message,
        stt_provider: state.stt_provider,
        stt_config: state.stt_config,
        llm_provider: state.llm_provider,
        llm_config: state.llm_config,
        tts_provider: state.tts_provider,
        tts_config: state.tts_config,
      })
      .eq('id', state.id);
    setMsg(error ? `Save failed: ${error.message}` : 'Saved.');
    if (!error) startTransition(() => router.refresh());
  };

  const publish = async () => {
    const supabase = supabaseBrowser();
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    const resp = await fetch(`${process.env.NEXT_PUBLIC_ADMIN_API_URL}/api/agents/${state.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await resp.json()) as { version?: number; error?: string };
    setMsg(resp.ok ? `Published v${body.version}.` : `Publish failed: ${body.error}`);
    if (resp.ok) startTransition(() => router.refresh());
  };

  return (
    <div className="mt-6 space-y-4">
      <Labeled label="Name">
        <input className="w-full rounded border p-2" value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
      </Labeled>
      <Labeled label="System prompt">
        <textarea className="w-full rounded border p-2 font-mono text-xs" rows={8}
          value={state.system_prompt} onChange={(e) => setState({ ...state, system_prompt: e.target.value })} />
      </Labeled>
      <Labeled label="First message">
        <input className="w-full rounded border p-2" value={state.first_message}
          onChange={(e) => setState({ ...state, first_message: e.target.value })} />
      </Labeled>

      <div className="grid grid-cols-3 gap-4">
        <ProviderSelect label="STT" value={state.stt_provider} options={STT}
          onChange={(v) => setState({ ...state, stt_provider: v })} />
        <ProviderSelect label="LLM" value={state.llm_provider} options={LLM}
          onChange={(v) => setState({ ...state, llm_provider: v })} />
        <ProviderSelect label="TTS" value={state.tts_provider} options={TTS}
          onChange={(v) => setState({ ...state, tts_provider: v })} />
      </div>

      <Labeled label="TTS config (JSON)">
        <textarea className="w-full rounded border p-2 font-mono text-xs" rows={3}
          value={JSON.stringify(state.tts_config, null, 2)}
          onChange={(e) => {
            try { setState({ ...state, tts_config: JSON.parse(e.target.value) }); } catch { /* ignore until valid */ }
          }} />
      </Labeled>

      <div className="flex gap-2">
        <button onClick={save} disabled={pending}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          Save draft
        </button>
        <button onClick={publish} disabled={pending}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
          Publish v{(state.current_version ?? 0) + 1}
        </button>
      </div>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ProviderSelect<T extends string>({
  label, value, options, onChange,
}: { label: string; value: string; options: readonly T[]; onChange: (v: string) => void }) {
  return (
    <Labeled label={label}>
      <select className="w-full rounded border p-2" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </Labeled>
  );
}
```

- [ ] **Step 8.4: Add ADMIN_API_URL exposure**

Modify `services/ui/next.config.mjs`:

```javascript
const config = {
  output: 'standalone',
  experimental: { externalDir: true },
  env: {
    NEXT_PUBLIC_ADMIN_API_URL: process.env.ADMIN_API_URL,
  },
};
export default config;
```

- [ ] **Step 8.5: Typecheck + commit**

Run: `npm run typecheck --workspace=@confido/ui`
Expected: clean.

```bash
git add "services/ui/src/app/(app)/agents" services/ui/src/components/agent-form.tsx services/ui/next.config.mjs
git commit -m "feat(ui): add agents list + editor with save + publish"
```

---

## Task 9: Tenants stub page

**Files:**
- Create: `services/ui/src/app/(app)/tenants/page.tsx`

- [ ] **Step 9.1: Tenants page**

Create `services/ui/src/app/(app)/tenants/page.tsx`:

```tsx
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function TenantsPage() {
  const supabase = await supabaseServer();
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, name, concurrency_cap')
    .order('name');
  return (
    <div>
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <table className="mt-6 w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr><th className="py-2">Name</th><th>Concurrency cap</th></tr>
        </thead>
        <tbody>
          {(tenants ?? []).map((t) => (
            <tr key={t.id} className="border-t"><td className="py-2">{t.name}</td><td>{t.concurrency_cap}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 9.2: Commit**

```bash
git add "services/ui/src/app/(app)/tenants"
git commit -m "feat(ui): add tenants list (read-only)"
```

---

## Task 10: UI Dockerfile

**Files:**
- Create: `services/ui/Dockerfile`
- Create: `services/ui/.dockerignore`

- [ ] **Step 10.1: Dockerfile**

Create `services/ui/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/ui/package.json services/ui/
RUN npm ci --workspace=@confido/shared --workspace=@confido/ui --include-workspace-root
COPY packages/shared packages/shared
COPY services/ui services/ui
RUN npm run build --workspace=@confido/shared
RUN npm run build --workspace=@confido/ui

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/services/ui/.next/standalone ./
COPY --from=builder /app/services/ui/.next/static ./services/ui/.next/static
COPY --from=builder /app/services/ui/public ./services/ui/public
EXPOSE 8080
ENV PORT=8080
CMD ["node", "services/ui/server.js"]
```

Create `services/ui/.dockerignore`:

```
node_modules
.next
.turbo
```

- [ ] **Step 10.2: Commit**

```bash
git add services/ui/Dockerfile services/ui/.dockerignore
git commit -m "chore(ui): add Dockerfile"
```

---

## Task 11: Plan E exit gate

- [ ] **Step 11.1: Build & typecheck everything**

Run: `npm run build && npm run typecheck`
Expected: clean (next build, tsc, admin-api, dispatcher).

- [ ] **Step 11.2: Manual smoke**

1. Start Supabase locally, run migrations.
2. `npm run dev --workspace=@confido/admin-api &`
3. `npm run dev --workspace=@confido/ui`
4. Visit http://localhost:3000 → redirect to /signin → (requires a Supabase Auth Google provider locally; optional to skip in truly offline dev).

- [ ] **Step 11.3: Push**

```bash
git push origin main
```

---

## What's done after Plan E

- Next.js app with Google SSO restricted to `@confido.health`, gated via middleware.
- Calls list (live-updating via Realtime), call detail with transcript/events/signed-URL audio playback.
- Agents list, agent editor with draft-save and publish (which bumps `current_version` and writes `agent_versions`).
- Tenants read-only list.

**Next:** Plan F wires IaC (Terraform) and CI/CD (GitHub Actions) so all four services deploy to Cloud Run with the right env, secrets, Cloud Tasks queues, and alerts.
