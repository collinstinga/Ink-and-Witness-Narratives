import crypto from 'crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  committedWrites: [] as Array<{ collection: string; id: string; value: Record<string, unknown> }>,
  reads: [] as Array<{ kind: string; collection: string; id?: string }>,
  failNextCommit: false,
  getDb: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('./db.js', () => ({
  getDb: firestore.getDb,
  setFirestoreDoc: vi.fn(),
  replaceFirestoreDoc: vi.fn(),
  updateFirestoreDoc: vi.fn(),
  getFirestoreDoc: vi.fn(async () => null),
  getAllFirestoreDocs: vi.fn(async () => []),
  deleteFirestoreDoc: vi.fn(),
}));

import { affiliateStore, AffiliateClickLedgerUnavailableError } from './affiliateStore.js';

const TEST_SECRET = 'dedicated-affiliate-click-ledger-test-secret-with-32-plus-characters';
const VISITOR_KEY = `acv1_${'A'.repeat(43)}`;
const NOW = Date.parse('2026-10-20T08:00:00.000Z');
const originalEnvironment = {
  VERCEL: process.env.VERCEL,
  AFFILIATE_CLICK_ANALYTICS_SECRET: process.env.AFFILIATE_CLICK_ANALYTICS_SECRET,
};

type Reference = {
  kind: 'doc' | 'query';
  collection: string;
  id?: string;
  field?: string;
  value?: string;
  limitCount?: number;
};

const affiliate = {
  id: 'affiliate_7',
  affiliateCode: 'PARTNER_7',
  name: 'Partner Seven',
  email: 'partner7@example.test',
  phone: '254700000001',
  status: 'active',
  payoutMethod: 'mpesa',
  payoutDetails: {},
  totalClicks: 0,
  uniqueVisitors: 0,
  totalSalesCount: 0,
  totalRevenueKes: 0,
  totalCommissionEarnedKes: 0,
  totalCommissionPaidKes: 0,
  balanceAvailableKes: 0,
  balancePendingKes: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function documentReference(collection: string, id: string): Reference {
  return { kind: 'doc', collection, id };
}

function collectionReference(collection: string) {
  return {
    doc: (id: string) => documentReference(collection, id),
    where: (field: string, _operator: string, value: string) => ({
      limit: (limitCount: number): Reference => ({
        kind: 'query',
        collection,
        field,
        value,
        limitCount,
      }),
    }),
  };
}

function querySnapshot(reference: Reference) {
  if (reference.collection === 'affiliates' && reference.value === 'PARTNER_7') {
    const ref = documentReference('affiliates', affiliate.id);
    return {
      docs: [{
        exists: true,
        id: affiliate.id,
        ref,
        data: () => clone(affiliate),
      }],
    };
  }
  return { docs: [] };
}

function documentSnapshot(reference: Reference) {
  const key = `${reference.collection}/${reference.id}`;
  const value = firestore.documents.get(key);
  return {
    exists: value !== undefined,
    id: reference.id,
    ref: reference,
    data: () => clone(value),
  };
}

let transactionQueue = Promise.resolve();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.VERCEL = '1';
  process.env.AFFILIATE_CLICK_ANALYTICS_SECRET = TEST_SECRET;
  firestore.documents.clear();
  firestore.documents.set('site_configs/affiliate_settings', {
    defaultCommissionRate: 15,
    minPayoutThresholdKes: 1000,
    defaultAttributionDays: 30,
    allowSelfRegistration: true,
    pieceCommissionOverrides: {},
  });
  firestore.committedWrites.length = 0;
  firestore.reads.length = 0;
  firestore.failNextCommit = false;
  affiliate.status = 'active';
  delete (affiliate as typeof affiliate & { linksDisabled?: boolean }).linksDisabled;
  affiliate.totalClicks = 0;
  affiliate.uniqueVisitors = 0;
  transactionQueue = Promise.resolve();
  firestore.runTransaction.mockReset();
  firestore.runTransaction.mockImplementation((operation: (transaction: any) => Promise<unknown>) => {
    const execute = transactionQueue.then(async () => {
      const pendingWrites: Array<{ reference: Reference; value: Record<string, unknown> }> = [];
      const transaction = {
        get: async (reference: Reference) => {
          firestore.reads.push({
            kind: reference.kind,
            collection: reference.collection,
            id: reference.id,
          });
          return reference.kind === 'query'
            ? querySnapshot(reference)
            : documentSnapshot(reference);
        },
        set: (
          reference: Reference,
          value: Record<string, unknown>,
          _options?: Record<string, unknown>,
        ) => pendingWrites.push({ reference, value: clone(value) }),
      };
      const result = await operation(transaction);
      if (firestore.failNextCommit) {
        firestore.failNextCommit = false;
        throw new Error('simulated click transaction commit failure');
      }
      for (const write of pendingWrites) {
        const collection = write.reference.collection;
        const id = write.reference.id!;
        firestore.committedWrites.push({ collection, id, value: clone(write.value) });
        if (collection === 'affiliate_clicks') {
          firestore.documents.set(`${collection}/${id}`, clone(write.value));
        }
      }
      return result;
    });
    transactionQueue = execute.then(() => undefined, () => undefined);
    return execute;
  });
  firestore.getDb.mockReturnValue({
    collection: collectionReference,
    runTransaction: firestore.runTransaction,
  });
});

afterAll(() => {
  vi.useRealTimers();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('affiliate durable click transaction', () => {
  it('commits one private event and one counter update for concurrent identical clicks', async () => {
    const request = () => affiliateStore.registerClick(
      'partner_7',
      'piece_42',
      undefined,
      'legacy-ip-fingerprint',
      'raw-browser-agent',
      'https://share.example.test/private/path?phone=254700000001',
      { durableMode: 'required', visitorKey: VISITOR_KEY },
    );

    const results = await Promise.all([request(), request()]);
    const events = [...firestore.documents.entries()]
      .filter(([key]) => key.startsWith('affiliate_clicks/'));
    const affiliateWrites = firestore.committedWrites.filter(write => write.collection === 'affiliates');

    expect(events).toHaveLength(1);
    expect(affiliateWrites).toHaveLength(1);
    expect(results.map(result => result.clickRecorded).sort()).toEqual([false, true]);
    expect(results.map(result => result.deduplicated).sort()).toEqual([false, true]);
    expect(results.every(result => result.valid && result.durable)).toBe(true);

    const [eventId, event] = events[0];
    expect(eventId).toMatch(/^affiliate_clicks\/aclk2_[a-f0-9]{64}$/);
    expect(event).toMatchObject({
      schemaVersion: 2,
      affiliateCode: 'PARTNER_7',
      affiliateId: 'affiliate_7',
      articleId: 'piece_42',
      visitorKey: VISITOR_KEY,
      referrerOrigin: 'https://share.example.test',
    });
    expect(JSON.stringify(event)).not.toMatch(/254700000001|private\/path|raw-browser-agent|legacy-ip-fingerprint|ipHash|userAgent|referrer"/i);
    expect(affiliateWrites[0].value).not.toHaveProperty('uniqueVisitors');
  });

  it('creates a different event in the next 30-minute window', async () => {
    const register = () => affiliateStore.registerClick(
      'PARTNER_7',
      'piece_42',
      undefined,
      undefined,
      undefined,
      undefined,
      { durableMode: 'required', visitorKey: VISITOR_KEY },
    );
    await register();
    vi.setSystemTime(NOW + 30 * 60 * 1000);
    await register();

    expect([...firestore.documents.keys()].filter(key => key.startsWith('affiliate_clicks/'))).toHaveLength(2);
    expect(firestore.committedWrites.filter(write => write.collection === 'affiliates')).toHaveLength(2);
  });

  it('publishes neither the event nor counters when the transaction commit fails', async () => {
    firestore.failNextCommit = true;
    await expect(affiliateStore.registerClick(
      'PARTNER_7',
      'piece_42',
      undefined,
      undefined,
      undefined,
      undefined,
      { durableMode: 'required', visitorKey: VISITOR_KEY },
    )).rejects.toThrow(/simulated click transaction commit failure/i);

    expect([...firestore.documents.keys()].filter(key => key.startsWith('affiliate_clicks/'))).toHaveLength(0);
    expect(firestore.committedWrites).toHaveLength(0);
  });

  it('fails before any Firestore operation when required mode lacks its dedicated secret', async () => {
    delete process.env.AFFILIATE_CLICK_ANALYTICS_SECRET;

    await expect(affiliateStore.registerClick(
      'PARTNER_7',
      'piece_42',
      undefined,
      undefined,
      undefined,
      undefined,
      { durableMode: 'required', visitorKey: VISITOR_KEY },
    )).rejects.toBeInstanceOf(AffiliateClickLedgerUnavailableError);
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(firestore.committedWrites).toHaveLength(0);
  });

  it('keeps shadow mode backward-compatible before activation when the key is unavailable', async () => {
    delete process.env.AFFILIATE_CLICK_ANALYTICS_SECRET;
    const result = await affiliateStore.registerClick(
      'PARTNER_7',
      'piece_42',
      undefined,
      'legacy-fingerprint-shadow-only',
      'legacy-agent',
      'https://share.example.test/path',
      { durableMode: 'shadow' },
    );

    expect(result).toMatchObject({
      valid: true,
      clickRecorded: true,
      deduplicated: false,
      durable: false,
    });
    expect([...firestore.documents.keys()].filter(key => key.startsWith('affiliate_clicks/'))).toHaveLength(0);
    expect(firestore.committedWrites.filter(write => write.collection === 'affiliates')).toHaveLength(1);
  });

  it('preserves pre-existing legacy click documents byte-for-byte', async () => {
    const legacyDocument = {
      id: 'clk_legacy_unchanged',
      affiliateCode: 'PARTNER_7',
      affiliateId: 'affiliate_7',
      articleId: 'piece_legacy',
      ipHash: 'legacy-only-fingerprint',
      userAgent: 'legacy-only-agent',
      referrer: 'https://legacy.example.test/private/path',
      timestamp: '2026-01-01T00:00:00.000Z',
      unknownLegacyField: { preserve: true },
    };
    firestore.documents.set('affiliate_clicks/clk_legacy_unchanged', clone(legacyDocument));

    await affiliateStore.registerClick(
      'PARTNER_7',
      'piece_42',
      undefined,
      undefined,
      undefined,
      undefined,
      { durableMode: 'required', visitorKey: VISITOR_KEY },
    );

    expect(firestore.documents.get('affiliate_clicks/clk_legacy_unchanged')).toEqual(legacyDocument);
    expect(firestore.committedWrites.some(write => write.id === 'clk_legacy_unchanged')).toBe(false);
  });

  it('does not read or write a click event for an inactive affiliate', async () => {
    affiliate.status = 'suspended';

    const result = await affiliateStore.registerClick(
      'PARTNER_7',
      'piece_42',
      undefined,
      undefined,
      undefined,
      undefined,
      { durableMode: 'required', visitorKey: VISITOR_KEY },
    );

    expect(result).toEqual({ valid: false });
    expect(firestore.reads.filter(read => read.collection === 'affiliate_clicks')).toHaveLength(0);
    expect(firestore.committedWrites).toHaveLength(0);
  });

  it('creates the first v2 event even when the legacy cache calls the click a duplicate', async () => {
    const articleId = 'piece_rollout_bridge';
    const legacyFingerprint = 'legacy-rollout-fingerprint';

    const legacyResult = await affiliateStore.registerClick(
      'PARTNER_7',
      articleId,
      undefined,
      legacyFingerprint,
      'legacy-rollout-agent',
      'https://legacy.example.test/path',
    );
    expect(legacyResult).toMatchObject({ valid: true, clickRecorded: true, durable: false });
    firestore.committedWrites.length = 0;
    firestore.reads.length = 0;

    const durableResult = await affiliateStore.registerClick(
      'PARTNER_7',
      articleId,
      undefined,
      legacyFingerprint,
      'legacy-rollout-agent',
      'https://legacy.example.test/path',
      { durableMode: 'required', visitorKey: VISITOR_KEY },
    );

    expect(durableResult).toMatchObject({
      valid: true,
      clickRecorded: true,
      deduplicated: false,
      durable: true,
    });
    expect([...firestore.documents.keys()].filter(key => key.startsWith('affiliate_clicks/aclk2_'))).toHaveLength(1);
    expect(firestore.committedWrites.filter(write => write.collection === 'affiliates')).toHaveLength(1);
  });

  it('keeps rolling legacy counter and unique-visitor semantics in shadow mode across a v2 window boundary', async () => {
    const boundaryStart = Date.parse('2026-10-20T08:29:00.000Z');
    vi.setSystemTime(boundaryStart);
    const register = () => affiliateStore.registerClick(
      'PARTNER_7',
      'piece_shadow_boundary',
      undefined,
      'shadow-boundary-legacy-fingerprint',
      'shadow-boundary-agent',
      'https://share.example.test/path',
      { durableMode: 'shadow', visitorKey: VISITOR_KEY },
    );

    const first = await register();
    vi.setSystemTime(boundaryStart + 2 * 60 * 1000);
    const second = await register();

    expect(first).toMatchObject({ clickRecorded: true, deduplicated: false, durable: true });
    expect(second).toMatchObject({ clickRecorded: false, deduplicated: true, durable: true });
    expect([...firestore.documents.keys()].filter(key => key.startsWith('affiliate_clicks/aclk2_'))).toHaveLength(2);
    const affiliateWrites = firestore.committedWrites.filter(write => write.collection === 'affiliates');
    expect(affiliateWrites).toHaveLength(1);
    expect(affiliateWrites[0].value).toHaveProperty('uniqueVisitors');
  });

  it('returns committed shadow success when the best-effort local projection fails', async () => {
    const randomBytes = vi.spyOn(crypto, 'randomBytes').mockImplementationOnce(() => {
      throw new Error('simulated local projection failure');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await affiliateStore.registerClick(
      'PARTNER_7',
      'piece_shadow_projection_failure',
      undefined,
      'shadow-projection-fingerprint',
      'shadow-projection-agent',
      'https://share.example.test/path',
      { durableMode: 'shadow', visitorKey: VISITOR_KEY },
    );

    expect(result).toMatchObject({
      valid: true,
      clickRecorded: true,
      deduplicated: false,
      durable: true,
    });
    expect([...firestore.documents.keys()].filter(key => key.startsWith('affiliate_clicks/aclk2_'))).toHaveLength(1);
    expect(firestore.committedWrites.filter(write => write.collection === 'affiliates')).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith(
      '[Affiliate Click] Local event projection failed after commit:',
      expect.objectContaining({ message: 'simulated local projection failure' }),
    );

    randomBytes.mockRestore();
    warning.mockRestore();
  });
});
