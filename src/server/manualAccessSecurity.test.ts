import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MANUAL_ACCESS_PHONE_RESERVATION_ID_PATTERN,
  ManualAccessError,
  createManualAccessPhoneAlreadyUsedError,
  getManualAccessPhoneReservationId,
  isManualAccessPhoneReservationId,
  normalizeManualAccessPhone
} from './manualAccessSecurity.js';

const TEST_SECRET = '11'.repeat(32);
const ALTERNATE_TEST_SECRET = '22'.repeat(32);
const NORMALIZED_KENYAN_PHONE = '254712345678';

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
