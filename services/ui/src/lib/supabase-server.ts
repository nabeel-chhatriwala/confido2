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
          items.forEach(
            ({ name, value, options }: { name: string; value: string; options: CookieOptions }) =>
              cookieStore.set({ name, value, ...options }),
          ),
      },
    },
  );
}
