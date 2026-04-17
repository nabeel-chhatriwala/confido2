function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Emits TwiML that opens a Twilio Media Streams WebSocket to the given URL.
 * Pass `parameters` to send application data in the WS `start` event's
 * `customParameters` (Twilio strips query strings off the WS URL).
 */
export function connectStreamTwiml(
  wsUrl: string,
  parameters: Record<string, string> = {},
): string {
  const paramXml = Object.entries(parameters)
    .map(([k, v]) => `      <Parameter name="${xmlEscape(k)}" value="${xmlEscape(v)}"/>`)
    .join('\n');
  const streamChildren = paramXml ? `\n${paramXml}\n    ` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Connect>\n` +
    `    <Stream url="${xmlEscape(wsUrl)}">${streamChildren}</Stream>\n` +
    `  </Connect>\n` +
    `</Response>`
  );
}

export function hangupTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`;
}
