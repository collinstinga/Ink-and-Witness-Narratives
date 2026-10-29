import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AffiliatePartnerEmailComposer, { deliverPartnerEmail, partnerEmailSnapshot, validatePartnerEmail } from './AffiliatePartnerEmailComposer.js';
import type { AffiliatePartnerEmailCampaign, AffiliatePartnerEmailInput } from '../../types/affiliatePartnerEmail.js';

const input: AffiliatePartnerEmailInput = { subject: 'A circle update', body: 'A personal update for partners.', audience: 'all', affiliateIds: [] };
const campaign: AffiliatePartnerEmailCampaign = { ...input, id: 'synthetic-campaign', status: 'draft',
  eligibleCount: 9, sentCount: 0, failedCount: 0, createdAt: '2026-10-29T00:00:00.000Z' };

describe('simple manual partner email', () => {
  it('renders the basic compose flow without sending, loading automation or exposing credentials', () => {
    const service = { overview: vi.fn(), preview: vi.fn(), create: vi.fn(), send: vi.fn() };
    const html = renderToStaticMarkup(<AffiliatePartnerEmailComposer service={service} />);
    for (const label of ['Email your partners', 'All eligible partners', 'Choose individual partners', 'Subject',
      'Message', 'Preview recipients', 'Send partner email', 'Delivery history']) expect(html).toContain(label);
    expect(html).toContain('Reader newsletter subscribers are separate');
    expect(html).toMatch(/<label[^>]+for="partner-email-message"[^>]*>Message<\/label>/);
    expect(html).toMatch(/<textarea[^>]+id="partner-email-message"/);
    expect(html).toMatch(/<button[^>]+disabled[^>]*><svg[^]*?Send partner email/);
    expect(html).not.toMatch(/SecurityCredential|API_KEY|signed review|held intents|dispatch batch/);
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });

  it('requires bounded plain message fields and an explicitly selected audience', () => {
    expect(validatePartnerEmail(input)).toBeUndefined();
    expect(validatePartnerEmail({ ...input, subject: ' ' })).toMatch(/subject/);
    expect(validatePartnerEmail({ ...input, subject: 'X'.repeat(201) })).toMatch(/subject/);
    expect(validatePartnerEmail({ ...input, body: ' ' })).toMatch(/message/);
    expect(validatePartnerEmail({ ...input, body: 'X'.repeat(12001) })).toMatch(/message/);
    expect(validatePartnerEmail({ ...input, audience: 'selected' })).toMatch(/Select/);
  });

  it('invalidates preview snapshots on changed text or audience and canonicalizes selected identities', () => {
    expect(partnerEmailSnapshot({ ...input, subject: ` ${input.subject} `, affiliateIds: ['ignored'] })).toBe(partnerEmailSnapshot(input));
    expect(partnerEmailSnapshot({ ...input, body: 'Other message' })).not.toBe(partnerEmailSnapshot(input));
    expect(partnerEmailSnapshot({ ...input, audience: 'selected', affiliateIds: ['b', 'a', 'a'] }))
      .toBe(partnerEmailSnapshot({ ...input, audience: 'selected', affiliateIds: ['a', 'b'] }));
  });

  it('advances bounded batches under one explicit action and stops on completion', async () => {
    const send = vi.fn().mockResolvedValueOnce({ campaign: { ...campaign, sentCount: 5 }, complete: false })
      .mockResolvedValueOnce({ campaign: { ...campaign, status: 'sent', sentCount: 9 }, complete: true });
    const progress = vi.fn();
    const result = await deliverPartnerEmail(campaign, send, progress);
    expect(result.complete).toBe(true); expect(result.campaign.sentCount).toBe(9);
    expect(send.mock.calls).toEqual([[campaign.id], [campaign.id]]); expect(progress).toHaveBeenCalledTimes(2);
  });

  it('never retries an ambiguous send response', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Synthetic uncertain result'));
    await expect(deliverPartnerEmail(campaign, send, vi.fn())).rejects.toThrow('uncertain');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('pauses excessive batch loops and rejects a response from another campaign', async () => {
    const send = vi.fn().mockResolvedValue({ campaign, complete: false });
    expect((await deliverPartnerEmail(campaign, send, vi.fn())).complete).toBe(false);
    expect(send).toHaveBeenCalledTimes(10);
    await expect(deliverPartnerEmail(campaign, vi.fn().mockResolvedValue({ campaign: { ...campaign, id: 'wrong' }, complete: true }), vi.fn()))
      .rejects.toThrow('did not match');
  });
});
