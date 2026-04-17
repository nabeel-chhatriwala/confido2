import type { FastifyRequest } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export interface AuthedUser {
  sub: string;
  email: string;
}

// Validate user JWT by asking Supabase Auth directly; no JWT secret needed.
const anonClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function requireAuthenticated(req: FastifyRequest): Promise<AuthedUser> {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });

  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user?.email) {
    throw Object.assign(new Error('invalid token'), { statusCode: 401 });
  }
  return { sub: data.user.id, email: data.user.email };
}
