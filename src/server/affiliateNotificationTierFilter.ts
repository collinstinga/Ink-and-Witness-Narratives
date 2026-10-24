import type { AffiliatePublicProfile } from '../types.js';

export const AUTOMATIC_AFFILIATE_NOTIFICATION_TIER_FILTER_UNSUPPORTED = 'automatic_tier_filter_requires_verified_evidence';
const SAFE_TIER = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalTime(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && new Date(parsed).toISOString() === value ? parsed : null;
}

/** No history scan, invented default tier, cache, account edit or financial
 * mutation. The caller must read these settings and affiliate snapshots fresh
 * in its planning/delivery transaction. Only explicit, effective manual
 * recognition is currently supported for general notification tier filters.
 * Verified committed tier_upgrade destinations have their own source proof.
 */
export function verifiedManualAffiliateNotificationTierIds(
  affiliates: AffiliatePublicProfile[],
  settings: unknown,
  now: string,
): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const nowMs = canonicalTime(now);
  if (nowMs === null || !Array.isArray(affiliates) || affiliates.length > 200
    || !record(settings) || settings.schemaVersion !== 1 || settings.enabled !== true
    || !Number.isSafeInteger(settings.revision) || settings.revision < 0
    || !Array.isArray(settings.tiers) || !settings.tiers.length || settings.tiers.length > 12) return result;
  const ids = new Set<string>();
  const enabled = new Set<string>();
  for (const tier of settings.tiers) {
    if (!record(tier) || typeof tier.id !== 'string' || !SAFE_TIER.test(tier.id)
      || ids.has(tier.id) || typeof tier.enabled !== 'boolean') return result;
    ids.add(tier.id);
    if (tier.enabled) enabled.add(tier.id);
  }
  const seen = new Set<string>();
  for (const affiliate of affiliates) {
    if (!affiliate || typeof affiliate.id !== 'string' || !SAFE_ID.test(affiliate.id) || seen.has(affiliate.id)) return Object.create(null);
    seen.add(affiliate.id);
    const membership = affiliate.literaryCircle;
    const tier = membership?.tier;
    const assignedAt = canonicalTime(tier?.assignedAt);
    if (membership?.schemaVersion !== 1 || tier?.source !== 'manual' || assignedAt === null || assignedAt > nowMs
      || !enabled.has(tier.id)) continue;
    result[affiliate.id] = tier.id;
  }
  return result;
}
