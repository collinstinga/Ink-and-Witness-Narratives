import crypto from 'crypto';

const DEVELOPMENT_AFFILIATE_NOTIFICATION_SECRET = crypto.randomBytes(32).toString('hex');
const SAFE_AFFILIATE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;

function resolveSigningSecret(
  value: unknown = process.env.AFFILIATE_NOTIFICATION_SIGNING_SECRET
    || process.env.NEWSLETTER_SIGNING_SECRET
    || process.env.SESSION_SIGNING_SECRET,
): string | null {
  if (typeof value === 'string' && value.trim().length >= 32) return value.trim();
  return process.env.VERCEL ? null : DEVELOPMENT_AFFILIATE_NOTIFICATION_SECRET;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createAffiliateMarketingOptOutToken(
  affiliateIdValue: unknown,
  signingSecret?: string,
): string {
  const affiliateId = typeof affiliateIdValue === 'string' ? affiliateIdValue.trim() : '';
  if (!SAFE_AFFILIATE_ID.test(affiliateId)) throw new Error('Invalid affiliate identifier.');
  const secret = resolveSigningSecret(signingSecret);
  if (!secret) {
    throw new Error('AFFILIATE_NOTIFICATION_SIGNING_SECRET must contain at least 32 characters in production.');
  }
  const payload = `v1.marketing.${affiliateId}`;
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyAffiliateMarketingOptOutToken(
  token: unknown,
  signingSecret?: string,
): { affiliateId: string } | null {
  if (typeof token !== 'string' || token.length > 320) return null;
  const match = /^v1\.marketing\.([A-Za-z0-9][A-Za-z0-9_-]{0,159})\.([A-Za-z0-9_-]{40,})$/.exec(token.trim());
  if (!match) return null;
  const secret = resolveSigningSecret(signingSecret);
  if (!secret) return null;

  const payload = `v1.marketing.${match[1]}`;
  const expected = Buffer.from(signPayload(payload, secret));
  const received = Buffer.from(match[2]);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  return { affiliateId: match[1] };
}
