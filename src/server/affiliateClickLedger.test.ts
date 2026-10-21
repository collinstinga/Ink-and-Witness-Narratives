import { afterEach, describe, expect, it } from 'vitest';

import {
  AFFILIATE_CLICK_DEDUPE_WINDOW_MS,
  AFFILIATE_CLICK_VISITOR_MAX_AGE_MS,
  assessDurableAffiliateClickCoverage,
  createAffiliateClickVisitorCookieValue,
  createDurableAffiliateClickDedupeIdentity,
  deriveAffiliateClickAnalyticsKeyFingerprint,
  normalizeAffiliateClickAnalyticsActivationV1,
  normalizeDurableAffiliateClickEventV2,
  sanitizeAffiliateClickReferrerOrigin,
  verifyAffiliateClickVisitorCookie,
} from './affiliateClickLedger.js';

const TEST_SECRET = 'affiliate-click-ledger-test-secret-with-more-than-32-characters';
const OTHER_SECRET = 'rotated-affiliate-click-ledger-secret-with-32-plus-characters';
const NOW = Date.parse('2026-10-20T08:00:00.000Z');
const NONCE = 'A'.repeat(43);

const originalEnvironment = {
  VERCEL: process.env.VERCEL,
  NODE_ENV: process.env.NODE_ENV,
  AFFILIATE_CLICK_ANALYTICS_SECRET: process.env.AFFILIATE_CLICK_ANALYTICS_SECRET,
  AFFILIATE_SESSION_SIGNING_SECRET: process.env.AFFILIATE_SESSION_SIGNING_SECRET,
  SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function visitorIdentity() {
  const token = createAffiliateClickVisitorCookieValue({
    now: NOW,
    nonce: NONCE,
    signingSecret: TEST_SECRET,
  });
  expect(token).not.toBeNull();
  const identity = verifyAffiliateClickVisitorCookie(token, {
    now: NOW,
    signingSecret: TEST_SECRET,
  });
  expect(identity).not.toBeNull();
  return identity!;
}

function durableEvent(overrides: Record<string, unknown> = {}) {
  const visitor = visitorIdentity();
  const dedupe = createDurableAffiliateClickDedupeIdentity({
    affiliateCode: 'PARTNER_7',
    articleId: 'piece_42',
    campaignCode: 'LAUNCH_2026',
    visitorKey: visitor.visitorKey,
    occurredAtMs: NOW,
    signingSecret: TEST_SECRET,
  });
  expect(dedupe).not.toBeNull();
  return {
    schemaVersion: 2,
    id: dedupe!.documentId,
    keyFingerprint: deriveAffiliateClickAnalyticsKeyFingerprint(TEST_SECRET),
    affiliateCode: 'PARTNER_7',
    affiliateId: 'affiliate_7',
    articleId: 'piece_42',
    campaignCode: 'launch_2026',
    visitorKey: visitor.visitorKey,
    referrerOrigin: 'https://example.test',
    timestamp: new Date(NOW).toISOString(),
    dedupeWindowStartedAt: dedupe!.dedupeWindowStartedAt,
    ...overrides,
  };
}

describe('anonymous affiliate click visitor token', () => {
  it('creates a signed random pseudonym without embedding request or account identifiers', () => {
    const token = createAffiliateClickVisitorCookieValue({
      now: NOW,
      nonce: NONCE,
      signingSecret: TEST_SECRET,
    });
    const identity = verifyAffiliateClickVisitorCookie(token, {
      now: NOW,
      signingSecret: TEST_SECRET,
    });

    expect(token).toMatch(/^aff_vis_v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
    expect(identity?.visitorKey).toMatch(/^acv1_[A-Za-z0-9_-]{43}$/);
    expect(identity?.visitorKey).not.toContain(NONCE);
    expect(JSON.stringify(identity)).not.toMatch(/email|phone|reader|userAgent|ipHash/i);
  });

  it('is stable for one valid token and isolated by secret rotation', () => {
    const token = createAffiliateClickVisitorCookieValue({
      now: NOW,
      nonce: NONCE,
      signingSecret: TEST_SECRET,
    });
    const first = verifyAffiliateClickVisitorCookie(token, { now: NOW, signingSecret: TEST_SECRET });
    const second = verifyAffiliateClickVisitorCookie(token, { now: NOW + 1, signingSecret: TEST_SECRET });

    expect(first?.visitorKey).toBe(second?.visitorKey);
    expect(verifyAffiliateClickVisitorCookie(token, {
      now: NOW,
      signingSecret: OTHER_SECRET,
    })).toBeNull();
  });

  it('derives a stable non-secret key commitment and detects rotation', () => {
    const fingerprint = deriveAffiliateClickAnalyticsKeyFingerprint(TEST_SECRET);
    expect(fingerprint).toMatch(/^ack1_[A-Za-z0-9_-]{43}$/);
    expect(fingerprint).toBe(deriveAffiliateClickAnalyticsKeyFingerprint(TEST_SECRET));
    expect(fingerprint).not.toBe(deriveAffiliateClickAnalyticsKeyFingerprint(OTHER_SECRET));
    expect(fingerprint).not.toContain(TEST_SECRET);
    expect(deriveAffiliateClickAnalyticsKeyFingerprint('too-short')).toBeNull();
  });

  it('rejects tampering, expiry, excessive lifetime, invalid nonce and future issuance', () => {
    const token = createAffiliateClickVisitorCookieValue({
      now: NOW,
      nonce: NONCE,
      maxAgeMs: 1000,
      signingSecret: TEST_SECRET,
    })!;
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expect(verifyAffiliateClickVisitorCookie(tampered, { now: NOW, signingSecret: TEST_SECRET })).toBeNull();
    expect(verifyAffiliateClickVisitorCookie(token, { now: NOW + 1000, signingSecret: TEST_SECRET })).not.toBeNull();
    expect(verifyAffiliateClickVisitorCookie(token, { now: NOW + 1001, signingSecret: TEST_SECRET })).toBeNull();
    expect(createAffiliateClickVisitorCookieValue({
      now: NOW,
      nonce: 'short',
      signingSecret: TEST_SECRET,
    })).toBeNull();

    const future = createAffiliateClickVisitorCookieValue({
      now: NOW + 30_001,
      nonce: NONCE,
      signingSecret: TEST_SECRET,
    });
    expect(verifyAffiliateClickVisitorCookie(future, { now: NOW, signingSecret: TEST_SECRET })).toBeNull();

    const capped = createAffiliateClickVisitorCookieValue({
      now: NOW,
      nonce: NONCE,
      maxAgeMs: AFFILIATE_CLICK_VISITOR_MAX_AGE_MS * 2,
      signingSecret: TEST_SECRET,
    });
    expect(verifyAffiliateClickVisitorCookie(capped, {
      now: NOW + AFFILIATE_CLICK_VISITOR_MAX_AGE_MS,
      signingSecret: TEST_SECRET,
    })).not.toBeNull();
  });

  it('fails closed in production when no stable server secret is configured', () => {
    process.env.VERCEL = '1';
    process.env.NODE_ENV = 'production';
    delete process.env.AFFILIATE_CLICK_ANALYTICS_SECRET;
    delete process.env.AFFILIATE_SESSION_SIGNING_SECRET;
    delete process.env.SESSION_SIGNING_SECRET;

    expect(createAffiliateClickVisitorCookieValue({ now: NOW, nonce: NONCE })).toBeNull();
    expect(verifyAffiliateClickVisitorCookie('aff_vis_v1.payload.signature', { now: NOW })).toBeNull();
  });
});

describe('durable affiliate click identity and privacy boundary', () => {
  it('makes one deterministic document per visitor, destination and 30-minute window', () => {
    const visitor = visitorIdentity();
    const first = createDurableAffiliateClickDedupeIdentity({
      affiliateCode: 'partner_7',
      articleId: 'piece_42',
      campaignCode: 'Launch_2026',
      visitorKey: visitor.visitorKey,
      occurredAtMs: NOW,
      signingSecret: TEST_SECRET,
    });
    const duplicate = createDurableAffiliateClickDedupeIdentity({
      affiliateCode: 'PARTNER_7',
      articleId: 'piece_42',
      campaignCode: 'launch_2026',
      visitorKey: visitor.visitorKey,
      occurredAtMs: NOW + AFFILIATE_CLICK_DEDUPE_WINDOW_MS - 1,
      signingSecret: TEST_SECRET,
    });
    const nextWindow = createDurableAffiliateClickDedupeIdentity({
      affiliateCode: 'PARTNER_7',
      articleId: 'piece_42',
      campaignCode: 'launch_2026',
      visitorKey: visitor.visitorKey,
      occurredAtMs: NOW + AFFILIATE_CLICK_DEDUPE_WINDOW_MS,
      signingSecret: TEST_SECRET,
    });

    expect(first?.documentId).toMatch(/^aclk2_[a-f0-9]{64}$/);
    expect(duplicate).toEqual(first);
    expect(nextWindow?.documentId).not.toBe(first?.documentId);
    expect(JSON.stringify(first)).not.toContain(visitor.visitorKey);
  });

  it('changes the identity for a different affiliate, target, campaign, visitor or secret', () => {
    const visitor = visitorIdentity();
    const base = {
      affiliateCode: 'PARTNER_7',
      articleId: 'piece_42',
      campaignCode: 'launch_2026',
      visitorKey: visitor.visitorKey,
      occurredAtMs: NOW,
      signingSecret: TEST_SECRET,
    };
    const original = createDurableAffiliateClickDedupeIdentity(base)?.documentId;
    const variants = [
      { ...base, affiliateCode: 'PARTNER_8' },
      { ...base, articleId: 'piece_43' },
      { ...base, campaignCode: 'other_campaign' },
      { ...base, visitorKey: `acv1_${'B'.repeat(43)}` },
      { ...base, signingSecret: OTHER_SECRET },
    ];
    expect(new Set(variants.map(item => createDurableAffiliateClickDedupeIdentity(item)?.documentId)).size).toBe(5);
    expect(variants.every(item => createDurableAffiliateClickDedupeIdentity(item)?.documentId !== original)).toBe(true);
  });

  it('stores referrer origin only and rejects unsafe schemes, credentials and oversized input', () => {
    expect(sanitizeAffiliateClickReferrerOrigin(
      'https://Example.COM:443/private/path?email=reader@example.test#secret',
    )).toBe('https://example.com');
    expect(sanitizeAffiliateClickReferrerOrigin('http://example.test:8080/path')).toBe('http://example.test:8080');
    expect(sanitizeAffiliateClickReferrerOrigin('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeAffiliateClickReferrerOrigin('https://user:password@example.test/path')).toBeUndefined();
    expect(sanitizeAffiliateClickReferrerOrigin(`https://example.test/${'x'.repeat(3000)}`)).toBeUndefined();
  });

  it('normalizes an allow-listed v2 event and rejects private or fingerprint fields', () => {
    const event = durableEvent({
      affiliateCode: 'partner_7',
      campaignCode: 'LAUNCH_2026',
      referrerOrigin: 'https://Example.Test/path?phone=254700000001',
    });
    const normalized = normalizeDurableAffiliateClickEventV2(event);

    expect(normalized).toMatchObject({
      schemaVersion: 2,
      affiliateCode: 'PARTNER_7',
      campaignCode: 'launch_2026',
      referrerOrigin: 'https://example.test',
    });
    expect(JSON.stringify(normalized)).not.toMatch(/254700000001|\/path|userAgent|ipHash|readerId/i);
    for (const forbidden of ['ipHash', 'userAgent', 'referrer', 'email', 'phone', 'readerId', 'cookieToken']) {
      expect(normalizeDurableAffiliateClickEventV2({ ...event, [forbidden]: 'private-value' })).toBeNull();
    }
  });

  it('rejects malformed identities, mismatched windows and incomplete pseudonymous pairs', () => {
    const event = durableEvent();
    expect(normalizeDurableAffiliateClickEventV2({ ...event, id: 'legacy-click' })).toBeNull();
    expect(normalizeDurableAffiliateClickEventV2({ ...event, visitorKey: 'bad-key' })).toBeNull();
    expect(normalizeDurableAffiliateClickEventV2({
      ...event,
      timestamp: '2026-10-20T11:00:00+03:00',
    })).toBeNull();
    expect(normalizeDurableAffiliateClickEventV2({
      ...event,
      dedupeWindowStartedAt: '2026-10-20T11:00:00+03:00',
    })).toBeNull();
    expect(normalizeDurableAffiliateClickEventV2({ ...event, dedupeWindowStartedAt: undefined })).toBeNull();
    expect(normalizeDurableAffiliateClickEventV2({ ...event, visitorKey: undefined })).toBeNull();
    expect(normalizeDurableAffiliateClickEventV2({
      ...event,
      dedupeWindowStartedAt: new Date(NOW - AFFILIATE_CLICK_DEDUPE_WINDOW_MS).toISOString(),
    })).toBeNull();
  });
});

describe('durable click coverage proof', () => {
  const base = {
    rangeStartsAt: '2026-10-20T00:00:00.000Z',
    rangeEndsAt: '2026-10-20T23:59:59.999Z',
    durableHistoryStartsAt: '2026-10-19T00:00:00.000Z',
    querySucceeded: true,
    truncated: false,
  };

  it('marks a fully bounded valid query complete, including a legitimate empty result', () => {
    expect(assessDurableAffiliateClickCoverage({ ...base, events: [] })).toEqual({
      eventCoverage: 'complete',
      uniqueVisitorCoverage: 'complete',
      conversionCoverage: 'partial',
      reasons: ['complete'],
      validEventCount: 0,
      invalidEventCount: 0,
      eventsWithoutVisitorKey: 0,
    });

    const result = assessDurableAffiliateClickCoverage({ ...base, events: [durableEvent()] });
    expect(result.eventCoverage).toBe('complete');
    expect(result.uniqueVisitorCoverage).toBe('complete');
    expect(result.validEventCount).toBe(1);
  });

  it('never fabricates coverage before activation, after a failed query or for an invalid range', () => {
    expect(assessDurableAffiliateClickCoverage({
      ...base,
      durableHistoryStartsAt: undefined,
      events: [],
    })).toMatchObject({ eventCoverage: 'unavailable', reasons: ['not_enabled'] });
    expect(assessDurableAffiliateClickCoverage({
      ...base,
      durableHistoryStartsAt: undefined,
      querySucceeded: false,
      events: [],
    })).toMatchObject({ eventCoverage: 'unavailable', reasons: ['query_failed'] });
    expect(assessDurableAffiliateClickCoverage({
      ...base,
      rangeStartsAt: base.rangeEndsAt,
      rangeEndsAt: base.rangeStartsAt,
      events: [],
    })).toMatchObject({ eventCoverage: 'unavailable', reasons: ['invalid_range'] });
  });

  it('marks a range wholly before durable activation unavailable', () => {
    expect(assessDurableAffiliateClickCoverage({
      ...base,
      rangeStartsAt: '2026-10-17T00:00:00.000Z',
      rangeEndsAt: '2026-10-18T23:59:59.999Z',
      durableHistoryStartsAt: '2026-10-19T00:00:00.000Z',
      events: [],
    })).toMatchObject({
      eventCoverage: 'unavailable',
      reasons: ['predates_durable_history'],
    });
  });

  it('keeps conversion partial for pre-activation, truncated, invalid or visitorless history', () => {
    const visitorless = durableEvent({ visitorKey: undefined, dedupeWindowStartedAt: undefined });
    const result = assessDurableAffiliateClickCoverage({
      ...base,
      rangeStartsAt: '2026-10-18T00:00:00.000Z',
      truncated: true,
      events: [visitorless, { ...durableEvent(), ipHash: 'legacy-fingerprint' }],
    });

    expect(result.eventCoverage).toBe('partial');
    expect(result.uniqueVisitorCoverage).toBe('partial');
    expect(result.conversionCoverage).toBe('partial');
    expect(result.reasons).toEqual([
      'predates_durable_history',
      'truncated',
      'invalid_events',
      'missing_visitor_keys',
    ]);
    expect(result.validEventCount).toBe(1);
    expect(result.invalidEventCount).toBe(1);
    expect(result.eventsWithoutVisitorKey).toBe(1);
  });
});

describe('durable click activation marker validation', () => {
  const marker = {
    schemaVersion: 1,
    eventSchemaVersion: 2,
    activatedAt: '2026-10-20T08:00:00.000Z',
    completeFrom: '2026-10-20T08:05:00.000Z',
    keyVersion: 'v1',
    keyFingerprint: deriveAffiliateClickAnalyticsKeyFingerprint(TEST_SECRET)!,
  } as const;

  it('canonicalizes the exact create-only v1 marker', () => {
    expect(normalizeAffiliateClickAnalyticsActivationV1(marker)).toEqual(marker);
  });

  it('rejects backdated, unknown-field and incompatible markers', () => {
    expect(normalizeAffiliateClickAnalyticsActivationV1({
      ...marker,
      activatedAt: '2026-10-20T08:06:00.000Z',
    })).toBeNull();
    expect(normalizeAffiliateClickAnalyticsActivationV1({ ...marker, mutable: true })).toBeNull();
    expect(normalizeAffiliateClickAnalyticsActivationV1({ ...marker, eventSchemaVersion: 3 })).toBeNull();
    expect(normalizeAffiliateClickAnalyticsActivationV1({ ...marker, keyVersion: 'v2' })).toBeNull();
    expect(normalizeAffiliateClickAnalyticsActivationV1({
      ...marker,
      activatedAt: marker.completeFrom,
    })).toBeNull();
    expect(normalizeAffiliateClickAnalyticsActivationV1({
      ...marker,
      activatedAt: '2026-10-20T08:00:00Z',
    })).toBeNull();
  });
});
