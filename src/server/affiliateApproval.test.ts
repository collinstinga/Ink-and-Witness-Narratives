import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  documents: new Map<string, any>(),
  getDb: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('./db.js', () => ({
  getDb: firestore.getDb,
  sanitizeForFirestore: (value: unknown) => JSON.parse(JSON.stringify(value)),
}));

import {
  AffiliateApprovalNotFoundError,
  AffiliateApprovalValidationError,
  approveAffiliateAccount,
  hasValidAffiliateWriterApproval,
} from './affiliateApproval.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe('explicit affiliate writer approval', () => {
  beforeEach(() => {
    firestore.documents.clear();
    const db = {
      collection: (collection: string) => ({ doc: (id: string) => ({ collection, id }) }),
      runTransaction: firestore.runTransaction,
    };
    firestore.getDb.mockReturnValue(db);
    firestore.runTransaction.mockImplementation(async (operation: (transaction: any) => Promise<any>) => {
      const writes: any[] = [];
      let writeStarted = false;
      const transaction = {
        get: async (reference: any) => {
          if (writeStarted) throw new Error('read after write');
          const value = firestore.documents.get(`${reference.collection}/${reference.id}`);
          return { exists: value !== undefined, data: () => clone(value) };
        },
        set: (reference: any, value: any, options?: { merge?: boolean }) => {
          writeStarted = true;
          writes.push({ reference, value: clone(value), merge: options?.merge === true });
        },
      };
      const result = await operation(transaction);
      for (const write of writes) {
        const key = `${write.reference.collection}/${write.reference.id}`;
        firestore.documents.set(key, write.merge
          ? { ...(firestore.documents.get(key) || {}), ...write.value }
          : write.value);
      }
      return clone(result);
    });
  });

  it('atomically activates a pending account and records explicit approval', async () => {
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      name: 'Amina',
      status: 'pending',
      sessionVersion: 'old-session-version',
    });

    const result = await approveAffiliateAccount('aff-one', 'Admin (Writer)');

    expect(result.affiliate).toMatchObject({
      status: 'active',
      approvedBy: 'Admin (Writer)',
    });
    expect(result.affiliate.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(firestore.documents.get('affiliates/aff-one')).toMatchObject({
      status: 'active',
      approvedBy: 'Admin (Writer)',
    });
    expect(result.audit).toMatchObject({
      action: 'affiliate_writer_approval_confirmed',
      targetType: 'affiliate',
      targetId: 'aff-one',
    });
  });

  it('is idempotent for an already approved active account', async () => {
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      name: 'Amina',
      status: 'active',
      approvedAt: '2026-10-01T00:00:00.000Z',
      approvedBy: 'Writer',
    });

    const result = await approveAffiliateAccount('aff-one', 'Another writer session');

    expect(result.audit).toBeUndefined();
    expect([...firestore.documents.keys()].filter(key => key.startsWith('affiliate_audit/'))).toHaveLength(0);
  });

  it('repairs incomplete approval metadata instead of treating it as approval', async () => {
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      name: 'Amina',
      status: 'active',
      approvedAt: 'not-a-date',
      approvedBy: ' ',
    });

    const result = await approveAffiliateAccount('aff-one', 'Writer');

    expect(hasValidAffiliateWriterApproval(result.affiliate)).toBe(true);
    expect(result.affiliate.approvedBy).toBe('Writer');
    expect(result.audit?.action).toBe('affiliate_writer_approval_confirmed');
  });

  it('does not silently reactivate a suspended account', async () => {
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      name: 'Amina',
      status: 'suspended',
    });

    await expect(approveAffiliateAccount('aff-one', 'Writer'))
      .rejects.toBeInstanceOf(AffiliateApprovalValidationError);
    expect(firestore.documents.get('affiliates/aff-one').status).toBe('suspended');
  });

  it('reactivates a suspended account only through an explicit status-approved call', async () => {
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      name: 'Amina',
      status: 'suspended',
    });

    const result = await approveAffiliateAccount('aff-one', 'Writer', { allowSuspendedReactivation: true });
    expect(result.affiliate).toMatchObject({ status: 'active', approvedBy: 'Writer' });
  });

  it('returns the same not-found boundary for malformed and missing identifiers', async () => {
    await expect(approveAffiliateAccount('../secret', 'Writer'))
      .rejects.toBeInstanceOf(AffiliateApprovalNotFoundError);
    await expect(approveAffiliateAccount('aff-missing', 'Writer'))
      .rejects.toBeInstanceOf(AffiliateApprovalNotFoundError);
  });
});
