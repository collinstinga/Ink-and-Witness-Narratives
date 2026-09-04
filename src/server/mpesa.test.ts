import { describe, expect, it, vi } from 'vitest';

vi.mock('./store.js', () => ({
  store: {}
}));

import {
  createDarajaTimestamp,
  formatKenyanPhone,
  isValidKenyanMpesaPhone,
  resolveDarajaCallbackUrl
} from './mpesa.js';

describe('M-Pesa request helpers', () => {
  it('formats Daraja timestamps in Africa/Nairobi time', () => {
    expect(createDarajaTimestamp(new Date('2026-09-04T12:34:56.000Z')))
      .toBe('20260904153456');
  });

  it('normalizes Kenyan Safaricom phone formats without a fallback number', () => {
    expect(formatKenyanPhone('0712 345 678')).toBe('254712345678');
    expect(formatKenyanPhone('+254 112 345 678')).toBe('254112345678');
    expect(isValidKenyanMpesaPhone('0712 345 678')).toBe(true);
    expect(isValidKenyanMpesaPhone('12345')).toBe(false);
    expect(formatKenyanPhone('12345')).toBe('12345');
  });

  it('turns a configured domain into the production callback endpoint', () => {
    expect(resolveDarajaCallbackUrl('www.inkandwitness-narratives.co.ke'))
      .toBe('https://www.inkandwitness-narratives.co.ke/api/mpesa/callback');
    expect(resolveDarajaCallbackUrl('https://www.inkandwitness-narratives.co.ke/api/mpesa/callback'))
      .toBe('https://www.inkandwitness-narratives.co.ke/api/mpesa/callback');
  });

  it('rejects insecure callback URLs', () => {
    expect(() => resolveDarajaCallbackUrl('http://example.com/callback')).toThrow(/HTTPS/);
  });
});
