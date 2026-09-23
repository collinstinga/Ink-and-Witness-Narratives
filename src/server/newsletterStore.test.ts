import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Stored = Record<string, unknown>;
  type Ref = { collectionName: string; id: string; path: string };
  const documents = new Map<string, Stored>();
  const key = (collectionName: string, id: string) => `${collectionName}/${id}`;
  const clone = <T>(value: T): T => structuredClone(value);
  const snapshot = (ref: Ref) => {
    const value = documents.get(ref.path);
    return { exists: value !== undefined, id: ref.id, data: () => value ? clone(value) : undefined };
  };
  const refFor = (collectionName: string, id: string): Ref => ({
    collectionName,
    id,
    path: key(collectionName, id)
  });

  const db = {
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((id: string) => {
        const ref = refFor(collectionName, id);
        return {
          ...ref,
          get: vi.fn(async () => snapshot(ref)),
          create: vi.fn(async (data: Stored) => {
            if (documents.has(ref.path)) throw new Error('already exists');
            documents.set(ref.path, clone(data));
          })
        };
      })
    })),
    runTransaction: vi.fn(async (callback: (transaction: any) => Promise<unknown>) => {
      const operations: Array<() => void> = [];
      const transaction = {
        get: vi.fn(async (ref: Ref) => snapshot(ref)),
        create: vi.fn((ref: Ref, data: Stored) => operations.push(() => {
          if (documents.has(ref.path)) throw new Error('already exists');
          documents.set(ref.path, clone(data));
        })),
        set: vi.fn((ref: Ref, data: Stored) => operations.push(() => {
          documents.set(ref.path, clone(data));
        })),
        delete: vi.fn((ref: Ref) => operations.push(() => {
          documents.delete(ref.path);
        }))
      };
      const result = await callback(transaction);
      operations.forEach(operation => operation());
      return result;
    })
  };

  return { documents, key, db };
});

vi.mock('./db.js', () => ({
  getDb: () => fake.db,
  sanitizeForFirestore: (value: unknown) => value
}));

describe('newsletter store', () => {
  beforeEach(() => {
    fake.documents.clear();
    fake.db.collection.mockClear();
    fake.db.runTransaction.mockClear();
  });

  it('creates a pending subscription and activates it only with the single-use confirmation token', async () => {
    const { newsletterStore } = await import('./newsletterStore.js');
    let confirmationToken = '';
    await expect(newsletterStore.requestSubscription({
      email: ' Reader@Example.com ',
      name: ' Reader One ',
      interests: ['Faith', 'faith', 'Poetry'],
      consentSource: 'homepage',
      consentVersion: '2026-09-23'
    }, {
      confirmationTtlMs: 5 * 60 * 1000,
      onConfirmationRequired: delivery => {
        confirmationToken = delivery.confirmationToken;
      }
    })).resolves.toEqual({ accepted: true });

    expect(confirmationToken).toMatch(/^nwc_/);
    const pending = await newsletterStore.findSubscriberByEmail('reader@example.com');
    expect(pending).toMatchObject({
      email: 'reader@example.com',
      name: 'Reader One',
      interests: ['Faith', 'Poetry'],
      status: 'pending'
    });

    await expect(newsletterStore.confirmSubscription(confirmationToken))
      .resolves.toEqual({ accepted: true });
    const active = await newsletterStore.findSubscriberByEmail('reader@example.com');
    expect(active?.status).toBe('active');
    expect(active?.confirmedAt).toBeTruthy();

    await expect(newsletterStore.confirmSubscription(confirmationToken))
      .resolves.toEqual({ accepted: true });
    expect((await newsletterStore.findSubscriberByEmail('reader@example.com'))?.status).toBe('active');
  }, 60_000);

  it('does not alter or re-challenge an already active email address', async () => {
    const { newsletterStore } = await import('./newsletterStore.js');
    let token = '';
    await newsletterStore.requestSubscription({
      email: 'reader@example.com',
      name: 'Original Name',
      interests: ['Life'],
      consentSource: 'homepage',
      consentVersion: 'v1'
    }, { onConfirmationRequired: delivery => { token = delivery.confirmationToken; } });
    await newsletterStore.confirmSubscription(token);

    let repeatedCallback = false;
    await newsletterStore.requestSubscription({
      email: 'reader@example.com',
      name: 'Changed By Stranger',
      interests: ['Intimacy'],
      consentSource: 'homepage',
      consentVersion: 'v1'
    }, { onConfirmationRequired: () => { repeatedCallback = true; } });

    expect(repeatedCallback).toBe(false);
    expect(await newsletterStore.findSubscriberByEmail('reader@example.com')).toMatchObject({
      name: 'Original Name',
      interests: ['Life'],
      status: 'active'
    });
  }, 60_000);

  it('unsubscribes idempotently with a signed capability', async () => {
    const { newsletterStore } = await import('./newsletterStore.js');
    let confirmationToken = '';
    await newsletterStore.requestSubscription({
      email: 'reader@example.com',
      consentSource: 'homepage',
      consentVersion: 'v1'
    }, { onConfirmationRequired: delivery => { confirmationToken = delivery.confirmationToken; } });
    await newsletterStore.confirmSubscription(confirmationToken);
    const active = await newsletterStore.findSubscriberByEmail('reader@example.com');
    const signingSecret = 'newsletter-store-test-signing-secret-with-32-characters';
    const unsubscribeToken = newsletterStore.createUnsubscribeToken(active!.id, signingSecret);

    await newsletterStore.unsubscribe(unsubscribeToken, { signingSecret });
    await newsletterStore.unsubscribe(unsubscribeToken, { signingSecret });
    expect((await newsletterStore.findSubscriberByEmail('reader@example.com'))?.status)
      .toBe('unsubscribed');
  }, 60_000);

  it('queues one deterministic delivery and advances campaign counts exactly once', async () => {
    const { newsletterStore } = await import('./newsletterStore.js');
    let confirmationToken = '';
    await newsletterStore.requestSubscription({
      email: 'reader@example.com',
      consentSource: 'homepage',
      consentVersion: 'v1'
    }, { onConfirmationRequired: delivery => { confirmationToken = delivery.confirmationToken; } });
    await newsletterStore.confirmSubscription(confirmationToken);
    const subscriber = await newsletterStore.findSubscriberByEmail('reader@example.com');
    const campaign = await newsletterStore.createCampaign({
      content: { subject: 'New writing', body: 'A new piece is ready.' },
      audience: { type: 'all' },
      createdBy: 'admin-1'
    });
    await newsletterStore.setCampaignStatus(campaign.id, { status: 'queued' });

    const first = await newsletterStore.queueDelivery(campaign.id, subscriber!.id);
    const second = await newsletterStore.queueDelivery(campaign.id, subscriber!.id);
    expect(second.id).toBe(first.id);
    expect((await newsletterStore.getCampaign(campaign.id))?.recipientCount).toBe(1);

    await newsletterStore.recordDeliveryOutcome(first.id, {
      status: 'sent',
      providerMessageId: 'email_123'
    });
    await newsletterStore.recordDeliveryOutcome(first.id, {
      status: 'sent',
      providerMessageId: 'email_123'
    });
    expect((await newsletterStore.getCampaign(campaign.id))?.sentCount).toBe(1);
  }, 60_000);
});
