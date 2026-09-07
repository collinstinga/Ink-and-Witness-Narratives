import crypto from 'crypto';

export const AFFILIATE_CLICK_DEDUP_COOKIE_NAME = 'iw_affiliate_click_dedup';
export const AFFILIATE_CLICK_DEDUP_MAX_AGE_MS = 2 * 60 * 1000;

const TOKEN_PREFIX = 'aff_click_v1';
const MAX_TOKEN_LENGTH = 1024;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const DEVELOPMENT_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

export interface AffiliateClickAttribution {
  ref: string;
  articleId?: string;
  campaign?: string;
}

interface SignedAffiliateClickPayload {
  v: 1;
  r: string;
  a?: string;
  c?: string;
  iat: number;
}

interface AffiliateClickTokenOptions {
  now?: number;
  signingSecret?: string;
}

function resolveSigningSecret(explicitSecret?: unknown): string | null {
  const hasExplicitSecret = explicitSecret !== undefined;
  const candidate = hasExplicitSecret
    ? explicitSecret
    : process.env.AFFILIATE_SESSION_SIGNING_SECRET ?? process.env.SESSION_SIGNING_SECRET;
  if (typeof candidate === 'string' && candidate.trim().length >= 32) {
    return candidate.trim();
  }

  if (hasExplicitSecret) return null;

  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    return null;
  }

  return DEVELOPMENT_SIGNING_SECRET;
}

function normalizeAttribution(value: AffiliateClickAttribution): AffiliateClickAttribution | null {
  if (!value || typeof value.ref !== 'string') return null;

  const ref = value.ref.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(ref)) return null;

  const rawArticleId = typeof value.articleId === 'string' ? value.articleId.trim() : '';
  if (rawArticleId && (
    rawArticleId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(rawArticleId)
  )) {
    return null;
  }

  const rawCampaign = typeof value.campaign === 'string' ? value.campaign.trim().toLowerCase() : '';
  if (rawCampaign && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(rawCampaign)) {
    return null;
  }

  return {
    ref,
    articleId: rawArticleId || undefined,
    campaign: rawCampaign || undefined
  };
}

function signEncodedPayload(encodedPayload: string, signingSecret: string): string {
  return crypto
    .createHmac('sha256', signingSecret)
    .update(`${TOKEN_PREFIX}:${encodedPayload}`, 'utf8')
    .digest('hex');
}

function signaturesMatch(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function createAffiliateClickDedupCookieValue(
  attribution: AffiliateClickAttribution,
  options: AffiliateClickTokenOptions = {}
): string | null {
  const normalized = normalizeAttribution(attribution);
  const signingSecret = resolveSigningSecret(options.signingSecret);
  if (!normalized || !signingSecret) return null;

  const payload: SignedAffiliateClickPayload = {
    v: 1,
    r: normalized.ref,
    a: normalized.articleId,
    c: normalized.campaign,
    iat: options.now ?? Date.now()
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signEncodedPayload(encodedPayload, signingSecret);
  return `${TOKEN_PREFIX}.${encodedPayload}.${signature}`;
}

export function isMatchingAffiliateClickDedupCookie(
  cookieValue: unknown,
  attribution: AffiliateClickAttribution,
  options: AffiliateClickTokenOptions = {}
): boolean {
  if (typeof cookieValue !== 'string' || cookieValue.length > MAX_TOKEN_LENGTH) return false;

  const normalized = normalizeAttribution(attribution);
  const signingSecret = resolveSigningSecret(options.signingSecret);
  if (!normalized || !signingSecret) return false;

  const parts = cookieValue.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/.test(parts[2])) return false;

  const expectedSignature = signEncodedPayload(parts[1], signingSecret);
  if (!signaturesMatch(expectedSignature, parts[2])) return false;

  let payload: SignedAffiliateClickPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as SignedAffiliateClickPayload;
  } catch {
    return false;
  }

  const now = options.now ?? Date.now();
  if (
    payload.v !== 1 ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > now + MAX_CLOCK_SKEW_MS ||
    now - payload.iat > AFFILIATE_CLICK_DEDUP_MAX_AGE_MS
  ) {
    return false;
  }

  return payload.r === normalized.ref &&
    payload.a === normalized.articleId &&
    payload.c === normalized.campaign;
}
