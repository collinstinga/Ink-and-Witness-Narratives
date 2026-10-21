import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  activation: undefined as Record<string, unknown> | undefined,
  activationCreateTime: '2026-10-20T08:00:01.000Z',
  activationUpdateTime: '2026-10-20T08:00:01.000Z',
  activationReadError: false,
  getDbError: false,
  eventQueryError: false,
  eventDocuments: [] as Array<{ id: string; value: unknown }>,
  operations: [] as Array<{ kind: string; args?: unknown[] }>,
  getDb: vi.fn(),
}));

vi.mock('./db.js', () => ({ getDb: firestore.getDb }));

import {
  DURABLE_CLICK_INGESTION_SAFETY_LAG_MS,
  MAX_DURABLE_AFFILIATE_CLICK_EVENTS,
  readDurableAffiliateClickWindow,
} from './affiliateClickAnalyticsStore.js';
import { deriveAffiliateClickAnalyticsKeyFingerprint } from './affiliateClickLedger.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const TEST_SECRET = 'durable-click-query-test-secret-with-more-than-32-characters';
const KEY_FINGERPRINT = deriveAffiliateClickAnalyticsKeyFingerprint(TEST_SECRET)!;
const VISITOR_KEY = `acv1_${'A'.repeat(43)}`;
const activation = {
  schemaVersion: 1,
  eventSchemaVersion: 2,
  activatedAt: '2026-10-20T08:00:00.000Z',
  completeFrom: '2026-10-20T08:05:00.000Z',
  keyVersion: 'v1',
  keyFingerprint: KEY_FINGERPRINT,
};

function event(index = 1, overrides: Record<string, unknown> = {}) {
  const id = `aclk2_${index.toString(16).padStart(64, '0')}`;
  return {
    id,
    value: {
      schemaVersion: 2,
      id,
      keyFingerprint: KEY_FINGERPRINT,
      affiliateCode: 'PARTNER_7',
      affiliateId: 'affiliate_7',
      articleId: 'piece_42',
      visitorKey: VISITOR_KEY,
      timestamp: '2026-10-20T10:10:00.000Z',
      dedupeWindowStartedAt: '2026-10-20T10:00:00.000Z',
      ...overrides,
    },
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    rangeStartsAt: '2026-10-20T09:00:00.000Z',
    rangeEndsAt: '2026-10-20T11:00:00.000Z',
    now: NOW,
    runtimeMode: 'required' as const,
    keyFingerprint: KEY_FINGERPRINT,
    ...overrides,
  };
}

beforeEach(() => {
  firestore.activation = activation;
  firestore.activationCreateTime = '2026-10-20T08:00:01.000Z';
  firestore.activationUpdateTime = '2026-10-20T08:00:01.000Z';
  firestore.activationReadError = false;
  firestore.getDbError = false;
  firestore.eventQueryError = false;
  firestore.eventDocuments = [];
  firestore.operations = [];

  const eventQuery: any = {
    where: vi.fn((...args: unknown[]) => {
      firestore.operations.push({ kind: 'where', args });
      return eventQuery;
    }),
    orderBy: vi.fn((...args: unknown[]) => {
      firestore.operations.push({ kind: 'orderBy', args });
      return eventQuery;
    }),
    limit: vi.fn((...args: unknown[]) => {
      firestore.operations.push({ kind: 'limit', args });
      return eventQuery;
    }),
    get: vi.fn(async () => {
      firestore.operations.push({ kind: 'event_get' });
      if (firestore.eventQueryError) throw new Error('simulated event query failure');
      return {
        docs: firestore.eventDocuments.map(document => ({
          id: document.id,
          data: () => document.value,
        })),
      };
    }),
  };
  firestore.getDb.mockReset();
  firestore.getDb.mockImplementation(() => {
    if (firestore.getDbError) throw new Error('simulated Firebase initialization failure');
    return {
    collection: vi.fn((name: string) => {
      firestore.operations.push({ kind: 'collection', args: [name] });
      if (name === 'site_configs') {
        return {
          doc: vi.fn((id: string) => ({
            get: vi.fn(async () => {
              firestore.operations.push({ kind: 'marker_get', args: [id] });
              if (firestore.activationReadError) throw new Error('simulated marker read failure');
              return {
                exists: firestore.activation !== undefined,
                data: () => firestore.activation,
                createTime: firestore.activationCreateTime,
                updateTime: firestore.activationUpdateTime,
              };
            }),
          })),
        };
      }
      if (name === 'affiliate_clicks') return eventQuery;
      throw new Error(`Unexpected collection ${name}`);
    }),
    };
  });
});

describe('bounded durable affiliate click query', () => {
  it('performs zero Firestore reads for unsupported click filters', async () => {
    const result = await readDurableAffiliateClickWindow(baseInput({
      filters: { purchaseKind: 'subscription' },
    }));

    expect(result).toEqual({ source: 'unsupported_filter', events: [] });
    expect(firestore.getDb).not.toHaveBeenCalled();
  });

  it('uses the legacy partial fallback only when the activation marker is absent', async () => {
    firestore.activation = undefined;
    const result = await readDurableAffiliateClickWindow(baseInput());

    expect(result.source).toBe('legacy');
    expect(firestore.operations.filter(operation => operation.kind === 'marker_get')).toHaveLength(1);
    expect(firestore.operations.some(operation => operation.kind === 'event_get')).toBe(false);
  });

  it('fails coverage closed for marker read errors and malformed markers', async () => {
    firestore.activationReadError = true;
    await expect(readDurableAffiliateClickWindow(baseInput())).resolves.toMatchObject({
      source: 'unavailable',
      coverage: { reasons: ['query_failed'] },
    });

    firestore.activationReadError = false;
    firestore.activation = { ...activation, mutable: true };
    await expect(readDurableAffiliateClickWindow(baseInput())).resolves.toMatchObject({
      source: 'unavailable',
      coverage: { reasons: ['invalid_activation_marker'] },
    });
    expect(firestore.operations.some(operation => operation.kind === 'event_get')).toBe(false);
  });

  it('keeps financial reporting available when Firebase initialization fails', async () => {
    firestore.getDbError = true;
    await expect(readDurableAffiliateClickWindow(baseInput())).resolves.toMatchObject({
      source: 'unavailable',
      events: [],
      coverage: { reasons: ['query_failed'] },
    });
  });

  it('rejects an updated or late-created activation marker', async () => {
    firestore.activationUpdateTime = '2026-10-20T08:00:02.000Z';
    await expect(readDurableAffiliateClickWindow(baseInput())).resolves.toMatchObject({
      coverage: { reasons: ['invalid_activation_marker'] },
    });

    firestore.activationUpdateTime = firestore.activationCreateTime;
    firestore.activationCreateTime = activation.completeFrom;
    firestore.activationUpdateTime = activation.completeFrom;
    await expect(readDurableAffiliateClickWindow(baseInput())).resolves.toMatchObject({
      coverage: { reasons: ['invalid_activation_marker'] },
    });
    expect(firestore.operations.some(operation => operation.kind === 'event_get')).toBe(false);
  });

  it('does not query events before a future completeFrom instant', async () => {
    firestore.activation = {
      ...activation,
      completeFrom: '2026-10-20T12:05:00.000Z',
    };

    const result = await readDurableAffiliateClickWindow(baseInput());
    expect(result).toMatchObject({
      source: 'unavailable',
      coverage: { reasons: ['predates_durable_history'] },
      queriedThrough: '2026-10-20T11:00:00.000Z',
    });
    expect(firestore.operations.some(operation => operation.kind === 'event_get')).toBe(false);
  });

  it('requires required mode and the exact dedicated key after activation', async () => {
    await expect(readDurableAffiliateClickWindow(baseInput({ runtimeMode: 'shadow' }))).resolves.toMatchObject({
      coverage: { reasons: ['runtime_not_required'] },
    });
    await expect(readDurableAffiliateClickWindow(baseInput({ keyFingerprint: undefined }))).resolves.toMatchObject({
      coverage: { reasons: ['missing_secret'] },
    });
    await expect(readDurableAffiliateClickWindow(baseInput({
      keyFingerprint: `ack1_${'Z'.repeat(43)}`,
    }))).resolves.toMatchObject({ coverage: { reasons: ['key_mismatch'] } });
    expect(firestore.operations.some(operation => operation.kind === 'event_get')).toBe(false);
  });

  it('uses timestamp-only bounds, ascending order and one truncation sentinel', async () => {
    const result = await readDurableAffiliateClickWindow(baseInput());

    expect(result).toMatchObject({
      source: 'durable',
      events: [],
      queriedThrough: '2026-10-20T11:00:00.000Z',
      coverage: { eventCoverage: 'complete', reasons: ['complete'] },
    });
    expect(firestore.operations.filter(operation => operation.kind === 'where')).toEqual([
      { kind: 'where', args: ['timestamp', '>=', '2026-10-20T09:00:00.000Z'] },
      { kind: 'where', args: ['timestamp', '<=', '2026-10-20T11:00:00.000Z'] },
    ]);
    expect(firestore.operations).toContainEqual({ kind: 'orderBy', args: ['timestamp', 'asc'] });
    expect(firestore.operations).toContainEqual({
      kind: 'limit',
      args: [MAX_DURABLE_AFFILIATE_CLICK_EVENTS + 1],
    });
  });

  it('keeps a live interval partial until the ingestion safety lag closes', async () => {
    const result = await readDurableAffiliateClickWindow(baseInput({
      rangeEndsAt: NOW.toISOString(),
    }));
    const expectedThrough = new Date(
      NOW.getTime() - DURABLE_CLICK_INGESTION_SAFETY_LAG_MS,
    ).toISOString();

    expect(result).toMatchObject({
      source: 'durable',
      queriedThrough: expectedThrough,
      coverage: { eventCoverage: 'partial', reasons: ['settling_window'] },
    });
    expect(firestore.operations).toContainEqual({
      kind: 'where',
      args: ['timestamp', '<=', expectedThrough],
    });
  });

  it('clamps an overlapping range to completeFrom and reports partial coverage', async () => {
    firestore.eventDocuments = [event()];
    const result = await readDurableAffiliateClickWindow(baseInput({
      rangeStartsAt: '2026-10-20T00:00:00.000Z',
    }));

    expect(result).toMatchObject({
      source: 'durable',
      coverage: {
        eventCoverage: 'partial',
        reasons: ['predates_durable_history'],
      },
    });
    expect(firestore.operations).toContainEqual({
      kind: 'where',
      args: ['timestamp', '>=', activation.completeFrom],
    });
  });

  it('treats the exact hard limit as complete and the sentinel record as truncated', async () => {
    firestore.eventDocuments = Array.from(
      { length: MAX_DURABLE_AFFILIATE_CLICK_EVENTS },
      (_, index) => event(index + 1),
    );
    const complete = await readDurableAffiliateClickWindow(baseInput());
    expect(complete.events).toHaveLength(MAX_DURABLE_AFFILIATE_CLICK_EVENTS);
    expect(complete.coverage).toMatchObject({ eventCoverage: 'complete', reasons: ['complete'] });

    firestore.eventDocuments.push(event(MAX_DURABLE_AFFILIATE_CLICK_EVENTS + 1));
    const truncated = await readDurableAffiliateClickWindow(baseInput());
    expect(truncated.events).toHaveLength(MAX_DURABLE_AFFILIATE_CLICK_EVENTS);
    expect(truncated.coverage).toMatchObject({ eventCoverage: 'partial', reasons: ['truncated'] });
  });

  it('coalesces identical concurrent queries without caching completed results', async () => {
    const [first, second] = await Promise.all([
      readDurableAffiliateClickWindow(baseInput()),
      readDurableAffiliateClickWindow(baseInput()),
    ]);
    expect(first).toEqual(second);
    expect(firestore.operations.filter(operation => operation.kind === 'marker_get')).toHaveLength(1);
    expect(firestore.operations.filter(operation => operation.kind === 'event_get')).toHaveLength(1);

    await readDurableAffiliateClickWindow(baseInput());
    expect(firestore.operations.filter(operation => operation.kind === 'marker_get')).toHaveLength(2);
    expect(firestore.operations.filter(operation => operation.kind === 'event_get')).toHaveLength(2);
  });

  it('rejects document/body ID mismatches and unknown private fields without leaking them', async () => {
    const valid = event(1);
    const mismatched = event(2);
    mismatched.id = `aclk2_${'f'.repeat(64)}`;
    const privateField = event(3, { ipHash: 'must-not-leak' });
    firestore.eventDocuments = [valid, mismatched, privateField];

    const result = await readDurableAffiliateClickWindow(baseInput());
    expect(result.events).toEqual([valid.value]);
    expect(result.coverage).toMatchObject({
      eventCoverage: 'partial',
      invalidEventCount: 2,
      reasons: ['invalid_events'],
    });
    expect(JSON.stringify(result.events)).not.toContain('must-not-leak');
  });

  it('rejects events written with a different click key', async () => {
    firestore.eventDocuments = [event(1, { keyFingerprint: `ack1_${'Z'.repeat(43)}` })];
    const result = await readDurableAffiliateClickWindow(baseInput());
    expect(result.events).toEqual([]);
    expect(result.coverage).toMatchObject({
      eventCoverage: 'partial',
      invalidEventCount: 1,
      reasons: ['invalid_events'],
    });
  });

  it('returns unavailable traffic instead of partial zeros when the event query fails', async () => {
    firestore.eventQueryError = true;
    const result = await readDurableAffiliateClickWindow(baseInput());

    expect(result).toMatchObject({
      source: 'unavailable',
      events: [],
      coverage: { eventCoverage: 'unavailable', reasons: ['query_failed'] },
    });
  });
});
