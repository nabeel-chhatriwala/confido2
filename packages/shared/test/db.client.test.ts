import { describe, it, expect } from 'vitest';
import { assertPoolerUrl } from '../src/db/client.js';

describe('assertPoolerUrl', () => {
  it('accepts aws-0-us-east-1.pooler.supabase.com', () => {
    expect(() =>
      assertPoolerUrl('postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres'),
    ).not.toThrow();
  });

  it('rejects the direct db host', () => {
    expect(() =>
      assertPoolerUrl('postgresql://postgres:pw@db.abc.supabase.co:5432/postgres'),
    ).toThrow(/pooler/i);
  });

  it('rejects any non-pooler host', () => {
    expect(() =>
      assertPoolerUrl('postgresql://postgres:pw@localhost:5432/postgres'),
    ).toThrow(/pooler/i);
  });
});
