import { describe, it, expect } from 'vitest';
import { connectStreamTwiml, hangupTwiml } from '../src/twilio/twiml.js';

describe('TwiML builders', () => {
  it('emits a Connect/Stream with url', () => {
    const xml = connectStreamTwiml('wss://worker.example.com/ws');
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Connect>');
    expect(xml).toContain('wss://worker.example.com/ws');
    expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('emits <Parameter> elements for passthrough params', () => {
    const xml = connectStreamTwiml('wss://w/ws', { token: 'abc.def', extra: 'x' });
    expect(xml).toContain('<Parameter name="token" value="abc.def"/>');
    expect(xml).toContain('<Parameter name="extra" value="x"/>');
  });

  it('emits hangup TwiML', () => {
    const xml = hangupTwiml();
    expect(xml).toContain('<Hangup/>');
  });

  it('escapes ampersands and quotes in values', () => {
    const xml = connectStreamTwiml('wss://a?x=1&y=2', { tok: 'a&b"c' });
    expect(xml).toContain('x=1&amp;y=2');
    expect(xml).toContain('value="a&amp;b&quot;c"');
  });
});
