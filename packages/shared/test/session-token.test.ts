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
