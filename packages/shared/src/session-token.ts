import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionTokenPayload {
  call_id: string;
  tenant_id: string;
  agent_id: string;
}

interface EncodedToken extends SessionTokenPayload {
  exp: number;
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
