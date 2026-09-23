import { describe, expect, it } from 'vitest';
import type { PaymentTransaction } from '../types.js';
import { planSalesLedgerBackfill } from './salesLedgerMigration.js';

function legacyTransaction(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: 'tx_legacy_1',
    checkoutRequestId: 'legacy_checkout_1',
    articleId: 'piece_1',
    articleTitle: 'Legacy Piece',
    phoneNumber: '254712345678',
    userId: 'reader_1',
    userEmail: 'READER@EXAMPLE.COM',
    amount: 300,
    type: 'PURCHASE',
    status: 'CONFIRMED',
    mpesaReceiptNumber: 'SIALEGACY1',
    confirmedAt: '2026-09-20T10:01:00.000Z',
    createdAt: '2026-09-20T10:00:00.000Z',
    ...overrides
  };
}

describe('sales ledger historical backfill planning', () => {
  it('creates an additive v2 patch without changing canonical transaction fields', () => {
    const plan = planSalesLedgerBackfill(legacyTransaction());

    expect(plan.action).toBe('update');
    expect(plan.patch).toEqual({
      schemaVersion: 2,
      orderId: 'ord_tx_legacy_1',
      paymentMethod: 'mpesa',
      saleChannel: 'DIRECT',
      settledAt: '2026-09-20T10:01:00.000Z',
      buyer: {
        userId: 'reader_1',
        email: 'reader@example.com',
        phoneNumber: '254712345678',
        phoneVerifiedAt: undefined,
        name: undefined
      }
    });
    expect(plan.patch).not.toHaveProperty('status');
    expect(plan.patch).not.toHaveProperty('amount');
    expect(plan.patch).not.toHaveProperty('downloadToken');
  });

  it('is idempotent once the additive patch has been applied', () => {
    const legacy = legacyTransaction();
    const first = planSalesLedgerBackfill(legacy);
    const second = planSalesLedgerBackfill({ ...legacy, ...first.patch });

    expect(second.action).toBe('skip');
    expect(second.changedFields).toEqual([]);
  });

  it('preserves existing buyer fields while filling only missing snapshot keys', () => {
    const plan = planSalesLedgerBackfill(legacyTransaction({
      buyer: { name: 'Original Name', email: 'original@example.com' }
    }));

    expect(plan.patch?.buyer).toEqual({
      userId: 'reader_1',
      email: 'original@example.com',
      phoneNumber: '254712345678',
      phoneVerifiedAt: undefined,
      name: 'Original Name'
    });
  });

  it('skips seed records and rejects structurally incomplete records', () => {
    expect(planSalesLedgerBackfill(legacyTransaction({ isSeed: true })).action).toBe('skip');
    expect(planSalesLedgerBackfill(legacyTransaction({ articleId: '' })).action).toBe('error');
  });

  it('reports missing evidence on settled historical sales', () => {
    const plan = planSalesLedgerBackfill(legacyTransaction({
      articleTitle: undefined,
      phoneNumber: undefined,
      userId: undefined,
      userEmail: undefined,
      mpesaReceiptNumber: undefined
    }));

    expect(plan.warnings).toEqual(expect.arrayContaining([
      'Settled sale has no piece-title snapshot.',
      'Settled sale has no durable buyer identifier.',
      'Settled sale has no provider/reference identifier.'
    ]));
  });
});
