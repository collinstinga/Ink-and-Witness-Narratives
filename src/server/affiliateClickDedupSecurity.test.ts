import { afterEach, describe, expect, it } from 'vitest';
import {
  AFFILIATE_CLICK_DEDUP_MAX_AGE_MS,
  createAffiliateClickDedupCookieValue,
  isMatchingAffiliateClickDedupCookie
} from './affiliateClickDedupSecurity.js';

const TEST_SECRET = 'affiliate-click-dedup-unit-test-secret-with-32-plus-characters';
const NOW = 1_800_000_000_000;

const originalEnvironment = {
  VERCEL: process.env.VERCEL,
  NODE_ENV: process.env.NODE_ENV,
  AFFILIATE_SESSION_SIGNING_SECRET: process.env.AFFILIATE_SESSION_SIGNING_SECRET,
  SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('affiliate click deduplication cookie security', () => {
  it('creates a signed token that matches the same normalized attribution', () => {
    const token = createAffiliateClickDedupCookieValue({
      ref: 'PARTNER_7',
      articleId: 'piece_42',
      campaign: 'Launch_2026'
    }, { now: NOW, signingSecret: TEST_SECRET });

    expect(token).toMatch(/^aff_click_v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
    expect(isMatchingAffiliateClickDedupCookie(token, {
      ref: 'partner_7',
      articleId: 'piece_42',
      campaign: 'launch_2026'
    }, { now: NOW, signingSecret: TEST_SECRET })).toBe(true);
  });

  it('rejects a token when the affiliate, article, or campaign does not match', () => {
    const token = createAffiliateClickDedupCookieValue({
      ref: 'partner_7',
      articleId: 'piece_42',
      campaign: 'launch_2026'
    }, { now: NOW, signingSecret: TEST_SECRET });

    expect(isMatchingAffiliateClickDedupCookie(token, {
      ref: 'other_partner', articleId: 'piece_42', campaign: 'launch_2026'
    }, { now: NOW, signingSecret: TEST_SECRET })).toBe(false);
    expect(isMatchingAffiliateClickDedupCookie(token, {
      ref: 'partner_7', articleId: 'piece_43', campaign: 'launch_2026'
    }, { now: NOW, signingSecret: TEST_SECRET })).toBe(false);
    expect(isMatchingAffiliateClickDedupCookie(token, {
      ref: 'partner_7', articleId: 'piece_42', campaign: 'different_campaign'
    }, { now: NOW, signingSecret: TEST_SECRET })).toBe(false);
  });

  it('rejects tampering and a different signing key', () => {
    const token = createAffiliateClickDedupCookieValue(
      { ref: 'partner_7' },
      { now: NOW, signingSecret: TEST_SECRET }
    )!;
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expect(isMatchingAffiliateClickDedupCookie(
      tampered,
      { ref: 'partner_7' },
      { now: NOW, signingSecret: TEST_SECRET }
    )).toBe(false);
    expect(isMatchingAffiliateClickDedupCookie(
      token,
      { ref: 'partner_7' },
      { now: NOW, signingSecret: `${TEST_SECRET}-different` }
    )).toBe(false);
  });

  it('accepts only the short validity window and rejects future-issued tokens', () => {
    const token = createAffiliateClickDedupCookieValue(
      { ref: 'partner_7' },
      { now: NOW, signingSecret: TEST_SECRET }
    );

    expect(isMatchingAffiliateClickDedupCookie(
      token,
      { ref: 'partner_7' },
      { now: NOW + AFFILIATE_CLICK_DEDUP_MAX_AGE_MS, signingSecret: TEST_SECRET }
    )).toBe(true);
    expect(isMatchingAffiliateClickDedupCookie(
      token,
      { ref: 'partner_7' },
      { now: NOW + AFFILIATE_CLICK_DEDUP_MAX_AGE_MS + 1, signingSecret: TEST_SECRET }
    )).toBe(false);

    const futureToken = createAffiliateClickDedupCookieValue(
      { ref: 'partner_7' },
      { now: NOW + 31_000, signingSecret: TEST_SECRET }
    );
    expect(isMatchingAffiliateClickDedupCookie(
      futureToken,
      { ref: 'partner_7' },
      { now: NOW, signingSecret: TEST_SECRET }
    )).toBe(false);
  });

  it('fails closed on Vercel when no server signing secret is configured', () => {
    process.env.VERCEL = '1';
    delete process.env.AFFILIATE_SESSION_SIGNING_SECRET;
    delete process.env.SESSION_SIGNING_SECRET;

    expect(createAffiliateClickDedupCookieValue({ ref: 'partner_7' }, { now: NOW })).toBeNull();
  });
});
