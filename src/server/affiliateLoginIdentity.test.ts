import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { AffiliateLoginIdentityUnavailableError, readAffiliateLoginIdentity } from './affiliateLoginIdentity.js';

const account = {
  id: 'aff_shared_1', email: 'partner@example.test', affiliateCode: 'PARTNER1',
  status: 'active', passwordHash: 'fresh-private-credential', sessionVersion: 'fresh-private-generation',
  walletRevision: 2,
};
const documents = new Map<string, any>();
const reads: string[] = [];
const emailIndex = crypto.createHash('sha256').update(account.email).digest('hex');
const query = (collection: string, field?: string, value?: unknown, maximum?: number): any => ({
  collection, field, value, maximum,
  doc: (id: string) => ({ collection, id }),
  where: (field: string, operator: string, value: unknown) => {
    expect(operator).toBe('==');
    return query(collection, field, value);
  },
  limit: (maximum: number) => query(collection, field, value, maximum),
});
const snapshot = (id: string, value: any) => ({ id, exists: value !== undefined, data: () => structuredClone(value) });
const transactionGet = vi.fn(async (reference: any) => {
  if (reference.field) {
    expect(reference.maximum).toBe(2);
    reads.push(`query:${reference.field}`);
    return { docs: [...documents.entries()]
      .filter(([key, value]) => key.startsWith(`${reference.collection}/`) && value[reference.field] === reference.value)
      .slice(0, reference.maximum).map(([key, value]) => snapshot(key.split('/')[1], value)) };
  }
  reads.push(`${reference.collection}/${reference.id}`);
  return snapshot(reference.id, documents.get(`${reference.collection}/${reference.id}`));
});
const runTransaction = vi.fn(async (operation: any, options: any) => {
  expect(options).toEqual({ readOnly: true });
  // There are deliberately no write primitives in this fixture.
  return operation({ get: transactionGet });
});
const db = { collection: (collection: string) => query(collection), runTransaction } as unknown as Firestore;

beforeEach(() => {
  vi.clearAllMocks(); documents.clear(); reads.length = 0;
  documents.set(`affiliates/${account.id}`, structuredClone(account));
  documents.set(`affiliate_emails/${emailIndex}`, { affiliateId: account.id });
  documents.set(`affiliate_codes/${account.affiliateCode}`, { affiliateId: account.id });
});

describe('shared affiliate login identity', () => {
  it.each(['partner@example.test', ' PARTNER@EXAMPLE.TEST ', 'partner1', ' PARTNER1 '])(
    'resolves %s without any startup cache and returns the current credential', async login => {
      expect(await readAffiliateLoginIdentity(db, login)).toEqual(account);
      expect(reads).toHaveLength(2);
      expect(reads[1]).toBe(`affiliates/${account.id}`);
    }
  );

  it.each(['email', 'affiliateCode'] as const)('supports a legacy missing %s reservation with one bounded exact query', async field => {
    documents.delete(field === 'email' ? `affiliate_emails/${emailIndex}` : `affiliate_codes/${account.affiliateCode}`);
    const before = JSON.stringify([...documents]);
    expect(await readAffiliateLoginIdentity(db, account[field])).toEqual(account);
    expect(reads).toHaveLength(2);
    expect(reads[1]).toBe(`query:${field}`);
    expect(JSON.stringify([...documents])).toBe(before);
  });

  it('returns no identity for an unknown login without a directory scan', async () => {
    expect(await readAffiliateLoginIdentity(db, 'missing@example.test')).toBeUndefined();
    expect(reads).toHaveLength(2);
    expect(reads[1]).toBe('query:email');
  });

  it.each(['email', 'affiliateCode'] as const)('preserves mixed-case legacy %s through a fresh candidate-ID read', async field => {
    documents.delete(field === 'email' ? `affiliate_emails/${emailIndex}` : `affiliate_codes/${account.affiliateCode}`);
    const legacy = { ...account, [field]: field === 'email' ? 'Partner@Example.Test' : 'Partner1', passwordHash: 'actual-current-hash' };
    documents.set(`affiliates/${account.id}`, legacy);
    expect(await readAffiliateLoginIdentity(db, account[field], account.id)).toEqual(legacy);
    expect(reads).toHaveLength(3);
  });

  it('never accepts a stale candidate for an identity removed from that account', async () => {
    documents.delete(`affiliate_emails/${emailIndex}`);
    documents.set(`affiliates/${account.id}`, { ...account, email: 'different@example.test' });
    expect(await readAffiliateLoginIdentity(db, account.email, account.id)).toBeUndefined();
  });

  it('does not consult a candidate hint after an index ownership conflict', async () => {
    documents.set(`affiliate_emails/${emailIndex}`, { affiliateId: 'aff_missing' });
    await expect(readAffiliateLoginIdentity(db, account.email, account.id)).rejects.toMatchObject({ statusCode: 503 });
    expect(reads).toHaveLength(2);
  });

  it('does not authenticate a deleted account through its old reservation', async () => {
    documents.delete(`affiliates/${account.id}`);
    await expect(readAffiliateLoginIdentity(db, account.email)).rejects.toBeInstanceOf(AffiliateLoginIdentityUnavailableError);
    expect(reads).toHaveLength(2);
  });

  it.each(['email', 'affiliateCode'] as const)('fails closed when a reservation does not match the current %s', async field => {
    documents.set(`affiliates/${account.id}`, { ...account, [field]: field === 'email' ? 'other@example.test' : 'OTHER' });
    await expect(readAffiliateLoginIdentity(db, account[field])).rejects.toMatchObject({ statusCode: 503 });
    expect(reads).toHaveLength(2); // No stale cache or legacy-query fallback.
  });

  it('does not substitute a stored account ID inconsistent with its document', async () => {
    documents.set(`affiliates/${account.id}`, { ...account, id: 'aff_other' });
    await expect(readAffiliateLoginIdentity(db, account.email)).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each([null, '', '../other', 'aff/other', 'a'.repeat(161)])('rejects corrupt reservation owner %j', async affiliateId => {
    documents.set(`affiliate_emails/${emailIndex}`, { affiliateId });
    await expect(readAffiliateLoginIdentity(db, account.email)).rejects.toMatchObject({ statusCode: 503 });
    expect(reads).toHaveLength(1);
  });

  it('fails closed on duplicate legacy identities instead of selecting the first account', async () => {
    documents.delete(`affiliate_emails/${emailIndex}`);
    documents.set('affiliates/aff_duplicate', { ...account, id: 'aff_duplicate' });
    await expect(readAffiliateLoginIdentity(db, account.email)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('returns current suspension/credential state for the existing route to enforce', async () => {
    const changed = { ...account, status: 'suspended', passwordHash: 'rotated-credential', sessionVersion: 'rotated-generation' };
    documents.set(`affiliates/${account.id}`, changed);
    expect(await readAffiliateLoginIdentity(db, account.affiliateCode)).toEqual(changed);
  });

  it('redacts backend failure and reports retryable unavailability, never invalid credentials', async () => {
    transactionGet.mockRejectedValueOnce(new Error('private-provider-credential-and-resource-details'));
    await expect(readAffiliateLoginIdentity(db, account.email)).rejects.toMatchObject({
      statusCode: 503, message: 'Affiliate sign-in is temporarily unavailable. Please retry.'
    });
  });

  it.each([undefined, null, {}, '', ' ', '../partner', 'a/b@example.test', 'a\\b@example.test',
    'partner\n@example.test', 'two@@example.test', 'a'.repeat(255), 'code!'])('rejects invalid input %j before reading', async input => {
    expect(await readAffiliateLoginIdentity(db, input)).toBeUndefined();
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
