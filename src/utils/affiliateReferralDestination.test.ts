import { describe, expect, it } from 'vitest';

import {
  createAffiliateReferralUrl,
  getAffiliateReferralTrackingTargetFromSearchParams,
  HOME_AFFILIATE_REFERRAL_DESTINATION,
  normalizeAffiliateCampaign,
  parseAffiliateReferralDestination,
  serializeAffiliateReferralDestination,
  type AffiliateReferralDestination,
} from './affiliateReferralDestination.js';

describe('affiliate referral destinations', () => {
  it('builds a homepage link without an unnecessary query string', () => {
    expect(createAffiliateReferralUrl({
      origin: 'https://inkandwitness-narratives.co.ke',
      affiliateCode: 'INK-01',
    })).toBe('https://inkandwitness-narratives.co.ke/r/INK-01');
  });

  it.each<{
    destination: AffiliateReferralDestination;
    expectedQuery: string;
  }>([
    { destination: { type: 'piece', id: 'piece-1' }, expectedQuery: '?article=piece-1' },
    { destination: { type: 'collection', id: 'grief-and-grace' }, expectedQuery: '?collection=grief-and-grace' },
    { destination: { type: 'bundle', id: 'starter:bundle' }, expectedQuery: '?bundle=starter%3Abundle' },
    { destination: { type: 'subscription', id: 'reader-pass-3' }, expectedQuery: '?subscription=reader-pass-3' },
  ])('uses the canonical query key for $destination.type destinations', ({ destination, expectedQuery }) => {
    expect(createAffiliateReferralUrl({
      origin: 'https://inkandwitness-narratives.co.ke/',
      affiliateCode: 'LITERARY PARTNER',
      destination,
    })).toBe(`https://inkandwitness-narratives.co.ke/r/LITERARY%20PARTNER${expectedQuery}`);
  });

  it('normalizes a campaign to the server-safe form and keeps it alongside a destination', () => {
    expect(normalizeAffiliateCampaign(' -- WhatsApp Launch! 2026 ')).toBe('whatsapplaunch2026');
    expect(createAffiliateReferralUrl({
      origin: 'https://inkandwitness-narratives.co.ke',
      affiliateCode: 'partner-7',
      destination: { type: 'bundle', id: 'weekend' },
      campaign: ' -- WhatsApp Launch! 2026 ',
    })).toBe('https://inkandwitness-narratives.co.ke/r/partner-7?bundle=weekend&c=whatsapplaunch2026');
  });

  it('round-trips select values even when an identifier contains a colon', () => {
    const destination: AffiliateReferralDestination = { type: 'bundle', id: 'bundle:premium' };
    expect(parseAffiliateReferralDestination(serializeAffiliateReferralDestination(destination))).toEqual(destination);
  });

  it.each([
    ['article=piece-1', 'piece-1'],
    ['collection=grief-and-grace', 'collection:grief-and-grace'],
    ['bundle=starter-bundle', 'bundle:starter-bundle'],
    ['subscription=reader-pass-3', 'subscription:reader-pass-3'],
  ])('derives the redirect-compatible tracking target from %s', (query, expected) => {
    expect(getAffiliateReferralTrackingTargetFromSearchParams(new URLSearchParams(query))).toBe(expected);
  });

  it('fails ambiguous or unsafe client destination context closed to homepage tracking', () => {
    expect(getAffiliateReferralTrackingTargetFromSearchParams(
      new URLSearchParams('article=piece-1&bundle=starter-bundle'),
    )).toBeUndefined();
    expect(getAffiliateReferralTrackingTargetFromSearchParams(
      new URLSearchParams('bundle=../../writer'),
    )).toBeUndefined();
  });

  it('falls back safely when a select value is malformed', () => {
    expect(parseAffiliateReferralDestination('unknown:value')).toBe(HOME_AFFILIATE_REFERRAL_DESTINATION);
    expect(parseAffiliateReferralDestination('piece:')).toBe(HOME_AFFILIATE_REFERRAL_DESTINATION);
    expect(parseAffiliateReferralDestination('bundle:../../writer')).toBe(HOME_AFFILIATE_REFERRAL_DESTINATION);
    expect(createAffiliateReferralUrl({
      origin: 'https://inkandwitness-narratives.co.ke',
      affiliateCode: 'PARTNER_7',
      destination: { type: 'bundle', id: '../../writer' },
    })).toBe('https://inkandwitness-narratives.co.ke/r/PARTNER_7');
  });
});
