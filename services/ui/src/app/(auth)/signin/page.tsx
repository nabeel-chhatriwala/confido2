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
      <h1 className="text-xl font-semibold">careos · voice</h1>
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
