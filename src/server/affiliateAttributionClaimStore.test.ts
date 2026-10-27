import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedAffiliateAttribution } from './affiliateAttributionSecurity.js';
import {
  AffiliateAttributionClaimStore,
  consumeAffiliateAttributionClaimInTransaction,
  getAffiliateAttributionClaimDocumentId,
  verifyConsumedAffiliateAttributionClaimInTransaction,
  type AffiliateAttributionClaimBinding
} from './affiliateAttributionClaimStore.js';

type StoredDocument = Record<string, unknown>;
type FakeDocumentReference = {
  id: string;
  path: string;
};
type FakeDocumentSnapshot = {
  exists: boolean;
  data: () => StoredDocument | undefined;
};

function createFakeFirestore() {
  const documents = new Map<string, StoredDocument>();
  let transactionTail: Promise<void> = Promise.resolve();
  const clone = <T>(value: T): T => structuredClone(value);
  const snapshot = (ref: FakeDocumentReference): FakeDocumentSnapshot => {
    const value = documents.get(ref.path);
    return {
      exists: value !== undefined,
      data: () => value === undefined ? undefined : clone(value)
    };
  };

  const db = {
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((id: string): FakeDocumentReference => ({
        id,
        path: `${collectionName}/${id}`
      }))
    })),
    runTransaction: vi.fn(<T>(callback: (transaction: {
      get: (ref: FakeDocumentReference) => Promise<FakeDocumentSnapshot>;
      create: (ref: FakeDocumentReference, data: StoredDocument) => void;
      update: (ref: FakeDocumentReference, data: StoredDocument) => void;
      delete: (ref: FakeDocumentReference) => void;
    }) => Promise<T>): Promise<T> => {
      const run = transactionTail.then(async () => {
        const operations: Array<() => void> = [];
        const transaction = {
          get: vi.fn(async (ref: FakeDocumentReference) => snapshot(ref)),
          create: vi.fn((ref: FakeDocumentReference, data: StoredDocument) => {
            operations.push(() => {
              if (documents.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
              documents.set(ref.path, clone(data));
            });
          }),
          update: vi.fn((ref: FakeDocumentReference, data: StoredDocument) => {
            operations.push(() => {
              const current = documents.get(ref.path);
              if (!current) throw new Error(`Document does not exist: ${ref.path}`);
              documents.set(ref.path, { ...clone(current), ...clone(data) });
            });
          }),
          delete: vi.fn((ref: FakeDocumentReference) => {
            operations.push(() => documents.delete(ref.path));
          })
        };
        const result = await callback(transaction);
        operations.forEach(operation => operation());
        return result;
      });
      transactionTail = run.then(() => undefined, () => undefined);
      return run;
    })
  };

  return { db, documents };
}

const ATTRIBUTION_ID = 'single_use_attribution_123456';
const NOW = Date.parse('2026-10-09T08:00:00.000Z');
const ATTRIBUTION: VerifiedAffiliateAttribution = {
  attributionId: ATTRIBUTION_ID,
  ref: 'affiliate-one',
  campaign: 'launch',
  articleId: 'piece-one',
  issuedAt: NOW,
  expiresAt: NOW + 60 * 60 * 1000
};
const OPTIONS = {
  checkoutArticleId: 'piece-two',
  channel: 'mpesa'
};
const CLAIM_DOCUMENT_ID = getAffiliateAttributionClaimDocumentId(ATTRIBUTION_ID);
const CLAIM_PATH = `affiliate_attribution_claims/${CLAIM_DOCUMENT_ID}`;
const BINDING: AffiliateAttributionClaimBinding = {
  checkoutRequestId: 'ws_checkout_123',
  checkoutArticleId: OPTIONS.checkoutArticleId,
  affiliateCode: ATTRIBUTION.ref,
  campaignCode: ATTRIBUTION.campaign,
  channel: 'mpesa',
  issuedAt: ATTRIBUTION.issuedAt,
  expiresAt: ATTRIBUTION.expiresAt
};

describe('AffiliateAttributionClaimStore', () => {
  let fake: ReturnType<typeof createFakeFirestore>;
  let store: AffiliateAttributionClaimStore;

  beforeEach(() => {
    fake = createFakeFirestore();
    store = new AffiliateAttributionClaimStore(() => fake.db as never);
  });

  async function consume(
    binding: AffiliateAttributionClaimBinding = BINDING,
    claimDocumentId = CLAIM_DOCUMENT_ID
  ): Promise<boolean> {
    return fake.db.runTransaction(transaction =>
      consumeAffiliateAttributionClaimInTransaction(
        transaction as never,
        fake.db as never,
        claimDocumentId,
        binding
      )
    ) as Promise<boolean>;
  }

  async function verify(
    binding: AffiliateAttributionClaimBinding = BINDING,
    claimDocumentId = CLAIM_DOCUMENT_ID
  ): Promise<boolean> {
    return fake.db.runTransaction(transaction =>
      verifyConsumedAffiliateAttributionClaimInTransaction(
        transaction as never,
        fake.db as never,
        claimDocumentId,
        binding
      )
    ) as Promise<boolean>;
  }

  it('exports a stable hashed document ID without exposing the attribution nonce', () => {
    const expectedHash = crypto.createHash('sha256').update(ATTRIBUTION_ID, 'utf8').digest('hex');

    expect(CLAIM_DOCUMENT_ID).toBe(expectedHash);
    expect(CLAIM_DOCUMENT_ID).toMatch(/^[a-f0-9]{64}$/);
    expect(CLAIM_DOCUMENT_ID).not.toContain(ATTRIBUTION_ID);
    expect(() => getAffiliateAttributionClaimDocumentId('../unsafe')).toThrow(TypeError);
  });

  it('persists the signed click source and requires it unchanged when consuming and verifying', async () => {
    const source = { sourceClickEventId: `aclk2_${'a'.repeat(64)}`,
      sourceClickKeySha256: `ack1_${'A'.repeat(43)}`, sourceClickAt: new Date(NOW - 1_000).toISOString() };
    await store.claim({ ...ATTRIBUTION, ...source }, OPTIONS);
    expect(fake.documents.get(CLAIM_PATH)).toMatchObject(source);
    await expect(consume()).resolves.toBe(false);
    await expect(consume({ ...BINDING, ...source })).resolves.toBe(true);
    await expect(verify({ ...BINDING, ...source })).resolves.toBe(true);
    await expect(verify({ ...BINDING, ...source, sourceClickEventId: `aclk2_${'b'.repeat(64)}` })).resolves.toBe(false);
    await expect(verify()).resolves.toBe(false);
  });

  it('allows exactly one atomic claim when the same attribution is replayed concurrently', async () => {
    const results = await Promise.all([
      store.claim(ATTRIBUTION, OPTIONS),
      store.claim(ATTRIBUTION, OPTIONS)
    ]);

    expect(results.sort()).toEqual(['claimed', 'in_progress']);
    expect(fake.documents.size).toBe(1);
    const [[path, record]] = Array.from(fake.documents.entries());
    expect(path).toBe(CLAIM_PATH);
    expect(record).toMatchObject({
      version: 1,
      status: 'claimed',
      affiliateCode: 'affiliate-one',
      campaignCode: 'launch',
      originArticleId: 'piece-one',
      checkoutArticleId: 'piece-two',
      channel: 'mpesa',
      issuedAt: ATTRIBUTION.issuedAt,
      expiresAt: ATTRIBUTION.expiresAt
    });
    expect(JSON.stringify(record)).not.toContain(ATTRIBUTION_ID);
  });

  it('marks a finalized attribution consumed and rejects all later claims', async () => {
    await expect(store.claim(ATTRIBUTION, OPTIONS)).resolves.toBe('claimed');
    await store.finalize(ATTRIBUTION_ID, 'ws_checkout_123');
    await expect(store.finalize(ATTRIBUTION_ID, 'ws_checkout_123')).resolves.toBeUndefined();
    await expect(store.finalize(ATTRIBUTION_ID, 'ws_checkout_other'))
      .rejects.toThrow('already consumed by another checkout');

    await expect(store.claim(ATTRIBUTION, OPTIONS)).resolves.toBe('consumed');
    await store.release(ATTRIBUTION_ID);
    expect(Array.from(fake.documents.values())[0]).toMatchObject({
      status: 'consumed',
      checkoutRequestId: 'ws_checkout_123'
    });
  });

  it('releases only an unfinished claim so a failed checkout can retry', async () => {
    await expect(store.claim(ATTRIBUTION, OPTIONS)).resolves.toBe('claimed');
    await store.release(ATTRIBUTION_ID);

    expect(fake.documents.size).toBe(0);
    await expect(store.claim(ATTRIBUTION, OPTIONS)).resolves.toBe('claimed');
  });

  it('atomically consumes a claimed record and binds its checkout ID', async () => {
    await store.claim(ATTRIBUTION, OPTIONS);

    await expect(consume()).resolves.toBe(true);
    expect(fake.documents.get(CLAIM_PATH)).toMatchObject({
      version: 1,
      status: 'consumed',
      checkoutRequestId: BINDING.checkoutRequestId,
      affiliateCode: BINDING.affiliateCode,
      campaignCode: BINDING.campaignCode,
      checkoutArticleId: BINDING.checkoutArticleId,
      channel: BINDING.channel,
      issuedAt: BINDING.issuedAt,
      expiresAt: BINDING.expiresAt,
      consumedAt: expect.any(Number)
    });
  });

  it('makes an identical consume idempotent but rejects a different checkout ID', async () => {
    await store.claim(ATTRIBUTION, OPTIONS);
    await expect(consume()).resolves.toBe(true);
    const consumed = structuredClone(fake.documents.get(CLAIM_PATH));

    await expect(consume()).resolves.toBe(true);
    await expect(consume({ ...BINDING, checkoutRequestId: 'ws_checkout_other' })).resolves.toBe(false);
    expect(fake.documents.get(CLAIM_PATH)).toEqual(consumed);
  });

  it.each([
    ['article', { checkoutArticleId: 'piece-other' }],
    ['affiliate', { affiliateCode: 'affiliate-two' }],
    ['campaign', { campaignCode: 'other-launch' }],
    ['missing campaign', { campaignCode: undefined }],
    ['channel', { channel: 'bank' as const }],
    ['issued timestamp', { issuedAt: BINDING.issuedAt + 1 }],
    ['expiry timestamp', { expiresAt: BINDING.expiresAt + 1 }]
  ])('refuses to consume when the %s metadata does not match', async (_label, override) => {
    await store.claim(ATTRIBUTION, OPTIONS);

    await expect(consume({ ...BINDING, ...override })).resolves.toBe(false);
    expect(fake.documents.get(CLAIM_PATH)).toMatchObject({ status: 'claimed' });
    expect(fake.documents.get(CLAIM_PATH)).not.toHaveProperty('checkoutRequestId');
  });

  it('supports an exactly matching claim with no campaign metadata', async () => {
    const attribution = { ...ATTRIBUTION, campaign: undefined };
    const binding = { ...BINDING, campaignCode: undefined };
    await store.claim(attribution, OPTIONS);

    await expect(consume(binding)).resolves.toBe(true);
    expect(fake.documents.get(CLAIM_PATH)).not.toHaveProperty('campaignCode');
  });

  it('returns false instead of writing for missing, malformed, or wrong-status records', async () => {
    await expect(consume()).resolves.toBe(false);

    fake.documents.set(CLAIM_PATH, { status: 'claimed' });
    await expect(consume()).resolves.toBe(false);
    expect(fake.documents.get(CLAIM_PATH)).toEqual({ status: 'claimed' });

    fake.documents.set(CLAIM_PATH, {
      ...fake.documents.get(CLAIM_PATH),
      version: 1,
      status: 'invalid',
      affiliateCode: BINDING.affiliateCode,
      campaignCode: BINDING.campaignCode,
      checkoutArticleId: BINDING.checkoutArticleId,
      channel: BINDING.channel,
      issuedAt: BINDING.issuedAt,
      expiresAt: BINDING.expiresAt
    });
    await expect(consume()).resolves.toBe(false);
  });

  it('verifies only the exact consumed checkout binding and does not mutate it', async () => {
    await store.claim(ATTRIBUTION, OPTIONS);
    await consume();
    const beforeVerification = structuredClone(fake.documents.get(CLAIM_PATH));

    await expect(verify()).resolves.toBe(true);
    expect(fake.documents.get(CLAIM_PATH)).toEqual(beforeVerification);
  });

  it.each([
    ['checkout', { checkoutRequestId: 'ws_checkout_other' }],
    ['article', { checkoutArticleId: 'piece-other' }],
    ['affiliate', { affiliateCode: 'affiliate-two' }],
    ['campaign', { campaignCode: 'other-launch' }],
    ['missing campaign', { campaignCode: undefined }],
    ['channel', { channel: 'bank' as const }],
    ['issued timestamp', { issuedAt: BINDING.issuedAt + 1 }],
    ['expiry timestamp', { expiresAt: BINDING.expiresAt + 1 }]
  ])('rejects a consumed claim whose %s binding differs', async (_label, override) => {
    await store.claim(ATTRIBUTION, OPTIONS);
    await consume();

    await expect(verify({ ...BINDING, ...override })).resolves.toBe(false);
  });

  it('does not verify a missing or merely claimed attribution', async () => {
    await expect(verify()).resolves.toBe(false);
    await store.claim(ATTRIBUTION, OPTIONS);
    await expect(verify()).resolves.toBe(false);
  });

  it('rejects invalid helper input before reading Firestore', async () => {
    await store.claim(ATTRIBUTION, OPTIONS);
    const transactionCount = fake.db.runTransaction.mock.calls.length;

    await expect(consume(BINDING, 'not-a-hash')).rejects.toThrow(TypeError);
    await expect(consume({ ...BINDING, channel: 'card' as never })).rejects.toThrow(TypeError);
    expect(fake.db.runTransaction).toHaveBeenCalledTimes(transactionCount + 2);
    expect(fake.documents.get(CLAIM_PATH)).toMatchObject({ status: 'claimed' });
  });

});
