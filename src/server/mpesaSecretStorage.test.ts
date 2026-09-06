import { describe, expect, it } from 'vitest';
import {
  containsStoredMpesaSecrets,
  getRuntimeMpesaSecrets,
  hasCompleteRuntimeMpesaSecrets,
  hasUnsafeMpesaSecretUpdate,
  stripStoredMpesaSecrets
} from './mpesaSecretStorage.js';

describe('M-Pesa environment-only secret storage', () => {
  it('resolves canonical variables before supported legacy aliases', () => {
    expect(getRuntimeMpesaSecrets({
      MPESA_CONSUMER_KEY: ' canonical-key ',
      MPESA_TILL_CONSUMER_KEY: 'legacy-key',
      MPESA_CONSUMER_SECRET: ' canonical-secret ',
      MPESA_TILL_SECRET_KEY: 'legacy-secret',
      MPESA_PASSKEY: ' canonical-passkey ',
      MPESA_PASSKEY_: 'legacy-passkey'
    })).toEqual({
      consumerKey: 'canonical-key',
      consumerSecret: 'canonical-secret',
      passkey: 'canonical-passkey'
    });
  });

  it('requires the complete runtime secret set before migration', () => {
    expect(hasCompleteRuntimeMpesaSecrets({
      MPESA_CONSUMER_KEY: 'key',
      MPESA_CONSUMER_SECRET: 'secret',
      MPESA_PASSKEY: 'passkey'
    })).toBe(true);
    expect(hasCompleteRuntimeMpesaSecrets({ MPESA_CONSUMER_KEY: 'key' })).toBe(false);
  });

  it('removes reusable provider secrets without changing public rail settings', () => {
    const input = {
      consumerKey: 'key',
      consumerSecret: 'secret',
      passkey: 'passkey',
      paymentType: 'till',
      tillNumber: '123456'
    };

    expect(containsStoredMpesaSecrets(input)).toBe(true);
    expect(stripStoredMpesaSecrets(input)).toEqual({ paymentType: 'till', tillNumber: '123456' });
    expect(input.consumerSecret).toBe('secret');
  });

  it('blocks real secret writes while allowing masked compatibility placeholders', () => {
    expect(hasUnsafeMpesaSecretUpdate({ consumerSecret: 'new-secret' })).toBe(true);
    expect(hasUnsafeMpesaSecretUpdate({ consumerSecret: '••••••••••••••••' })).toBe(false);
    expect(hasUnsafeMpesaSecretUpdate({ consumerSecret: '' })).toBe(false);
    expect(hasUnsafeMpesaSecretUpdate({ tillNumber: '123456' })).toBe(false);
  });
});
