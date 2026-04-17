import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyTwilioSignature } from '../src/twilio/signature.js';

const AUTH_TOKEN = 'test-twilio-auth-token';
const URL = 'https://example.com/voice/inbound';

function computeSig(url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join('');
  return createHmac('sha1', AUTH_TOKEN).update(url + sorted).digest('base64');
}

describe('verifyTwilioSignature', () => {
  const params = { CallSid: 'CA1', From: '+15551234567', To: '+15557654321' };

  it('accepts a valid signature', () => {
    const sig = computeSig(URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, sig)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const sig = computeSig(URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, sig.slice(0, -2) + 'xx')).toBe(false);
  });

  it('rejects when params differ', () => {
    const sig = computeSig(URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, { ...params, From: '+10000000000' }, sig)).toBe(
      false,
    );
  });
});
