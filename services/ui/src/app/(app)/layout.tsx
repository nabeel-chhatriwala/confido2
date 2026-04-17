import type { ReactNode } from 'react';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return (
    <div className="min-h-screen grid grid-cols-[220px_1fr]">
      <aside className="border-r bg-white p-4">
        <div className="font-semibold">careos · voice</div>
        <nav className="mt-6 space-y-1 text-sm">
          <Link href="/calls" className="block rounded px-2 py-1 hover:bg-slate-100">Calls</Link>
          <Link href="/agents" className="block rounded px-2 py-1 hover:bg-slate-100">Agents</Link>
        </nav>
        <div className="mt-8 text-xs text-slate-500 break-all">{data.user?.email}</div>
      </aside>
      <main className="p-8">{children}</main>
    </div>
  );
}
