import { describe, expect, it, vi } from 'vitest';

vi.mock('./store.js', () => ({
  store: {}
}));

import {
  createDarajaTimestamp,
  formatKenyanPhone,
  isDarajaMerchantConfigurationError,
  isValidKenyanMpesaPhone,
  resolveMpesaPaymentRail,
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

  it('distinguishes terminal merchant configuration errors from temporary transaction lookup delays', () => {
    expect(isDarajaMerchantConfigurationError('Merchant does not exist')).toBe(true);
    expect(isDarajaMerchantConfigurationError('Invalid BusinessShortCode')).toBe(true);
    expect(isDarajaMerchantConfigurationError('The transaction does not exist yet')).toBe(false);
  });

  it('maps Buy Goods to Store/Head Office and Till without using a PayBill value', () => {
    expect(resolveMpesaPaymentRail({
      paymentType: 'till',
      transactionType: 'CustomerBuyGoodsOnline',
      storeNumber: '600111',
      tillNumber: '600222',
      paybillNumber: '600333'
    })).toEqual({
      paymentType: 'till',
      transactionType: 'CustomerBuyGoodsOnline',
      businessShortCode: '600111',
      partyB: '600222'
    });
  });

  it('maps PayBill to one business number for both shortcode fields', () => {
    expect(resolveMpesaPaymentRail({
      paymentType: 'paybill',
      transactionType: 'CustomerPayBillOnline',
      shortcode: '600111',
      paybillNumber: '600333'
    })).toEqual({
      paymentType: 'paybill',
      transactionType: 'CustomerPayBillOnline',
      businessShortCode: '600333',
      partyB: '600333'
    });
  });

  it('rejects contradictory environment rail settings before a payment request', () => {
    expect(() => resolveMpesaPaymentRail(
      { storeNumber: '600111', tillNumber: '600222' },
      { MPESA_PAYMENT_TYPE: 'paybill', MPESA_TRANSACTION_TYPE: 'CustomerBuyGoodsOnline' }
    )).toThrow(/conflicts/i);
  });
});
