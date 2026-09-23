import crypto from 'crypto';

const DEVELOPMENT_NEWSLETTER_SECRET = crypto.randomBytes(32).toString('hex');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_INTERESTS = 20;
const MAX_INTEREST_LENGTH = 80;

function resolveSigningSecret(
  value: unknown = process.env.NEWSLETTER_SIGNING_SECRET || process.env.SESSION_SIGNING_SECRET
): string | null {
  if (typeof value === 'string' && value.trim().length >= 32) return value.trim();
  return process.env.VERCEL ? null : DEVELOPMENT_NEWSLETTER_SECRET;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function normalizeNewsletterEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function newsletterEmailIndexId(normalizedEmail: string): string {
  return crypto.createHash('sha256').update(normalizedEmail).digest('hex');
}

export function sanitizeNewsletterInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const interests: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim().replace(/\s+/g, ' ').slice(0, MAX_INTEREST_LENGTH);
    const key = cleaned.toLocaleLowerCase('en');
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    interests.push(cleaned);
    if (interests.length >= MAX_INTERESTS) break;
  }
  return interests;
}

export function sanitizeSubscriberName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 120);
  return cleaned || undefined;
}

export function createNewsletterUnsubscribeToken(
  subscriberId: string,
  signingSecret?: string
): string {
  if (!/^sub_[A-Za-z0-9_-]{12,}$/.test(subscriberId)) {
    throw new Error('Invalid newsletter subscriber identifier.');
  }
  const secret = resolveSigningSecret(signingSecret);
  if (!secret) {
    throw new Error('NEWSLETTER_SIGNING_SECRET must contain at least 32 characters in production.');
  }
  const payload = `v1.${subscriberId}`;
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyNewsletterUnsubscribeToken(
  token: unknown,
  signingSecret?: string
): { subscriberId: string } | null {
  if (typeof token !== 'string' || token.length > 256) return null;
  const match = /^v1\.(sub_[A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{40,})$/.exec(token.trim());
  if (!match) return null;
  const secret = resolveSigningSecret(signingSecret);
  if (!secret) return null;

  const payload = `v1.${match[1]}`;
  const expected = Buffer.from(signPayload(payload, secret));
  const received = Buffer.from(match[2]);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  return { subscriberId: match[1] };
}

