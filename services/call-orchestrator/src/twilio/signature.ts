import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyTwilioSignature(
  authToken: string,
  fullUrl: string,
  params: Record<string, string>,
  headerSignature: string,
): boolean {
  const sortedConcat = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join('');
  const expected = createHmac('sha1', authToken).update(fullUrl + sortedConcat).digest('base64');
  const a = Buffer.from(headerSignature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
