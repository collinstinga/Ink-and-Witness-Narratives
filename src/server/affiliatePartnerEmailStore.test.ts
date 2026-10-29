import { describe, expect, it, vi } from 'vitest';
import { AffiliatePartnerEmailStore, PARTNER_EMAIL_CAMPAIGNS, PARTNER_EMAIL_DELIVERIES,
  affiliatePartnerEmailConfiguration, reconcileAffiliatePartnerEmailWebhook, validateAffiliatePartnerEmailInput } from './affiliatePartnerEmailStore.js';
import { AFFILIATE_MARKETING_DISCLOSURE_VERSION } from './affiliateNotificationPreferences.js';
import { NewsletterProviderError } from './newsletterEmail.js';
import { newsletterEmailIndexId } from './newsletterSecurity.js';

vi.mock('./db.js', () => ({ getFirestoreClientTarget: (db: any) => db.target,
  getDb: vi.fn(), getFirestoreDoc: vi.fn(), sanitizeForFirestore: (value: unknown) => value }));
const NOW = Date.parse('2026-10-29T10:00:00.000Z');
const writer = 'writer@example.test';
const input = { subject: 'A letter to our partners', body: 'A new campaign is coming.\n\nRead and share with care.', audience: 'all', affiliateIds: [] };
type Ref = { path: string; id: string };
function harness(count = 1) {
  const documents = new Map<string, any>(), writes: string[] = [];
  const snapshot = (ref: Ref) => ({ ...ref, ref, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) });
  const query = (name: string, limit = 201, order?: string) => ({ name, limitValue: limit, order,
    limit: (n: number) => query(name, n, order), orderBy: (key: string) => query(name, limit, key),
    get: async () => {
      let refs = [...documents.keys()].filter(path => path.startsWith(`${name}/`) && path.split('/').length === 2)
        .map(path => ({ path, id: path.slice(name.length + 1) }));
      if (order) refs.sort((a, b) => String(documents.get(b.path)?.[order]).localeCompare(String(documents.get(a.path)?.[order])));
      return { docs: refs.slice(0, limit).map(snapshot) };
    },
    doc: (id: string): Ref => ({ path: `${name}/${id}`, id }),
  });
  let queue = Promise.resolve(), current = NOW, beforeCommit: (() => void) | undefined;
  const db = { target: { projectId: 'ink-and-witness-narratives', firestoreDatabaseId: '(default)' }, collection: (name: string) => query(name),
    runTransaction: async (callback: (tx: any) => Promise<any>) => {
      let release!: () => void;
      const previous = queue; queue = new Promise<void>(resolve => { release = resolve; }); await previous;
      const staged: Array<{ ref: Ref; value: any; update: boolean }> = [];
      const get = async (ref: any) => {
        if (staged.length) throw new Error('Firestore read after write');
        return ref.path ? snapshot(ref) : ref.get();
      };
      try {
        const result = await callback({ get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
          create: (ref: Ref, value: any) => { if (documents.has(ref.path)) throw new Error('already exists'); staged.push({ ref, value: structuredClone(value), update: false }); },
          update: (ref: Ref, value: any) => { if (!documents.has(ref.path)) throw new Error('missing update'); staged.push({ ref, value: structuredClone(value), update: true }); },
        });
        beforeCommit?.();
        for (const item of staged) { documents.set(item.ref.path, item.update ? { ...documents.get(item.ref.path), ...item.value } : item.value); writes.push(item.ref.path); }
        return result;
      } finally { release(); }
    },
  };
  const env: NodeJS.ProcessEnv = { VERCEL_ENV: 'production', RESEND_API_KEY: 'synthetic-provider-key', NEWSLETTER_FROM_EMAIL: 'Ink <ink@example.test>',
    RESEND_WEBHOOK_SECRET: 'synthetic-webhook', AFFILIATE_NOTIFICATION_SIGNING_SECRET: 's'.repeat(40),
    AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL: 'https://www.inkandwitness-narratives.co.ke' };
  let providerCounter = 0;
  const email = vi.fn(async (_value: any) => ({ providerMessageId: `synthetic-${++providerCounter}` }));
  for (let i = 0; i < count; i++) documents.set(`affiliates/partner-${i}`, { name: `Partner ${i}`, email: `partner${i}@example.test`,
    status: 'active', approvedAt: '2026-10-01T00:00:00.000Z', approvedBy: 'Writer', acceptedTerms: true,
    historicalWallet: { balance: 1234 }, passwordHash: 'PRIVATE_PASSWORD_HASH',
    notificationPreferences: { schemaVersion: 1, revision: 1, marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: '2026-10-01T00:00:00.000Z', allMarketingOptOut: false, campaignUpdates: true } });
  const store = new AffiliatePartnerEmailStore({ db: () => db as any, now: () => current, env: () => env, sendEmail: email });
  const create = (requestId = 'request_initial_123456') => store.create({ ...input, requestId }, writer);
  return { documents, writes, db, env, email, store, create, tick: (ms: number) => { current += ms; },
    failNextCommit: () => { beforeCommit = () => { beforeCommit = undefined; throw new Error('PRIVATE SDK FAILURE'); }; } };
}

describe('manual partner email eligibility and immutable campaigns', () => {
  it.each([undefined, null, [], { ...input, subject: 'a\r\nBcc: victim@example.test' }, { ...input, body: 'x'.repeat(12001) },
    { ...input, audience: 'selected' }, { ...input, affiliateIds: ['partner-one'] }, { ...input, role: 'admin' },
    { ...input, audience: 'selected', affiliateIds: ['bad/id'] }])('rejects malformed or authority-bearing input %j', value => {
    expect(() => validateAffiliatePartnerEmailInput(value)).toThrow();
  });
  it('keeps plain text literal while rejecting controls and normalizing selection', () => {
    expect(validateAffiliatePartnerEmailInput({ ...input, body: '<script>plain text</script>', audience: 'selected', affiliateIds: ['partner-b', 'partner-a', 'partner-a'] }))
      .toMatchObject({ body: '<script>plain text</script>', affiliateIds: ['partner-a', 'partner-b'] });
    expect(() => validateAffiliatePartnerEmailInput({ ...input, body: 'a\u0000b' })).toThrow();
  });
  it('preview and overview never create or send and never expose credentials, wallets or provider keys', async () => {
    const h = harness(), original = structuredClone(h.documents.get('affiliates/partner-0'));
    expect(await h.store.preview(input)).toEqual({ eligible: 1, excluded: 0, total: 1 });
    const overview = await h.store.overview();
    expect(overview).toMatchObject({ providerConfigured: true, campaigns: [], recipients: [{ id: 'partner-0', eligible: true }] });
    expect(JSON.stringify(overview)).not.toMatch(/PRIVATE|historicalWallet|provider-key|passwordHash/);
    expect(h.writes).toEqual([]); expect(h.email).not.toHaveBeenCalled(); expect(h.documents.get('affiliates/partner-0')).toEqual(original);
  });
  it.each([{ status: 'suspended' }, { approvedBy: '' }, { acceptedTerms: false }, { email: 'bad' }, { notificationPreferences: {} }])
    ('excludes unapproved/suspended/unconsented identities %j', async update => {
      const h = harness(); Object.assign(h.documents.get('affiliates/partner-0'), update);
      expect((await h.store.preview(input)).eligible).toBe(0);
      await expect(h.create()).rejects.toThrow(/No partners/); expect(h.writes).toEqual([]); expect(h.email).not.toHaveBeenCalled();
    });
  it('honors topic opt-out and shared bounce suppression while deduping recipient addresses', async () => {
    const h = harness(4);
    h.documents.get('affiliates/partner-1').email = 'PARTNER0@example.test';
    h.documents.get('affiliates/partner-2').notificationPreferences.campaignUpdates = false;
    h.documents.set(`affiliate_notification_deliveries/suppression_${newsletterEmailIndexId('partner3@example.test')}`, { kind: 'provider_suppression' });
    expect(await h.store.preview(input)).toEqual({ eligible: 1, excluded: 3, total: 4 });
    const created = await h.create(); expect(created).toMatchObject({ eligibleCount: 1, excludedCount: 3 });
  });
  it('creates idempotently, rejects changed content reuse and does not rewrite affiliate or financial records', async () => {
    const h = harness(2), previous = structuredClone([...h.documents.entries()]);
    const created = await h.create(), writes = h.writes.length;
    expect(await h.create()).toEqual(created); expect(h.writes).toHaveLength(writes);
    await expect(h.store.create({ ...input, subject: 'Changed', requestId: 'request_initial_123456' }, writer)).rejects.toThrow(/different content/);
    for (const [key, value] of previous) expect(h.documents.get(key)).toEqual(value);
    expect(h.writes.every(path => path.startsWith(`${PARTNER_EMAIL_CAMPAIGNS}/`) || path.startsWith(`${PARTNER_EMAIL_DELIVERIES}/`) || path.startsWith('affiliate_audit/'))).toBe(true);
    expect(h.email).not.toHaveBeenCalled();
  });
});

describe('manual partner email production fencing and delivery', () => {
  it.each(['preview', 'development', undefined])('never sends or creates on %j even with copied provider keys', async environment => {
    const h = harness(); h.env.VERCEL_ENV = environment;
    expect(affiliatePartnerEmailConfiguration(h.db as any, h.env)).toBeNull();
    await expect(h.create()).rejects.toThrow(/live website/); expect(h.writes).toEqual([]); expect(h.email).not.toHaveBeenCalled();
  });
  it.each(['ink-witness-staging-20261024', 'divine-experience-pq6d2'])('rejects a production-labeled wrong SDK database %s', async project => {
    const h = harness(); h.db.target.projectId = project;
    expect((await h.store.overview()).providerConfigured).toBe(false); await expect(h.create()).rejects.toThrow(); expect(h.email).not.toHaveBeenCalled();
  });
  it('blocks emulator, foreign base URL and absent signing/provider configuration', () => {
    const h = harness();
    for (const update of [{ FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL: 'https://evil.example.test' },
      { AFFILIATE_NOTIFICATION_SIGNING_SECRET: '' }, { RESEND_API_KEY: '' }]) expect(affiliatePartnerEmailConfiguration(h.db as any, { ...h.env, ...update })).toBeNull();
  });
  it('sends at most five per explicit step, freezes content and signs partner-specific opt-out', async () => {
    const h = harness(6), campaign = await h.create();
    const first = await h.store.send(campaign.id, writer);
    expect(first).toMatchObject({ complete: false, campaign: { status: 'paused', sentCount: 5, remainingCount: 1 } });
    expect(h.email).toHaveBeenCalledTimes(5);
    const message = h.email.mock.calls[0][0];
    expect(message).toMatchObject({ subject: input.subject, to: 'partner0@example.test' });
    expect(message.html).toContain('A new campaign is coming.');
    expect(message.unsubscribeUrl).toMatch(/^https:\/\/www\.inkandwitness-narratives\.co\.ke\/affiliate\/notifications\/unsubscribe\?token=v1\.marketing\.partner-0\./);
    expect(message.idempotencyKey).toMatch(/^manual-partner-email-nld_[a-f0-9]{48}$/);
    const final = await h.store.send(campaign.id, writer); expect(final).toMatchObject({ complete: true, campaign: { status: 'sent', sentCount: 6 } });
    expect(await h.store.send(campaign.id, writer)).toEqual(final); expect(h.email).toHaveBeenCalledTimes(6);
  });
  it('freshly excludes email changes, approval loss, opt-out and suppression after preparation', async () => {
    const h = harness(4), campaign = await h.create();
    h.documents.get('affiliates/partner-0').email = 'different@example.test';
    h.documents.get('affiliates/partner-1').approvedBy = '';
    h.documents.get('affiliates/partner-2').notificationPreferences.marketingConsent = 'denied';
    h.documents.set(`affiliate_notification_deliveries/suppression_${newsletterEmailIndexId('partner3@example.test')}`, { kind: 'provider_suppression' });
    expect(await h.store.send(campaign.id, writer)).toMatchObject({ complete: true, campaign: { sentCount: 0, excludedCount: 4, status: 'partially_sent' } });
    expect(h.email).not.toHaveBeenCalled();
  });
  it('durably serializes concurrent sends and never duplicates provider acceptance', async () => {
    const h = harness(), campaign = await h.create();
    let release!: () => void;
    h.email.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { providerMessageId: 'synthetic-accepted' }; });
    const first = h.store.send(campaign.id, writer);
    await vi.waitFor(() => expect(h.email).toHaveBeenCalledOnce());
    await expect(h.store.send(campaign.id, writer)).rejects.toThrow(/already being sent/);
    release(); await first; expect(h.email).toHaveBeenCalledOnce();
  });
  it.each([new Error('Private network timeout'), new NewsletterProviderError('Provider uncertain', 503)])
    ('records uncertain delivery terminally without resend even after provider idempotency expires', async error => {
      const h = harness(), campaign = await h.create(); h.email.mockRejectedValueOnce(error);
      const step = await h.store.send(campaign.id, writer);
      expect(step).toMatchObject({ complete: true, campaign: { sentCount: 0, uncertainCount: 1, status: 'partially_sent' } });
      h.tick(48 * 60 * 60 * 1000); await h.store.send(campaign.id, writer); expect(h.email).toHaveBeenCalledOnce();
    });
  it('does not retry explicit provider rejection and does not claim inbox delivery', async () => {
    const h = harness(), campaign = await h.create(); h.email.mockRejectedValueOnce(new NewsletterProviderError('Rejected', 422));
    expect(await h.store.send(campaign.id, writer)).toMatchObject({ complete: true, campaign: { failedCount: 1, sentCount: 0 } });
    await h.store.send(campaign.id, writer); expect(h.email).toHaveBeenCalledOnce();
  });
  it('treats a crashed dispatch as uncertain after lease expiration instead of charging ahead with a resend', async () => {
    const h = harness(), campaign = await h.create();
    const row = h.documents.get(`${PARTNER_EMAIL_CAMPAIGNS}/${campaign.id}`);
    row.leaseToken = 'expired'; row.leaseUntil = NOW - 1; row.status = 'sending';
    const delivery = [...h.documents.values()].find(value => value.kind === 'manual_partner_email'); delivery.status = 'dispatching';
    expect(await h.store.send(campaign.id, writer)).toMatchObject({ complete: true, campaign: { uncertainCount: 1, sentCount: 0 } });
    expect(h.email).not.toHaveBeenCalled();
  });
  it('rechecks runtime configuration before each recipient and never changes frozen campaign content', async () => {
    const h = harness(2), campaign = await h.create();
    h.email.mockImplementationOnce(async () => { h.env.NEWSLETTER_FROM_EMAIL = 'Changed <other@example.test>'; return { providerMessageId: 'accepted-before-change' }; });
    await expect(h.store.send(campaign.id, writer)).rejects.toThrow(/settings changed/);
    expect(h.email).toHaveBeenCalledOnce();
    const stored = h.documents.get(`${PARTNER_EMAIL_CAMPAIGNS}/${campaign.id}`); expect(stored).toMatchObject({ sentCount: 1, remainingCount: 1, status: 'paused' });
    stored.body = 'Corrupted content';
    await expect(h.store.send(campaign.id, writer)).rejects.toThrow(/not found/); expect(h.email).toHaveBeenCalledOnce();
  });
});

describe('signature-verified manual partner delivery outcomes', () => {
  it('records severe outcomes in shared suppression, preserves consent, and does not regress on late delivered events', async () => {
    const h = harness(), campaign = await h.create(); await h.store.send(campaign.id, writer);
    const delivery = [...h.documents.values()].find(value => value.kind === 'manual_partner_email');
    const hash = newsletterEmailIndexId('partner0@example.test');
    h.documents.set(`newsletter_email_index/${hash}`, { storageVersion: 1, emailHash: hash, subscriberId: 'sub_abcdefghijklmnop' });
    h.documents.set('newsletter_subscribers/sub_abcdefghijklmnop', { storageVersion: 1, emailIndexId: hash, status: 'active', consentVersion: 'PRESERVE' });
    const outcome = { deliveryId: delivery.id, providerMessageId: 'synthetic-1', status: 'complained' as const };
    expect(await reconcileAffiliatePartnerEmailWebhook({ db: h.db as any, outcome, eventId: 'verified-event' })).toBe(true);
    expect(h.documents.get(`affiliate_notification_deliveries/suppression_${hash}`)).toMatchObject({ reason: 'complained' });
    expect(h.documents.get('newsletter_subscribers/sub_abcdefghijklmnop')).toMatchObject({ status: 'suppressed', consentVersion: 'PRESERVE' });
    await reconcileAffiliatePartnerEmailWebhook({ db: h.db as any, outcome: { ...outcome, status: 'delivered' }, eventId: 'late-delivered' });
    expect(h.documents.get(`${PARTNER_EMAIL_DELIVERIES}/${delivery.id}`).outcome).toBe('complained');
    expect((await h.store.preview(input)).eligible).toBe(0);
  });
  it('repairs uncertainty only from a verified provider outcome and rejects another provider message identity', async () => {
    const h = harness(), campaign = await h.create(); h.email.mockRejectedValueOnce(new Error('Timeout')); await h.store.send(campaign.id, writer);
    const delivery = [...h.documents.values()].find(value => value.kind === 'manual_partner_email');
    const outcome = { deliveryId: delivery.id, providerMessageId: 'provider-confirmed', status: 'delivered' as const };
    expect(await reconcileAffiliatePartnerEmailWebhook({ db: h.db as any, outcome, eventId: 'delivered' })).toBe(true);
    expect((await h.store.overview()).campaigns[0]).toMatchObject({ sentCount: 1, uncertainCount: 0, status: 'sent' });
    expect(await reconcileAffiliatePartnerEmailWebhook({ db: h.db as any, outcome, eventId: 'delivered' })).toBe(true);
    expect((await h.store.overview()).campaigns[0]).toMatchObject({ sentCount: 1, uncertainCount: 0 });
    expect(await reconcileAffiliatePartnerEmailWebhook({ db: h.db as any, outcome: { ...outcome, providerMessageId: 'different' }, eventId: 'wrong-provider-id' })).toBe(false);
    expect(h.email).toHaveBeenCalledOnce();
  });
  it('preserves a verified webhook that races ahead of an ambiguous provider response', async () => {
    const h = harness(), campaign = await h.create();
    h.email.mockImplementationOnce(async (message: any) => {
      await reconcileAffiliatePartnerEmailWebhook({ db: h.db as any, outcome: { deliveryId: message.deliveryId,
        providerMessageId: 'verified-before-response', status: 'delivered' }, eventId: 'racing-event' });
      throw new Error('Response timed out after acceptance');
    });
    expect(await h.store.send(campaign.id, writer)).toMatchObject({ complete: true, campaign: { sentCount: 1, uncertainCount: 0, status: 'sent' } });
    const delivery = [...h.documents.values()].find(value => value.kind === 'manual_partner_email');
    expect(delivery).toMatchObject({ status: 'accepted', providerMessageId: 'verified-before-response', outcome: 'delivered' });
    await h.store.send(campaign.id, writer); expect(h.email).toHaveBeenCalledOnce();
  });
});
