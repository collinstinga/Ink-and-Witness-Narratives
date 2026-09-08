import crypto from 'crypto';

export const AFFILIATE_ATTRIBUTION_COOKIE_NAME = 'iw_affiliate_attribution';
export const AFFILIATE_ATTRIBUTION_DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const AFFILIATE_ATTRIBUTION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const TOKEN_PREFIX = 'aff_attr_v1';
const MAX_TOKEN_LENGTH = 1024;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const DEVELOPMENT_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

export interface AffiliateAttribution {
  ref: string;
  campaign?: string;
  articleId?: string;
}

export interface VerifiedAffiliateAttribution extends AffiliateAttribution {
  issuedAt: number;
  expiresAt: number;
}

type AttributionPayload = {
  v: 1;
  r: string;
  c?: string;
  a?: string;
  iat: number;
  exp: number;
};

type AttributionOptions = { now?: number; signingSecret?: string; maxAgeMs?: number };

function resolveSigningSecret(explicitSecret?: unknown): string | null {
  const hasExplicitSecret = explicitSecret !== undefined;
  const candidate = hasExplicitSecret
    ? explicitSecret
    : process.env.AFFILIATE_SESSION_SIGNING_SECRET ?? process.env.SESSION_SIGNING_SECRET;
  if (typeof candidate === 'string' && candidate.trim().length >= 32) return candidate.trim();
  if (hasExplicitSecret || process.env.VERCEL || process.env.NODE_ENV === 'production') return null;
  return DEVELOPMENT_SIGNING_SECRET;
}

function normalize(value: AffiliateAttribution): AffiliateAttribution | null {
  if (!value || typeof value.ref !== 'string') return null;
  const ref = value.ref.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(ref)) return null;
  const campaign = typeof value.campaign === 'string' ? value.campaign.trim().toLowerCase() : '';
  if (campaign && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(campaign)) return null;
  const articleId = typeof value.articleId === 'string' ? value.articleId.trim() : '';
  if (articleId && (articleId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(articleId))) return null;
  return { ref, campaign: campaign || undefined, articleId: articleId || undefined };
}

function signature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${TOKEN_PREFIX}:${payload}`, 'utf8').digest('hex');
}

export function createAffiliateAttributionCookieValue(
  attribution: AffiliateAttribution,
  options: AttributionOptions = {}
): string | null {
  const normalized = normalize(attribution);
  const secret = resolveSigningSecret(options.signingSecret);
  if (!normalized || !secret) return null;
  const payload: AttributionPayload = {
    v: 1,
    r: normalized.ref,
    c: normalized.campaign,
    a: normalized.articleId,
    iat: options.now ?? Date.now(),
    exp: 0
  };
  const requestedMaxAge = Number(options.maxAgeMs ?? AFFILIATE_ATTRIBUTION_DEFAULT_MAX_AGE_MS);
  const maxAgeMs = Number.isFinite(requestedMaxAge)
    ? Math.max(1, Math.min(AFFILIATE_ATTRIBUTION_MAX_AGE_MS, Math.floor(requestedMaxAge)))
    : AFFILIATE_ATTRIBUTION_DEFAULT_MAX_AGE_MS;
  payload.exp = payload.iat + maxAgeMs;
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${TOKEN_PREFIX}.${encoded}.${signature(encoded, secret)}`;
}

export function verifyAffiliateAttributionCookie(
  cookieValue: unknown,
  articleId: string,
  options: AttributionOptions = {}
): VerifiedAffiliateAttribution | null {
  if (typeof cookieValue !== 'string' || cookieValue.length > MAX_TOKEN_LENGTH) return null;
  const secret = resolveSigningSecret(options.signingSecret);
  if (!secret) return null;
  const parts = cookieValue.split('.');
  if (
    parts.length !== 3 ||
    parts[0] !== TOKEN_PREFIX ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1]) ||
    !/^[a-f0-9]{64}$/.test(parts[2])
  ) return null;
  const expected = Buffer.from(signature(parts[1], secret), 'hex');
  const supplied = Buffer.from(parts[2], 'hex');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;

  let payload: AttributionPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as AttributionPayload;
  } catch {
    return null;
  }
  const normalized = normalize({ ref: payload.r, campaign: payload.c, articleId: payload.a });
  const now = options.now ?? Date.now();
  if (
    !normalized ||
    payload.v !== 1 ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > now + MAX_CLOCK_SKEW_MS ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > AFFILIATE_ATTRIBUTION_MAX_AGE_MS ||
    now > payload.exp ||
    (normalized.articleId && normalized.articleId !== articleId)
  ) return null;
  return { ...normalized, issuedAt: payload.iat, expiresAt: payload.exp };
}
