function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function connectStreamTwiml(wsUrl: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Connect>\n` +
    `    <Stream url="${xmlEscape(wsUrl)}"/>\n` +
    `  </Connect>\n` +
    `</Response>`
  );
}

export function hangupTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`;
}
