import { describe, expect, it } from 'vitest';
import type { AffiliateCampaign } from '../types.js';
import { buildAffiliateCampaignUpdate, campaignLocalTime, createAffiliateCampaignDraft } from './affiliateCampaignEditor.js';

const NOW = new Date('2026-10-23T10:00:00.000Z');
const stored: AffiliateCampaign = {
  id: 'legacy-campaign-id', code: 'READING', name: 'Reading Circle', commissionRate: 15, attributionDays: 30,
  eligiblePieceIds: ['unavailable-piece', 'piece-one'], startDate: '2026-10-01', endDate: '2026-12-01', isActive: true,
  clicksCount: 15, salesCount: 8, revenueKes: 4_000, commissionsKes: 600, createdAt: '2026-09-01T10:00:00.000Z', revision: 7,
};

describe('campaign editor payload', () => {
  it('sends editable fields and the exact revision without re-sending money, identity metadata or untouched dates', () => {
    const draft = createAffiliateCampaignDraft(stored, NOW);
    draft.name = 'New campaign title';
    const update = buildAffiliateCampaignUpdate(draft, stored);
    expect(update).toEqual({ id: stored.id, revision: 7, code: 'READING', name: draft.name, description: '', commissionRate: 15,
      attributionDays: 30, eligiblePieceIds: stored.eligiblePieceIds, isActive: true });
    expect(update.eligiblePieceIds).not.toBe(draft.eligiblePieceIds);
    expect(stored.name).toBe('Reading Circle');
    expect(stored.eligiblePieceIds).toEqual(['unavailable-piece', 'piece-one']);
  });

  it('starts legacy editing at revision zero and never changes the established campaign ID', () => {
    const legacy = { ...stored, revision: undefined };
    expect(buildAffiliateCampaignUpdate(createAffiliateCampaignDraft(legacy, NOW), legacy)).toMatchObject({ id: stored.id, revision: 0 });
  });

  it('creates a new campaign with canonical timestamps and no invented identity, totals or approval metadata', () => {
    const draft = createAffiliateCampaignDraft(undefined, NOW);
    draft.code = ' new_circle '; draft.name = ' New circle ';
    expect(buildAffiliateCampaignUpdate(draft)).toEqual({
      code: 'NEW_CIRCLE', name: 'New circle', description: '', commissionRate: 20, attributionDays: 30,
      startDate: NOW.toISOString(), endDate: '2026-11-22T10:00:00.000Z', isActive: true, eligiblePieceIds: [],
    });
  });

  it('converts edited device-local times back to UTC without losing milliseconds or a day at timezone boundaries', () => {
    const timestamp = '2026-10-23T23:58:41.125Z';
    const draft = createAffiliateCampaignDraft(stored, NOW);
    draft.startDate = campaignLocalTime(timestamp); draft.endDate = campaignLocalTime('2026-10-24T00:00:00.000Z');
    expect(buildAffiliateCampaignUpdate(draft, stored)).toMatchObject({ startDate: timestamp, endDate: '2026-10-24T00:00:00.000Z' });
  });

  it.each([
    { code: '_circle' }, { code: 'bad code' }, { code: 'a'.repeat(65) }, { name: '' }, { name: 'a'.repeat(121) },
    { description: 'a'.repeat(2001) }, { commissionRate: '0' }, { commissionRate: '101' }, { commissionRate: 'NaN' },
    { attributionDays: '0' }, { attributionDays: '91' }, { attributionDays: '1.5' },
    { startDate: 'tomorrow' }, { startDate: '2026-02-30T10:00:00' }, { endDate: '2020-01-01T00:00:00' },
  ])('rejects invalid edits: %j', patch => {
    expect(() => buildAffiliateCampaignUpdate({ ...createAffiliateCampaignDraft(stored, NOW), ...patch }, stored)).toThrow();
  });
});
