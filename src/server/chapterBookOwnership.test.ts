import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; value: Record<string, any> }>,
  queries: [] as Array<{ field: string; expected: unknown; limit: number }>,
  failure: false
}));
vi.mock('./db.js', () => ({
  getDb: () => ({
    collection: (name: string) => {
      if (name !== 'reader_licenses') throw new Error('Unexpected collection');
      return {
        where: (field: string, operator: string, expected: unknown) => {
          if (operator !== '==') throw new Error('Only exact reader queries allowed');
          return {
            limit: (limit: number) => ({
              get: async () => {
                mock.queries.push({ field, expected, limit });
                if (mock.failure) throw new Error('Firestore unavailable');
                return { docs: mock.rows.filter(row => row.value[field] === expected).slice(0, limit)
                  .map(row => ({ id: row.id, data: () => structuredClone(row.value) })) };
              }
            })
          };
        }
      };
    }
  })
}));

import { getPurchasedChapterIdsForUser, purchasedChapterIdsFromLicenses } from './chapterBookOwnership.js';

const now = Date.parse('2026-10-28T10:00:00.000Z');
const user = { id: 'reader-1', email: 'reader@example.com' };
const token = `ink_1793178000000_${'a'.repeat(64)}`;
const license = (value: Record<string, unknown> = {}, id = token) => ({
  id, value: { articleId: 'chapter-1', userId: user.id, email: user.email, expiresAt: now + 60_000,
    accessSource: 'MPESA_PURCHASE', receipt: 'UKB1AB2CD3', ...value }
});

describe('fresh chapter purchase ownership', () => {
  beforeEach(() => { mock.rows = []; mock.queries = []; mock.failure = false; });

  it('accepts account-bound paid purchases and preserves requested chapter order', () => {
    expect(purchasedChapterIdsFromLicenses(user, ['chapter-2', 'chapter-1'], [license(), license({ articleId: 'chapter-2' }, `ink_mpesa_${'x'.repeat(10)}`)], now))
      .toEqual(['chapter-2', 'chapter-1']);
  });

  it.each(['MANUAL_GRANT', 'SUBSCRIPTION', 'SYSTEM', 'AFFILIATE_CIRCLE'])('excludes %s access from purchase credit', accessSource => {
    expect(purchasedChapterIdsFromLicenses(user, ['chapter-1'], [license({ accessSource })], now)).toEqual([]);
  });

  it('never uses a matching phone or another bound account with the same email', () => {
    expect(purchasedChapterIdsFromLicenses(user, ['chapter-1'], [license({ userId: 'different-reader' })], now)).toEqual([]);
    expect(purchasedChapterIdsFromLicenses(user, ['chapter-1'], [license({ userId: undefined, email: 'other@example.com', phone: '254700000000' })], now)).toEqual([]);
  });

  it('accepts legacy unbound-email purchases only with a provider receipt', () => {
    expect(purchasedChapterIdsFromLicenses(user, ['chapter-1'], [license({ userId: undefined, email: 'READER@example.com', accessSource: undefined })], now)).toEqual(['chapter-1']);
    for (const receipt of ['', 'CONFIRMED', 'COMPLIMENTARY ACCESS']) {
      expect(purchasedChapterIdsFromLicenses(user, ['chapter-1'], [license({ userId: undefined, accessSource: undefined, receipt })], now)).toEqual([]);
    }
  });

  it.each([
    { expiresAt: now }, { expiresAt: now - 1 }, { expiresAt: Infinity }, { expiresAt: String(now + 1000) },
    { revoked: true }, { revokedAt: '2026-10-28T09:00:00Z' }, { status: 'REVOKED' }, { state: 'suspended' },
    { status: 'REFUNDED' }, { status: 'EXPIRED' }, { userId: 4 }, { token: 'another-token' }, { phone: 254700000000 }
  ])('excludes expired, malformed or revoked purchase rows %j', extra => {
    expect(purchasedChapterIdsFromLicenses(user, ['chapter-1'], [license(extra)], now)).toEqual([]);
  });

  it('rejects manual bearer IDs and all-catalogue licences as purchase credits', () => {
    expect(purchasedChapterIdsFromLicenses(user, ['chapter-1'], [license({}, 'ink_manual_abcdefgh'), license({}, 'ink_grant_abcdefgh'), license({ articleId: 'all' })], now)).toEqual([]);
  });

  it('performs fresh bounded exact-user queries every time, never a global scan or cached unlock', async () => {
    mock.rows = [license(), license({ userId: 'another-reader', articleId: 'chapter-2' }, 'ink_mpesa_another123')];
    await expect(getPurchasedChapterIdsForUser(user, ['chapter-1', 'chapter-2'], now)).resolves.toEqual(['chapter-1']);
    expect(mock.queries).toEqual([
      { field: 'userId', expected: user.id, limit: 1001 }, { field: 'email', expected: user.email, limit: 1001 }
    ]);
    mock.rows = [];
    await expect(getPurchasedChapterIdsForUser(user, ['chapter-1', 'chapter-2'], now)).resolves.toEqual([]);
    expect(mock.queries).toHaveLength(4);
  });

  it('fails closed rather than silently charging without credit after database failure or overflow', async () => {
    mock.failure = true;
    await expect(getPurchasedChapterIdsForUser(user, ['chapter-1', 'chapter-2'], now)).rejects.toThrow('Firestore unavailable');
    mock.failure = false;
    mock.rows = Array.from({ length: 1001 }, (_, index) => license({}, `ink_mpesa_history${index}`));
    await expect(getPurchasedChapterIdsForUser(user, ['chapter-1', 'chapter-2'], now)).rejects.toThrow('secure review');
  });

  it('rejects malformed reader/list parameters before any database query', async () => {
    await expect(getPurchasedChapterIdsForUser({ ...user, id: '../reader' }, ['chapter-1', 'chapter-2'], now)).rejects.toThrow('valid signed-in');
    await expect(getPurchasedChapterIdsForUser(user, ['chapter-1', 'chapter-1'], now)).rejects.toThrow('valid chapter list');
    expect(mock.queries).toHaveLength(0);
  });
});
