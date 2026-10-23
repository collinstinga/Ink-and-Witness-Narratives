import { describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS } from './affiliateNotifications.js';
import { storeHeldAffiliateNotifications } from './affiliateNotificationOutbox.js';

const NOW = '2026-10-23T09:00:00.000Z';
type Ref = { path: string; id: string };

function harness() {
  const documents = new Map<string, unknown>();
  const writes: string[] = [];
  const reads: string[] = [];
  let queue = Promise.resolve();
  let failCommit = false;
  const snapshot = (ref: Ref) => ({
    id: ref.id, ref, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string): Ref => ({ path: `${name}/${id}`, id }) }),
    runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const staged: Array<{ ref: Ref; value: unknown }> = [];
      const get = async (ref: Ref) => {
        if (staged.length) throw new Error('read after write');
        reads.push(ref.path);
        return snapshot(ref);
      };
      try {
        const result = await callback({
          get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
          create: (ref: Ref, value: unknown) => {
            if (documents.has(ref.path)) throw new Error('already exists');
            staged.push({ ref, value: structuredClone(value) });
          },
          set: () => { throw new Error('Unexpected set'); },
          update: () => { throw new Error('Unexpected update'); },
          delete: () => { throw new Error('Unexpected delete'); },
        });
        if (failCommit) throw new Error('provider-secret@example.test injected commit failure');
        for (const { ref, value } of staged) { documents.set(ref.path, value); writes.push(ref.path); }
        return result;
      } finally { release(); }
    }),
  };
  const settings = structuredClone(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
  settings.enabled = true;
  settings.templates.find(item => item.eventType === 'new_commission')!.enabled = true;
  documents.set('site_configs/affiliate_notifications', settings);
  documents.set('affiliates/partner-one', {
    id: 'wrong-document-id', status: 'active', email: 'private@example.test', name: 'Private Name',
    acceptedTerms: true, approvedAt: NOW, approvedBy: 'Writer',
    literaryCircle: { complimentaryAccess: { status: 'active' }, tier: { id: 'literary-partner' } },
  });
  const input = {
    db: db as unknown as Firestore, mode: 'held' as const, now: NOW,
    source: {
      eventType: 'new_commission' as const, sourceId: 'commission-one', sourceVersion: 1,
      occurredAt: NOW, targetAffiliateId: 'partner-one',
    },
    affiliateIds: ['partner-one'],
  };
  return { documents, writes, reads, db, input, failCommit: () => { failCommit = true; } };
}

function sourcePath(h: ReturnType<typeof harness>) {
  return h.writes.find(path => path.includes('/ane1_'))!;
}
function intentPath(h: ReturnType<typeof harness>) {
  return h.writes.find(path => path.includes('/ani1_'))!;
}

function evidenceHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    const record = item as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  };
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

describe('create-only held partner notification outbox', () => {
  it('defaults to zero transactions, reads and writes', async () => {
    const h = harness();
    expect(await storeHeldAffiliateNotifications({ ...h.input, mode: undefined })).toEqual({ status: 'disabled', intentCount: 0 });
    expect(h.db.runTransaction).not.toHaveBeenCalled();
    expect(h.reads).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  it('atomically creates a source plus held intent using current database identity and settings', async () => {
    const h = harness();
    const original = structuredClone([...h.documents]);
    expect(await storeHeldAffiliateNotifications(h.input)).toEqual({ status: 'created', intentCount: 1 });
    expect(h.writes).toHaveLength(2);
    expect(h.writes.every(path => path.startsWith('affiliate_notification_outbox/'))).toBe(true);
    expect(h.documents.get(intentPath(h))).toMatchObject({ kind: 'intent', state: 'held', affiliateId: 'partner-one' });
    expect(h.documents.get(sourcePath(h))).toMatchObject({ kind: 'source', deliveryMode: 'preview_only' });
    expect(JSON.stringify(h.writes.map(path => h.documents.get(path)))).not.toMatch(/private@example|Private Name|wrong-document-id/);
    for (const [path, value] of original) expect(h.documents.get(path)).toEqual(value);
    expect(h.reads).toHaveLength(4); // source, settings, affiliate, missing intent
  });

  it('deduplicates concurrent requests and later retries without rewriting records', async () => {
    const h = harness();
    const results = await Promise.all([storeHeldAffiliateNotifications(h.input), storeHeldAffiliateNotifications(h.input)]);
    expect(results.map(result => result.status).sort()).toEqual(['created', 'existing']);
    const preserved = structuredClone([...h.documents]);
    const settings = h.documents.get('site_configs/affiliate_notifications') as { revision: number };
    settings.revision++;
    expect(await storeHeldAffiliateNotifications({ ...h.input, now: '2026-10-23T10:00:00.000Z' })).toEqual({ status: 'existing', intentCount: 1 });
    expect(h.writes).toHaveLength(2);
    for (const [path, value] of preserved.filter(([path]) => path.startsWith('affiliate_notification_outbox/'))) {
      expect(h.documents.get(path)).toEqual(value);
    }
  });

  it('commits nothing when the transaction fails and redacts the provider error', async () => {
    const h = harness();
    const original = structuredClone([...h.documents]);
    h.failCommit();
    await expect(storeHeldAffiliateNotifications(h.input)).rejects.toThrow('Partner notification outbox write or verification failed; no repair was attempted.');
    expect([...h.documents]).toEqual(original);
    expect(h.writes).toEqual([]);
  });

  it.each(['disabled', 'suspended', 'missing', 'unapproved'] as const)('writes no records for %s eligibility', async change => {
    const h = harness();
    if (change === 'disabled') h.documents.delete('site_configs/affiliate_notifications');
    if (change === 'missing') h.documents.delete('affiliates/partner-one');
    const affiliate = h.documents.get('affiliates/partner-one') as Record<string, unknown>;
    if (change === 'suspended') affiliate.status = 'suspended';
    if (change === 'unapproved') delete affiliate.approvedAt;
    expect(await storeHeldAffiliateNotifications(h.input)).toEqual({ status: 'ineligible', intentCount: 0 });
    expect(h.writes).toEqual([]);
  });

  it.each(['missing_intent', 'modified_intent', 'changed_source', 'changed_audience', 'orphan_intent', 'changed_source_time', 'unknown_source_field'] as const)('refuses %s without repairing or overwriting', async change => {
    const h = harness();
    await storeHeldAffiliateNotifications(h.input);
    if (change === 'missing_intent') h.documents.delete(intentPath(h));
    if (change === 'modified_intent') (h.documents.get(intentPath(h)) as Record<string, unknown>).dueAt = '2026-10-24T00:00:00.000Z';
    if (change === 'changed_source') h.input.source.occurredAt = '2026-10-23T08:00:00.000Z';
    if (change === 'changed_audience') h.input.affiliateIds.push('partner-two');
    if (change === 'orphan_intent') h.documents.delete(sourcePath(h));
    if (change === 'changed_source_time') (h.documents.get(sourcePath(h)) as Record<string, unknown>).createdAt = 'modified-time';
    if (change === 'unknown_source_field') (h.documents.get(sourcePath(h)) as Record<string, unknown>).unexpected = 'private-value';
    const preserved = structuredClone([...h.documents]);
    await expect(storeHeldAffiliateNotifications(h.input)).rejects.toThrow(/no repair was attempted/);
    expect([...h.documents]).toEqual(preserved);
    expect(h.writes).toHaveLength(2);
  });

  it('rejects duplicate, excessive or invalid recipients and malformed sources before any transaction', async () => {
    for (const ids of [['partner-one', 'partner-one'], ['bad/id'], new Array<string>(1), Array.from({ length: 201 }, (_, i) => `partner-${i}`)]) {
      const h = harness();
      await expect(storeHeldAffiliateNotifications({ ...h.input, affiliateIds: ids })).rejects.toThrow(/Invalid/);
      expect(h.db.runTransaction).not.toHaveBeenCalled();
    }
    const h = harness();
    h.input.source.sourceId = 'sensitive@example.test';
    await expect(storeHeldAffiliateNotifications(h.input)).rejects.toThrow('Invalid partner notification planning input.');
    expect(h.db.runTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { eventType: 'new_release' }, { settingsRevision: -1 }, { settingsRevision: 0.5 },
    { dueAt: 'yesterday' }, { dueAt: '2026-10-23T08:59:59.999Z' },
    { extraPrivateField: 'must not be accepted' }, { affiliateId: 'partner-two' },
  ])('independently validates replay semantics even when stored hashes agree: %j', async patch => {
    const h = harness();
    h.input.affiliateIds.push('partner-two');
    await storeHeldAffiliateNotifications(h.input);
    const record = h.documents.get(intentPath(h)) as Record<string, unknown>;
    Object.assign(record, patch);
    const source = h.documents.get(sourcePath(h)) as { intentEvidence: Array<{ sha256: string }> };
    source.intentEvidence[0].sha256 = evidenceHash(record);
    const original = structuredClone([...h.documents]);
    await expect(storeHeldAffiliateNotifications(h.input)).rejects.toThrow(/no repair was attempted/);
    expect([...h.documents]).toEqual(original);
    expect(h.writes).toHaveLength(2);
  });

  it.each(['invalid', '2026-10-23T08:59:59.999Z', '2026-10-23T09:00:00.001Z'])('rejects inconsistent source creation chronology: %s', async createdAt => {
    const h = harness();
    await storeHeldAffiliateNotifications(h.input);
    const source = h.documents.get(sourcePath(h)) as { createdAt: string; intentEvidence: Array<{ sha256: string }> };
    const record = h.documents.get(intentPath(h)) as Record<string, unknown>;
    source.createdAt = createdAt;
    record.createdAt = createdAt;
    source.intentEvidence[0].sha256 = evidenceHash(record);
    await expect(storeHeldAffiliateNotifications(h.input)).rejects.toThrow(/no repair was attempted/);
    expect(h.writes).toHaveLength(2);
  });

  it('has no provider delivery path', async () => {
    const h = harness();
    const fetchSpy = vi.fn(() => { throw new Error('Unexpected provider request'); });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await storeHeldAffiliateNotifications(h.input);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
