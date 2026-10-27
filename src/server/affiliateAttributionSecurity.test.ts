import { describe, expect, it } from 'vitest';
import {
  AFFILIATE_ATTRIBUTION_MAX_AGE_MS,
  createAffiliateAttributionCookieValue,
  verifyAffiliateAttributionCookie
} from './affiliateAttributionSecurity.js';

const SECRET = 'affiliate-attribution-test-secret-that-is-long-enough';
const NOW = 1_800_000_000_000;

describe('signed affiliate payment attribution', () => {
  it('authenticates a complete prospective click source and rejects partial, stale or altered source metadata', () => {
    const source = { sourceClickEventId: `aclk2_${'a'.repeat(64)}`,
      sourceClickKeySha256: `ack1_${'A'.repeat(43)}`, sourceClickAt: new Date(NOW - 1_000).toISOString() };
    const token = createAffiliateAttributionCookieValue({ ref: 'partner_7', ...source }, { now: NOW, signingSecret: SECRET })!;
    expect(verifyAffiliateAttributionCookie(token, 'piece_42', { now: NOW, signingSecret: SECRET })).toMatchObject(source);
    expect(createAffiliateAttributionCookieValue({ ref: 'partner_7', sourceClickEventId: source.sourceClickEventId },
      { now: NOW, signingSecret: SECRET })).toBeNull();
    const stale = createAffiliateAttributionCookieValue({ ref: 'partner_7', ...source,
      sourceClickAt: new Date(NOW - 31 * 60_000).toISOString() }, { now: NOW, signingSecret: SECRET });
    expect(verifyAffiliateAttributionCookie(stale, 'piece_42', { now: NOW, signingSecret: SECRET })).toBeNull();
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    payload.e = `aclk2_${'b'.repeat(64)}`;
    const altered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;
    expect(verifyAffiliateAttributionCookie(altered, 'piece_42', { now: NOW, signingSecret: SECRET })).toBeNull();
  });
  it('returns a verified normalized attribution for its intended piece', () => {
    const token = createAffiliateAttributionCookieValue(
      { ref: 'Partner_7', campaign: 'Launch_2026', articleId: 'piece_42' },
      { now: NOW, signingSecret: SECRET }
    );
    expect(token).toMatch(/^aff_attr_v2\./);
    expect(verifyAffiliateAttributionCookie(token, 'piece_42', { now: NOW, signingSecret: SECRET }))
      .toEqual({
        ref: 'partner_7',
        campaign: 'launch_2026',
        articleId: 'piece_42',
        attributionId: expect.any(String),
        issuedAt: NOW,
        expiresAt: NOW + 30 * 24 * 60 * 60 * 1000
      });
  });

  it('rejects tampering, expiry, and use for another piece', () => {
    const token = createAffiliateAttributionCookieValue(
      { ref: 'partner_7', articleId: 'piece_42' },
      { now: NOW, signingSecret: SECRET }
    )!;
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    expect(verifyAffiliateAttributionCookie(tampered, 'piece_42', { now: NOW, signingSecret: SECRET })).toBeNull();
    expect(verifyAffiliateAttributionCookie(token, 'piece_43', { now: NOW, signingSecret: SECRET })).toBeNull();
    expect(verifyAffiliateAttributionCookie(token, 'piece_42', {
      now: NOW + AFFILIATE_ATTRIBUTION_MAX_AGE_MS + 1,
      signingSecret: SECRET
    })).toBeNull();
  });

  it('allows a homepage attribution to apply to a later piece purchase', () => {
    const token = createAffiliateAttributionCookieValue(
      { ref: 'partner_7', campaign: 'launch' },
      { now: NOW, signingSecret: SECRET }
    );
    expect(verifyAffiliateAttributionCookie(token, 'piece_99', { now: NOW, signingSecret: SECRET }))
      .toMatchObject({ ref: 'partner_7', campaign: 'launch' });
  });

  it('allows an explicitly trusted continuation purchase while retaining signed origin metadata', () => {
    const token = createAffiliateAttributionCookieValue(
      { ref: 'partner_7', campaign: 'launch', articleId: 'origin_piece' },
      { now: NOW, signingSecret: SECRET }
    );

    expect(verifyAffiliateAttributionCookie(token, 'next_piece', {
      now: NOW,
      signingSecret: SECRET,
      allowCrossArticle: true
    })).toEqual({
      ref: 'partner_7',
      campaign: 'launch',
      articleId: 'origin_piece',
      attributionId: expect.any(String),
      issuedAt: NOW,
      expiresAt: NOW + 30 * 24 * 60 * 60 * 1000
    });
  });

  it('cryptographically enforces a shorter configured attribution window', () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const token = createAffiliateAttributionCookieValue(
      { ref: 'partner_7' },
      { now: NOW, signingSecret: SECRET, maxAgeMs: sevenDays }
    );

    expect(verifyAffiliateAttributionCookie(token, 'piece_99', {
      now: NOW + sevenDays,
      signingSecret: SECRET
    })).toMatchObject({ expiresAt: NOW + sevenDays });
    expect(verifyAffiliateAttributionCookie(token, 'piece_99', {
      now: NOW + sevenDays + 1,
      signingSecret: SECRET
    })).toBeNull();
  });
});
