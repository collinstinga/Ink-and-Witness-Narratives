import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MANUAL_ACCESS_ENTITLEMENT_COLLECTION,
  MANUAL_ACCESS_ENTITLEMENT_ID_PATTERN,
  MANUAL_ACCESS_ENTITLEMENT_VERSION,
  MANUAL_ACCESS_PHONE_RESERVATION_ID_PATTERN,
  ManualAccessError,
  createManualAccessPhoneAlreadyUsedError,
  getManualAccessEntitlementId,
  getManualAccessPhoneReservationId,
  isManualAccessEntitlementId,
  isManualAccessBearerLicense,
  isManualAccessPhoneReservationId,
  normalizeManualAccessEntitlement,
  normalizeManualAccessPhone
} from './manualAccessSecurity.js';

const TEST_SECRET = '11'.repeat(32);
const ALTERNATE_TEST_SECRET = '22'.repeat(32);
const NORMALIZED_KENYAN_PHONE = '254712345678';
const USER_ID = 'reader_7Zx91';
const ARTICLE_ID = 'the-witness-2026';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('manual-access phone normalization', () => {
  it.each([
    '0712 345 678',
    '+254 712 345 678',
    '254712345678',
    '712345678',
    '00254712345678'
  ])('normalizes equivalent Kenyan phone form %s to one canonical value', input => {
    expect(normalizeManualAccessPhone(input)).toBe(NORMALIZED_KENYAN_PHONE);
  });

  it('normalizes Kenya mobile numbers using the 01 prefix', () => {
    expect(normalizeManualAccessPhone('0112 345 678')).toBe('254112345678');
  });

  it.each([
    undefined,
    null,
    254712345678,
    '',
    'not-a-phone',
    '12345678',
    '1234567890123456'
  ])('rejects invalid phone value %j', input => {
    expect(normalizeManualAccessPhone(input)).toBe('');
  });
});

describe('manual-access phone reservation identifiers', () => {
  it('is stable across equivalent phone formats when the HMAC secret is unchanged', () => {
    const ids = [
      '0712345678',
      '+254 712 345 678',
      NORMALIZED_KENYAN_PHONE,
      '712345678'
    ].map(phone => getManualAccessPhoneReservationId(phone, TEST_SECRET));

    expect(new Set(ids).size).toBe(1);
  });

  it('uses the manual-access domain separator and changes when the secret changes', () => {
    const expectedDigest = crypto
      .createHmac('sha256', Buffer.from(TEST_SECRET, 'hex'))
      .update(`manual-access-phone:v1:${NORMALIZED_KENYAN_PHONE}`, 'utf8')
      .digest('hex');
    const rawPhoneDigest = crypto
      .createHmac('sha256', Buffer.from(TEST_SECRET, 'hex'))
      .update(NORMALIZED_KENYAN_PHONE, 'utf8')
      .digest('hex');

    const reservationId = getManualAccessPhoneReservationId(
      NORMALIZED_KENYAN_PHONE,
      TEST_SECRET
    );

    expect(reservationId).toBe(`v1_${expectedDigest}`);
    expect(reservationId).not.toBe(`v1_${rawPhoneDigest}`);
    expect(
      getManualAccessPhoneReservationId(NORMALIZED_KENYAN_PHONE, ALTERNATE_TEST_SECRET)
    ).not.toBe(reservationId);
  });

  it('produces a non-identifying, strictly validated reservation document ID', () => {
    const reservationId = getManualAccessPhoneReservationId(
      NORMALIZED_KENYAN_PHONE,
      TEST_SECRET
    );

    expect(reservationId).toMatch(MANUAL_ACCESS_PHONE_RESERVATION_ID_PATTERN);
    expect(isManualAccessPhoneReservationId(reservationId)).toBe(true);
    expect(reservationId).not.toContain(NORMALIZED_KENYAN_PHONE);
    expect(reservationId).not.toContain(NORMALIZED_KENYAN_PHONE.slice(-9));
    expect(isManualAccessPhoneReservationId(`v1_${'A'.repeat(64)}`)).toBe(false);
    expect(isManualAccessPhoneReservationId(`v2_${'a'.repeat(64)}`)).toBe(false);
    expect(isManualAccessPhoneReservationId('v1_short')).toBe(false);
  });
});

describe('manual-access entitlement identifiers', () => {
  it('uses the versioned server-only collection contract', () => {
    expect(MANUAL_ACCESS_ENTITLEMENT_COLLECTION).toBe('manual_access_entitlements');
    expect(MANUAL_ACCESS_ENTITLEMENT_VERSION).toBe(1);
  });

  it('is deterministic for one authenticated account and article with a stable secret', () => {
    const first = getManualAccessEntitlementId(USER_ID, ARTICLE_ID, TEST_SECRET);
    const second = getManualAccessEntitlementId(USER_ID, ARTICLE_ID, TEST_SECRET);

    expect(first).toBe(second);
    expect(first).toMatch(MANUAL_ACCESS_ENTITLEMENT_ID_PATTERN);
    expect(isManualAccessEntitlementId(first)).toBe(true);
  });

  it('uses an unambiguous entitlement domain separator and hides both identifiers', () => {
    const message = `manual-access-entitlement:v1:${Buffer.byteLength(USER_ID, 'utf8')}:${USER_ID}:${Buffer.byteLength(ARTICLE_ID, 'utf8')}:${ARTICLE_ID}`;
    const expectedDigest = crypto
      .createHmac('sha256', Buffer.from(TEST_SECRET, 'hex'))
      .update(message, 'utf8')
      .digest('hex');
    const rawDigest = crypto
      .createHmac('sha256', Buffer.from(TEST_SECRET, 'hex'))
      .update(`${USER_ID}${ARTICLE_ID}`, 'utf8')
      .digest('hex');

    const entitlementId = getManualAccessEntitlementId(USER_ID, ARTICLE_ID, TEST_SECRET);

    expect(entitlementId).toBe(`v1_${expectedDigest}`);
    expect(entitlementId).not.toBe(`v1_${rawDigest}`);
    expect(entitlementId).not.toContain(USER_ID);
    expect(entitlementId).not.toContain(ARTICLE_ID);
    expect(getManualAccessEntitlementId(USER_ID, ARTICLE_ID, ALTERNATE_TEST_SECRET))
      .not.toBe(entitlementId);
  });

  it('does not collide for ambiguous concatenated account/article pairs', () => {
    expect(getManualAccessEntitlementId('ab', 'c', TEST_SECRET)).not.toBe(
      getManualAccessEntitlementId('a', 'bc', TEST_SECRET)
    );
  });

  it('strictly validates entitlement IDs', () => {
    expect(isManualAccessEntitlementId(`v1_${'a'.repeat(64)}`)).toBe(true);
    expect(isManualAccessEntitlementId(`v1_${'A'.repeat(64)}`)).toBe(false);
    expect(isManualAccessEntitlementId(`v2_${'a'.repeat(64)}`)).toBe(false);
    expect(isManualAccessEntitlementId('v1_short')).toBe(false);
    expect(isManualAccessEntitlementId(null)).toBe(false);
  });

  it.each([
    ['', ARTICLE_ID, 'MANUAL_ACCESS_INVALID_USER'],
    [' reader', ARTICLE_ID, 'MANUAL_ACCESS_INVALID_USER'],
    [USER_ID, '', 'MANUAL_ACCESS_INVALID_ARTICLE'],
    [USER_ID, 'article\nname', 'MANUAL_ACCESS_INVALID_ARTICLE']
  ])('rejects an invalid account/article identity without deriving an ID', (userId, articleId, code) => {
    expect(() => getManualAccessEntitlementId(userId, articleId, TEST_SECRET)).toThrowError(
      expect.objectContaining({ name: 'ManualAccessError', code, statusCode: 400 })
    );
  });

  it('uses a configured stable secret when one is not passed explicitly', () => {
    vi.stubEnv('MANUAL_ACCESS_PHONE_RESERVATION_SECRET', TEST_SECRET);

    expect(getManualAccessEntitlementId(USER_ID, ARTICLE_ID)).toBe(
      getManualAccessEntitlementId(USER_ID, ARTICLE_ID, TEST_SECRET)
    );
  });

  it.each(['', 'too-short'])('fails closed without a stable shared-state secret, even outside production', configuredSecret => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MANUAL_ACCESS_PHONE_RESERVATION_SECRET', configuredSecret);

    expect(() => getManualAccessEntitlementId(USER_ID, ARTICLE_ID)).toThrowError(
      expect.objectContaining({
        name: 'ManualAccessError',
        code: 'MANUAL_ACCESS_CONFIGURATION_UNAVAILABLE',
        statusCode: 503
      })
    );
  });
});

describe('manual-access entitlement records', () => {
  const createdAt = '2026-09-09T08:00:00.000Z';
  const laterAt = '2026-09-09T09:00:00.000Z';
  const activeRecord = {
    storageVersion: 1,
    grantId: 'grant_123',
    userId: USER_ID,
    articleId: ARTICLE_ID,
    state: 'active',
    createdAt,
    updatedAt: createdAt
  } as const;

  it('normalizes a minimal active, token-free record', () => {
    expect(normalizeManualAccessEntitlement(activeRecord)).toEqual(activeRecord);
  });

  it('preserves an optional finite positive entitlement expiry', () => {
    const expiresAt = Date.parse('2026-10-09T08:00:00.000Z');
    expect(normalizeManualAccessEntitlement({
      ...activeRecord,
      expiresAt
    })).toEqual({
      ...activeRecord,
      expiresAt
    });
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['not finite', Number.POSITIVE_INFINITY],
    ['not a number', '1791532800000'],
    ['null', null]
  ])('rejects a %s entitlement expiry', (_label, expiresAt) => {
    expect(normalizeManualAccessEntitlement({
      ...activeRecord,
      expiresAt
    })).toBeNull();
  });

  it('normalizes valid revoked and deleted tombstones', () => {
    const revoked = {
      ...activeRecord,
      state: 'revoked',
      updatedAt: laterAt,
      revokedAt: laterAt
    } as const;
    const deleted = {
      ...revoked,
      state: 'deleted',
      deletedAt: laterAt
    } as const;

    expect(normalizeManualAccessEntitlement(revoked)).toEqual(revoked);
    expect(normalizeManualAccessEntitlement(deleted)).toEqual(deleted);
  });

  it('preserves expiry while normalizing terminal tombstones', () => {
    const expiresAt = Date.parse('2026-10-09T08:00:00.000Z');
    const revoked = {
      ...activeRecord,
      state: 'revoked',
      updatedAt: laterAt,
      expiresAt,
      revokedAt: laterAt
    } as const;

    expect(normalizeManualAccessEntitlement(revoked)).toEqual(revoked);
  });

  it.each([
    'token',
    'downloadToken',
    'rawPhone',
    'phone',
    'claimedPhone',
    'receipt',
    'email'
  ])('rejects records containing forbidden bearer or PII field %s', forbiddenField => {
    expect(normalizeManualAccessEntitlement({
      ...activeRecord,
      [forbiddenField]: 'must-not-persist'
    })).toBeNull();
  });

  it.each([
    ['wrong storage version', { ...activeRecord, storageVersion: 2 }],
    ['unknown state', { ...activeRecord, state: 'pending' }],
    ['blank grant', { ...activeRecord, grantId: '' }],
    ['trimmed identity mismatch', { ...activeRecord, userId: ` ${USER_ID}` }],
    ['invalid timestamp', { ...activeRecord, updatedAt: 'yesterday' }],
    ['update before creation', { ...activeRecord, updatedAt: '2026-09-09T07:59:59.999Z' }],
    ['active record with revokedAt', { ...activeRecord, revokedAt: laterAt }],
    ['revoked record without revokedAt', { ...activeRecord, state: 'revoked' }],
    ['revoked record with deletedAt', { ...activeRecord, state: 'revoked', updatedAt: laterAt, revokedAt: laterAt, deletedAt: laterAt }],
    ['deleted record without deletedAt', { ...activeRecord, state: 'deleted' }],
    ['future lifecycle timestamp', { ...activeRecord, state: 'revoked', updatedAt: createdAt, revokedAt: laterAt }],
    ['unknown field', { ...activeRecord, note: 'not part of v1' }]
  ])('rejects %s', (_label, record) => {
    expect(normalizeManualAccessEntitlement(record)).toBeNull();
  });

  it.each([null, undefined, [], 'record', 42])('rejects non-record value %j', value => {
    expect(normalizeManualAccessEntitlement(value)).toBeNull();
  });
});

describe('manual-access failures', () => {
  it.each([
    ['', 'missing'],
    ['too-short', 'weak']
  ])('fails closed in production when the reservation secret is %s', explicitSecret => {
    vi.stubEnv('VERCEL', '1');

    expect(() => getManualAccessPhoneReservationId(
      NORMALIZED_KENYAN_PHONE,
      explicitSecret
    )).toThrowError(expect.objectContaining({
      name: 'ManualAccessError',
      code: 'MANUAL_ACCESS_CONFIGURATION_UNAVAILABLE',
      statusCode: 503
    }));
  });

  it('fails closed outside production rather than deriving restart-unstable phone reservations', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('MANUAL_ACCESS_PHONE_RESERVATION_SECRET', '');

    expect(() => getManualAccessPhoneReservationId(NORMALIZED_KENYAN_PHONE)).toThrowError(
      expect.objectContaining({
        name: 'ManualAccessError',
        code: 'MANUAL_ACCESS_CONFIGURATION_UNAVAILABLE',
        statusCode: 503
      })
    );
  });

  it('returns the stable invalid-phone error contract before secret resolution', () => {
    vi.stubEnv('VERCEL', '1');

    expect(() => getManualAccessPhoneReservationId('', '')).toThrowError(
      expect.objectContaining({
        name: 'ManualAccessError',
        code: 'MANUAL_ACCESS_INVALID_PHONE',
        statusCode: 400
      })
    );
  });

  it('returns the stable already-used conflict error contract', () => {
    const error = createManualAccessPhoneAlreadyUsedError();

    expect(error).toBeInstanceOf(ManualAccessError);
    expect(error).toMatchObject({
      name: 'ManualAccessError',
      code: 'MANUAL_ACCESS_PHONE_ALREADY_USED',
      statusCode: 409
    });
  });
});

describe('legacy manual bearer classification', () => {
  it.each([
    ['explicit source', 'ink_1788782400000_' + 'a'.repeat(64), { accessSource: 'MANUAL_GRANT' }],
    ['legacy grant prefix', 'ink_grant_legacy-reader', { accessSource: 'SYSTEM' }],
    ['legacy manual prefix', 'ink_manual_legacy-reader', {}],
    ['legacy receipt', 'ink_1788782400001_' + 'b'.repeat(64), { receipt: 'MANUAL-GRANT' }]
  ])('classifies %s as account-bound manual access', (_label, token, license) => {
    expect(isManualAccessBearerLicense(token, license)).toBe(true);
  });

  it('keeps a confirmed M-Pesa purchase eligible for bearer recovery', () => {
    expect(isManualAccessBearerLicense(
      'ink_1788782400002_' + 'c'.repeat(64),
      { accessSource: 'MPESA_PURCHASE', receipt: 'SIA1234567' }
    )).toBe(false);
  });
});
