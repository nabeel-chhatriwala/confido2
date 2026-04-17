import { describe, it, expect } from 'vitest';
import { connectStreamTwiml, hangupTwiml } from '../src/twilio/twiml.js';

describe('TwiML builders', () => {
  it('emits a Connect/Stream with token', () => {
    const xml = connectStreamTwiml('wss://worker.example.com/ws?token=abc.def');
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Connect>');
    expect(xml).toContain('wss://worker.example.com/ws?token=abc.def');
    expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('emits hangup TwiML', () => {
    const xml = hangupTwiml();
    expect(xml).toContain('<Hangup/>');
  });

  it('escapes ampersands in WS URL', () => {
    const xml = connectStreamTwiml('wss://a?x=1&y=2');
    expect(xml).toContain('x=1&amp;y=2');
  });
});
