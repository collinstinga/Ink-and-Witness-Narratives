import type {
  AffiliateAccount,
  AffiliateCampaign,
  AffiliateSettings,
  AffiliateLiteraryCircleMembership,
  AffiliateSaleCommission,
  LiteraryCircleCommunityPost,
  LiteraryCircleCommunityPostType,
  LiteraryCircleCommissionPolicySnapshot,
  LiteraryCircleDashboardSummary,
  LiteraryCirclePerformancePeriod,
  LiteraryCircleSettings,
  LiteraryCircleTierDefinition
} from '../types.js';
import {
  LITERARY_CIRCLE_ONBOARDING_STEP_IDS,
  DEFAULT_LITERARY_CIRCLE_ONBOARDING_CONTENT,
  LiteraryCircleOnboardingValidationError,
  normalizeLiteraryCircleOnboardingContent,
  projectLiteraryCircleOnboardingContent,
  validateLiteraryCircleOnboardingContent
} from '../utils/literaryCircleOnboarding.js';

const SAFE_TIER_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const MAX_TIERS = 12;
const MAX_INTRODUCTORY_DAYS = 365;
const MAX_COMMUNITY_POSTS = 24;
const VERIFIED_COMMISSION_STATUSES = new Set(['PENDING', 'APPROVED', 'PAID']);
const SAFE_COMMUNITY_POST_ID = /^[a-z0-9](?:[a-z0-9_-]{0,94}[a-z0-9])?$/;
const SAFE_PUBLIC_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const COMMUNITY_POST_TYPES = new Set<LiteraryCircleCommunityPostType>([
  'announcement',
  'release_preview',
  'exclusive_excerpt',
  'monthly_campaign',
  'featured_piece',
  'promotional_guidance'
]);

export const LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID = 'affiliate_literary_circle';
export const LITERARY_CIRCLE_SCHEMA_VERSION = 1 as const;
export const LITERARY_CIRCLE_ONBOARDING_STEPS = LITERARY_CIRCLE_ONBOARDING_STEP_IDS;

export const DEFAULT_LITERARY_CIRCLE_SETTINGS: LiteraryCircleSettings = {
  schemaVersion: LITERARY_CIRCLE_SCHEMA_VERSION,
  revision: 0,
  enabled: true,
  defaultTierId: 'literary-partner',
  qualificationTimezone: 'Africa/Nairobi',
  introductoryPeriodDays: 30,
  onboardingVersion: 1,
  onboardingContent: DEFAULT_LITERARY_CIRCLE_ONBOARDING_CONTENT,
  tiers: [
    {
      id: 'literary-partner',
      name: 'Literary Partner',
      description: 'Approved Literary Circle membership with full catalogue access and referral tools.',
      rank: 1,
      monthlyVerifiedSalesThreshold: 0,
      proposedCommissionRate: 15,
      enabled: true,
      badgeLabel: 'Literary Partner'
    },
    {
      id: 'literary-ambassador',
      name: 'Literary Ambassador',
      description: 'Recognition for partners who generate at least 10 verified sales in a calendar month.',
      rank: 2,
      monthlyVerifiedSalesThreshold: 10,
      proposedCommissionRate: 20,
      enabled: true,
      badgeLabel: 'Literary Ambassador'
    },
    {
      id: 'literary-patron',
      name: 'Literary Patron',
      description: 'Premium recognition for partners who generate at least 30 verified sales in a calendar month.',
      rank: 3,
      monthlyVerifiedSalesThreshold: 30,
      proposedCommissionRate: 25,
      enabled: true,
      badgeLabel: 'Literary Patron'
    }
  ],
  commissionPolicy: {
    status: 'draft',
    version: 1,
    subscriptionRenewalsEligible: false
  },
  community: {
    enabled: false,
    title: 'The Ink & Witness Literary Circle',
    description: 'Private announcements, campaign notes, early previews and reading recommendations.',
    posts: []
  }
};

export class LiteraryCircleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiteraryCircleValidationError';
  }
}

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function finiteRate(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : fallback;
}

function safeText(value: unknown, fallback: string, maximum: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || fallback).slice(0, maximum);
}

function safeOptionalIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function safeWhatsappUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (hostname !== 'whatsapp.com' && hostname !== 'chat.whatsapp.com')) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 1_000) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeOptionalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maximum);
  return normalized || undefined;
}

function normalizeCommunityPosts(value: unknown): LiteraryCircleCommunityPost[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, LiteraryCircleCommunityPost>();
  for (const [index, rawValue] of value.slice(0, MAX_COMMUNITY_POSTS).entries()) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
    const raw = rawValue as Partial<LiteraryCircleCommunityPost>;
    const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
    const title = safeOptionalText(raw.title, 120);
    const body = safeOptionalText(raw.body, 2_000);
    if (!SAFE_COMMUNITY_POST_ID.test(id) || !title || !body) continue;
    const type = COMMUNITY_POST_TYPES.has(raw.type as LiteraryCircleCommunityPostType)
      ? raw.type as LiteraryCircleCommunityPostType
      : 'announcement';
    const publishedAt = safeOptionalIso(raw.publishedAt);
    const expiresAt = safeOptionalIso(raw.expiresAt);
    const pieceId = typeof raw.pieceId === 'string'
      && raw.pieceId.length <= 128
      && SAFE_PUBLIC_IDENTIFIER.test(raw.pieceId)
      ? raw.pieceId
      : undefined;
    byId.set(id, {
      id,
      type,
      title,
      body,
      isPublished: raw.isPublished === true,
      order: finiteInteger(raw.order, index, 0, 10_000),
      ...(publishedAt ? { publishedAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(pieceId ? { pieceId } : {}),
      ...(safeOptionalText(raw.ctaLabel, 80) ? { ctaLabel: safeOptionalText(raw.ctaLabel, 80) } : {}),
      ...(safeHttpsUrl(raw.ctaUrl) ? { ctaUrl: safeHttpsUrl(raw.ctaUrl) } : {})
    });
  }
  return [...byId.values()].sort((left, right) => (
    left.order - right.order
    || (Date.parse(right.publishedAt || '') || 0) - (Date.parse(left.publishedAt || '') || 0)
    || left.id.localeCompare(right.id)
  ));
}

function normalizeTier(value: unknown, fallback: LiteraryCircleTierDefinition): LiteraryCircleTierDefinition {
  const tier = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<LiteraryCircleTierDefinition>
    : {};
  const candidateId = typeof tier.id === 'string' ? tier.id.trim().toLowerCase() : '';
  return {
    id: SAFE_TIER_ID.test(candidateId) ? candidateId : fallback.id,
    name: safeText(tier.name, fallback.name, 80),
    description: safeText(tier.description, fallback.description, 300),
    rank: finiteInteger(tier.rank, fallback.rank, 1, 100),
    monthlyVerifiedSalesThreshold: finiteInteger(
      tier.monthlyVerifiedSalesThreshold,
      fallback.monthlyVerifiedSalesThreshold,
      0,
      1_000_000
    ),
    proposedCommissionRate: finiteRate(tier.proposedCommissionRate, fallback.proposedCommissionRate),
    enabled: typeof tier.enabled === 'boolean' ? tier.enabled : fallback.enabled,
    ...(safeText(tier.badgeLabel, fallback.badgeLabel || fallback.name, 80)
      ? { badgeLabel: safeText(tier.badgeLabel, fallback.badgeLabel || fallback.name, 80) }
      : {})
  };
}

function normalizeCommissionPolicyHistory(value: unknown): LiteraryCircleCommissionPolicySnapshot[] {
  if (!Array.isArray(value)) return [];
  const byVersion = new Map<number, LiteraryCircleCommissionPolicySnapshot>();
  for (const rawValue of value.slice(0, 256)) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
    const raw = rawValue as Partial<LiteraryCircleCommissionPolicySnapshot>;
    const effectiveAt = safeOptionalIso(raw.effectiveAt);
    if (!effectiveAt || !Array.isArray(raw.tiers) || raw.tiers.length < 1) continue;
    const tiers = raw.tiers.slice(0, MAX_TIERS).map((tier, index) => normalizeTier(
      tier,
      DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers[index]
        || DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers[0]
    ));
    const uniqueTiers = Array.from(new Map(tiers.map(tier => [tier.id, tier])).values())
      .sort((left, right) => left.rank - right.rank || left.monthlyVerifiedSalesThreshold - right.monthlyVerifiedSalesThreshold);
    const requestedDefaultTierId = typeof raw.defaultTierId === 'string'
      ? raw.defaultTierId.trim().toLowerCase()
      : '';
    const defaultTierId = uniqueTiers.some(tier => tier.id === requestedDefaultTierId && tier.enabled)
      ? requestedDefaultTierId
      : (uniqueTiers.find(tier => tier.enabled)?.id || DEFAULT_LITERARY_CIRCLE_SETTINGS.defaultTierId);
    const version = finiteInteger(raw.version, 1, 1, 1_000_000);
    byVersion.set(version, {
      version,
      status: raw.status === 'active' ? 'active' : 'draft',
      effectiveAt,
      defaultTierId,
      ...(safeOptionalIso(raw.qualificationEffectiveFrom)
        ? { qualificationEffectiveFrom: safeOptionalIso(raw.qualificationEffectiveFrom) }
        : {}),
      tiers: uniqueTiers,
      subscriptionRenewalsEligible: raw.subscriptionRenewalsEligible === true,
      confirmedAt: safeOptionalIso(raw.confirmedAt) || effectiveAt,
      confirmedBy: safeText(raw.confirmedBy, 'System', 120)
    });
  }
  return [...byVersion.values()].sort((left, right) => (
    left.version - right.version
    || Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt)
  ));
}

export function normalizeLiteraryCircleSettings(value: unknown): LiteraryCircleSettings {
  const settings = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<LiteraryCircleSettings>
    : {};
  const suppliedTiers = Array.isArray(settings.tiers) ? settings.tiers.slice(0, MAX_TIERS) : [];
  const fallbackById = new Map(DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers.map(tier => [tier.id, tier]));
  const tiers = suppliedTiers.length
    ? suppliedTiers.map((tier, index) => {
        const tierId = tier && typeof tier === 'object' && typeof tier.id === 'string'
          ? tier.id.trim().toLowerCase()
          : '';
        return normalizeTier(tier, fallbackById.get(tierId) || DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers[index] || {
          id: `literary-tier-${index + 1}`,
          name: `Literary Tier ${index + 1}`,
          description: 'Literary Circle membership tier.',
          rank: index + 1,
          monthlyVerifiedSalesThreshold: 0,
          proposedCommissionRate: DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers[0].proposedCommissionRate,
          enabled: true
        });
      })
    : DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers.map(tier => ({ ...tier }));

  const uniqueTiers = Array.from(new Map(tiers.map(tier => [tier.id, tier])).values())
    .sort((left, right) => left.rank - right.rank || left.monthlyVerifiedSalesThreshold - right.monthlyVerifiedSalesThreshold);
  const requestedDefaultTierId = typeof settings.defaultTierId === 'string'
    ? settings.defaultTierId.trim().toLowerCase()
    : '';
  const defaultTierId = uniqueTiers.some(tier => tier.id === requestedDefaultTierId && tier.enabled)
    ? requestedDefaultTierId
    : (uniqueTiers.find(tier => tier.enabled)?.id || DEFAULT_LITERARY_CIRCLE_SETTINGS.defaultTierId);
  const policy = settings.commissionPolicy && typeof settings.commissionPolicy === 'object'
    ? settings.commissionPolicy
    : DEFAULT_LITERARY_CIRCLE_SETTINGS.commissionPolicy;
  const community = settings.community && typeof settings.community === 'object'
    ? settings.community
    : DEFAULT_LITERARY_CIRCLE_SETTINGS.community;
  const effectiveAt = safeOptionalIso(policy.effectiveAt);
  const commissionPolicyHistory = normalizeCommissionPolicyHistory(settings.commissionPolicyHistory);

  return {
    schemaVersion: LITERARY_CIRCLE_SCHEMA_VERSION,
    revision: finiteInteger(settings.revision, 0, 0, Number.MAX_SAFE_INTEGER),
    enabled: typeof settings.enabled === 'boolean' ? settings.enabled : DEFAULT_LITERARY_CIRCLE_SETTINGS.enabled,
    defaultTierId,
    qualificationTimezone: 'Africa/Nairobi',
    ...(safeOptionalIso(settings.qualificationEffectiveFrom)
      ? { qualificationEffectiveFrom: safeOptionalIso(settings.qualificationEffectiveFrom) }
      : {}),
    introductoryPeriodDays: finiteInteger(
      settings.introductoryPeriodDays,
      DEFAULT_LITERARY_CIRCLE_SETTINGS.introductoryPeriodDays,
      0,
      MAX_INTRODUCTORY_DAYS
    ),
    onboardingVersion: finiteInteger(
      settings.onboardingVersion,
      DEFAULT_LITERARY_CIRCLE_SETTINGS.onboardingVersion,
      1,
      1_000_000
    ),
    onboardingContent: normalizeLiteraryCircleOnboardingContent(settings.onboardingContent),
    tiers: uniqueTiers,
    commissionPolicy: {
      status: policy.status === 'active' ? 'active' : 'draft',
      version: finiteInteger(policy.version, DEFAULT_LITERARY_CIRCLE_SETTINGS.commissionPolicy.version, 1, 1_000_000),
      ...(effectiveAt ? { effectiveAt } : {}),
      subscriptionRenewalsEligible: typeof policy.subscriptionRenewalsEligible === 'boolean'
        ? policy.subscriptionRenewalsEligible
        : DEFAULT_LITERARY_CIRCLE_SETTINGS.commissionPolicy.subscriptionRenewalsEligible
    },
    ...(commissionPolicyHistory.length ? { commissionPolicyHistory } : {}),
    community: {
      enabled: typeof community.enabled === 'boolean' ? community.enabled : DEFAULT_LITERARY_CIRCLE_SETTINGS.community.enabled,
      title: safeText(community.title, DEFAULT_LITERARY_CIRCLE_SETTINGS.community.title, 120),
      description: safeText(community.description, DEFAULT_LITERARY_CIRCLE_SETTINGS.community.description, 600),
      ...(safeWhatsappUrl(community.whatsappInviteUrl)
        ? { whatsappInviteUrl: safeWhatsappUrl(community.whatsappInviteUrl) }
        : {}),
      posts: normalizeCommunityPosts(community.posts)
    },
    ...(safeOptionalIso(settings.updatedAt) ? { updatedAt: safeOptionalIso(settings.updatedAt) } : {}),
    ...(safeText(settings.updatedBy, '', 120) ? { updatedBy: safeText(settings.updatedBy, '', 120) } : {})
  };
}

export function literaryCircleCommissionPolicyFingerprint(value: unknown): string {
  const settings = normalizeLiteraryCircleSettings(value);
  return JSON.stringify({
    defaultTierId: settings.defaultTierId,
    qualificationEffectiveFrom: settings.qualificationEffectiveFrom || null,
    tiers: settings.tiers.map(tier => ({
      id: tier.id,
      rank: tier.rank,
      monthlyVerifiedSalesThreshold: tier.monthlyVerifiedSalesThreshold,
      proposedCommissionRate: tier.proposedCommissionRate,
      enabled: tier.enabled
    })),
    status: settings.commissionPolicy.status,
    effectiveAt: settings.commissionPolicy.effectiveAt || null,
    subscriptionRenewalsEligible: settings.commissionPolicy.subscriptionRenewalsEligible
  });
}

export function isLiteraryCircleCommissionPolicyChange(
  current: unknown,
  requested: unknown
): boolean {
  return literaryCircleCommissionPolicyFingerprint(current)
    !== literaryCircleCommissionPolicyFingerprint(requested);
}

export function createLiteraryCircleCommissionPolicySnapshot(
  settingsValue: unknown,
  options: { effectiveAt: string; confirmedAt: string; confirmedBy: string }
): LiteraryCircleCommissionPolicySnapshot {
  const settings = normalizeLiteraryCircleSettings(settingsValue);
  const effectiveAt = safeOptionalIso(options.effectiveAt);
  const confirmedAt = safeOptionalIso(options.confirmedAt);
  if (!effectiveAt || !confirmedAt) {
    throw new LiteraryCircleValidationError('Commission policy history requires valid effective and confirmation dates.');
  }
  return {
    version: settings.commissionPolicy.version,
    status: settings.commissionPolicy.status,
    effectiveAt,
    defaultTierId: settings.defaultTierId,
    ...(settings.qualificationEffectiveFrom
      ? { qualificationEffectiveFrom: settings.qualificationEffectiveFrom }
      : {}),
    tiers: settings.tiers.map(tier => ({ ...tier })),
    subscriptionRenewalsEligible: settings.commissionPolicy.subscriptionRenewalsEligible,
    confirmedAt,
    confirmedBy: safeText(options.confirmedBy, 'System', 120)
  };
}

export function resolveLiteraryCircleSettingsForTransaction(
  settingsValue: unknown,
  transactionAt: string
): LiteraryCircleSettings {
  const settings = normalizeLiteraryCircleSettings(settingsValue);
  const transactionTime = Date.parse(transactionAt);
  if (!Number.isFinite(transactionTime)) {
    return normalizeLiteraryCircleSettings({
      ...settings,
      commissionPolicy: {
        status: 'draft',
        version: settings.commissionPolicy.version,
        subscriptionRenewalsEligible: false
      }
    });
  }

  const history = [...(settings.commissionPolicyHistory || [])];
  const currentEffectiveAt = safeOptionalIso(settings.commissionPolicy.effectiveAt);
  if (
    currentEffectiveAt
    && !history.some(snapshot => snapshot.version === settings.commissionPolicy.version)
  ) {
    history.push(createLiteraryCircleCommissionPolicySnapshot(settings, {
      effectiveAt: currentEffectiveAt,
      confirmedAt: settings.updatedAt || currentEffectiveAt,
      confirmedBy: settings.updatedBy || 'System'
    }));
  }
  const selected = history
    .filter(snapshot => Date.parse(snapshot.effectiveAt) <= transactionTime)
    .sort((left, right) => (
      right.version - left.version
      || Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt)
    ))[0];
  if (!selected) {
    return normalizeLiteraryCircleSettings({
      ...settings,
      commissionPolicy: {
        status: 'draft',
        version: settings.commissionPolicy.version,
        subscriptionRenewalsEligible: false
      }
    });
  }
  return normalizeLiteraryCircleSettings({
    ...settings,
    defaultTierId: selected.defaultTierId,
    qualificationEffectiveFrom: selected.qualificationEffectiveFrom,
    tiers: selected.tiers,
    commissionPolicy: {
      status: selected.status,
      version: selected.version,
      effectiveAt: selected.effectiveAt,
      subscriptionRenewalsEligible: selected.subscriptionRenewalsEligible
    }
  });
}

export function validateLiteraryCircleSettings(value: unknown): LiteraryCircleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiteraryCircleValidationError('Literary Circle settings must be an object.');
  }
  const candidate = value as Partial<LiteraryCircleSettings>;
  if (Object.prototype.hasOwnProperty.call(candidate, 'onboardingContent')) {
    try {
      validateLiteraryCircleOnboardingContent(candidate.onboardingContent);
    } catch (error) {
      if (error instanceof LiteraryCircleOnboardingValidationError) throw new LiteraryCircleValidationError(error.message);
      throw error;
    }
  }
  if (!Array.isArray(candidate.tiers) || candidate.tiers.length < 1 || candidate.tiers.length > MAX_TIERS) {
    throw new LiteraryCircleValidationError(`Configure between 1 and ${MAX_TIERS} Literary Circle tiers.`);
  }
  const ids = new Set<string>();
  for (const [index, rawTier] of candidate.tiers.entries()) {
    if (!rawTier || typeof rawTier !== 'object') {
      throw new LiteraryCircleValidationError(`Tier ${index + 1} is invalid.`);
    }
    const id = typeof rawTier.id === 'string' ? rawTier.id.trim().toLowerCase() : '';
    if (!SAFE_TIER_ID.test(id)) throw new LiteraryCircleValidationError(`Tier ${index + 1} requires a stable identifier.`);
    if (ids.has(id)) throw new LiteraryCircleValidationError(`Tier identifier “${id}” is duplicated.`);
    ids.add(id);
    if (!Number.isSafeInteger(Number(rawTier.monthlyVerifiedSalesThreshold)) || Number(rawTier.monthlyVerifiedSalesThreshold) < 0) {
      throw new LiteraryCircleValidationError(`${rawTier.name || id} requires a non-negative whole-number sales threshold.`);
    }
    const rate = Number(rawTier.proposedCommissionRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
      throw new LiteraryCircleValidationError(`${rawTier.name || id} commission must be greater than 0 and at most 100 percent.`);
    }
  }
  const normalized = normalizeLiteraryCircleSettings(candidate);
  if (!normalized.tiers.some(tier => tier.id === normalized.defaultTierId && tier.enabled)) {
    throw new LiteraryCircleValidationError('The default tier must be enabled.');
  }
  if (!candidate.community || typeof candidate.community !== 'object' || Array.isArray(candidate.community)) {
    throw new LiteraryCircleValidationError('Literary Circle community settings must be provided as an object.');
  }
  if (candidate.commissionPolicy?.status === 'active' && !safeOptionalIso(candidate.commissionPolicy.effectiveAt)) {
    throw new LiteraryCircleValidationError('Activating tier commissions requires an effective date.');
  }
  if (
    candidate.community?.whatsappInviteUrl
    && !safeWhatsappUrl(candidate.community.whatsappInviteUrl)
  ) {
    throw new LiteraryCircleValidationError('Use a valid HTTPS WhatsApp invitation URL.');
  }
  if (candidate.community?.posts !== undefined) {
    if (!Array.isArray(candidate.community.posts) || candidate.community.posts.length > MAX_COMMUNITY_POSTS) {
      throw new LiteraryCircleValidationError(`Configure at most ${MAX_COMMUNITY_POSTS} private community posts.`);
    }
    const postIds = new Set<string>();
    for (const [index, rawPost] of candidate.community.posts.entries()) {
      if (!rawPost || typeof rawPost !== 'object') {
        throw new LiteraryCircleValidationError(`Community post ${index + 1} is invalid.`);
      }
      const id = typeof rawPost.id === 'string' ? rawPost.id.trim().toLowerCase() : '';
      if (!SAFE_COMMUNITY_POST_ID.test(id)) {
        throw new LiteraryCircleValidationError(`Community post ${index + 1} requires a stable identifier.`);
      }
      if (postIds.has(id)) throw new LiteraryCircleValidationError(`Community post identifier “${id}” is duplicated.`);
      postIds.add(id);
      if (!COMMUNITY_POST_TYPES.has(rawPost.type)) {
        throw new LiteraryCircleValidationError(`Community post ${index + 1} has an unsupported type.`);
      }
      if (!safeOptionalText(rawPost.title, 120) || !safeOptionalText(rawPost.body, 2_000)) {
        throw new LiteraryCircleValidationError(`Community post ${index + 1} requires a title and message.`);
      }
      if (rawPost.ctaUrl && !safeHttpsUrl(rawPost.ctaUrl)) {
        throw new LiteraryCircleValidationError(`Community post ${index + 1} requires a valid HTTPS action URL.`);
      }
      if (rawPost.pieceId && (
        rawPost.pieceId.length > 128
        || !SAFE_PUBLIC_IDENTIFIER.test(rawPost.pieceId)
      )) {
        throw new LiteraryCircleValidationError(`Community post ${index + 1} has an invalid piece identifier.`);
      }
      if (rawPost.publishedAt && !safeOptionalIso(rawPost.publishedAt)) {
        throw new LiteraryCircleValidationError(`Community post ${index + 1} has an invalid publish date.`);
      }
      if (rawPost.expiresAt && !safeOptionalIso(rawPost.expiresAt)) {
        throw new LiteraryCircleValidationError(`Community post ${index + 1} has an invalid expiry date.`);
      }
    }
  }
  return normalized;
}

export function projectLiteraryCircleCommunityForAffiliate(
  settingsValue: LiteraryCircleSettings,
  now = new Date().toISOString(),
): LiteraryCircleSettings['community'] {
  const settings = normalizeLiteraryCircleSettings(settingsValue);
  if (!settings.enabled || !settings.community.enabled) {
    return { enabled: false, title: '', description: '', posts: [] };
  }
  const parsedNow = Date.parse(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const posts = (settings.community.posts || [])
    .filter(post => post.isPublished)
    .filter(post => !post.publishedAt || Date.parse(post.publishedAt) <= nowMs)
    .filter(post => !post.expiresAt || Date.parse(post.expiresAt) > nowMs)
    .sort((left, right) => (
      left.order - right.order
      || (Date.parse(right.publishedAt || '') || 0) - (Date.parse(left.publishedAt || '') || 0)
      || left.id.localeCompare(right.id)
    ));
  return {
    ...settings.community,
    posts
  };
}

export function createLiteraryCircleMembership(options: {
  now?: string;
  settings?: LiteraryCircleSettings;
  foundingMember: boolean;
  audience: 'existing_upgrade' | 'new_affiliate';
  actor: string;
}): AffiliateLiteraryCircleMembership {
  const settings = normalizeLiteraryCircleSettings(options.settings);
  const now = safeOptionalIso(options.now) || new Date().toISOString();
  const introEndsAt = new Date(Date.parse(now) + settings.introductoryPeriodDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    schemaVersion: LITERARY_CIRCLE_SCHEMA_VERSION,
    memberSince: now,
    foundingMember: options.foundingMember,
    ...(options.foundingMember ? { foundingRecognizedAt: now } : {}),
    complimentaryAccess: {
      status: 'active',
      scope: 'all_published',
      grantedAt: now,
      updatedAt: now,
      updatedBy: options.actor
    },
    tier: {
      id: settings.defaultTierId,
      assignedAt: now,
      source: 'default',
      policyVersion: settings.commissionPolicy.version
    },
    onboarding: {
      version: settings.onboardingVersion,
      audience: options.audience,
      status: 'not_started',
      completedStepIds: [],
      welcomeRequired: true,
      introductoryPeriodEndsAt: introEndsAt
    }
  };
}

export function isAffiliateComplimentaryAccessActive(affiliate: AffiliateAccount | null | undefined): boolean {
  return Boolean(
    affiliate
    && affiliate.status === 'active'
    && affiliate.literaryCircle?.schemaVersion === LITERARY_CIRCLE_SCHEMA_VERSION
    && affiliate.literaryCircle.complimentaryAccess.status === 'active'
    && affiliate.literaryCircle.complimentaryAccess.scope === 'all_published'
  );
}

export function literaryCirclePeriodKey(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : '';
}

export function isVerifiedAffiliateCommission(commission: AffiliateSaleCommission): boolean {
  return VERIFIED_COMMISSION_STATUSES.has(commission.status);
}

export function countVerifiedSalesForPeriod(
  commissions: AffiliateSaleCommission[],
  periodKey: string,
  qualificationEffectiveFrom?: string
): number {
  const effectiveAt = qualificationEffectiveFrom ? Date.parse(qualificationEffectiveFrom) : Number.NEGATIVE_INFINITY;
  return commissions.filter(commission => {
    const createdAt = Date.parse(commission.createdAt);
    return isVerifiedAffiliateCommission(commission)
      && Number.isFinite(createdAt)
      && createdAt >= effectiveAt
      && literaryCirclePeriodKey(createdAt) === periodKey;
  }).length;
}

export function resolveLiteraryCircleTier(
  settingsValue: LiteraryCircleSettings,
  monthlyVerifiedSales: number
): LiteraryCircleTierDefinition {
  const settings = normalizeLiteraryCircleSettings(settingsValue);
  const enabled = settings.tiers.filter(tier => tier.enabled);
  const qualified = enabled
    .filter(tier => monthlyVerifiedSales >= tier.monthlyVerifiedSalesThreshold)
    .sort((left, right) => right.monthlyVerifiedSalesThreshold - left.monthlyVerifiedSalesThreshold || right.rank - left.rank);
  return qualified[0]
    || enabled.find(tier => tier.id === settings.defaultTierId)
    || enabled[0]
    || DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers[0];
}

function recentLiteraryCirclePeriodKeys(now: string, count: number): string[] {
  const current = literaryCirclePeriodKey(now);
  const match = /^(\d{4})-(\d{2})$/.exec(current);
  if (!match) return [];
  const keys: string[] = [];
  let year = Number(match[1]);
  let month = Number(match[2]);
  for (let index = 0; index < count; index += 1) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

function literaryCirclePeriodBounds(periodKey: string): { startsAt: string; endsAt: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2200 || month < 1 || month > 12) return null;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const startsAt = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+03:00`).toISOString();
  const nextStartsAtMs = Date.parse(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+03:00`);
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(nextStartsAtMs)) return null;
  return { startsAt, endsAt: new Date(nextStartsAtMs - 1).toISOString() };
}

function safeAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function buildLiteraryCirclePerformancePeriods(options: {
  commissions: AffiliateSaleCommission[];
  settings: LiteraryCircleSettings;
  now?: string;
  periodCount?: number;
}): LiteraryCirclePerformancePeriod[] {
  const now = safeOptionalIso(options.now) || new Date().toISOString();
  const periodCount = Math.min(24, Math.max(1, Math.trunc(Number(options.periodCount) || 6)));
  const currentPeriodKey = literaryCirclePeriodKey(now);
  const commissions = Array.isArray(options.commissions) ? options.commissions : [];
  const periodKeys = recentLiteraryCirclePeriodKeys(now, periodCount);
  const requestedPeriods = new Set(periodKeys);
  const commissionsByPeriod = new Map<string, AffiliateSaleCommission[]>();
  for (const commission of commissions) {
    if (!Number.isFinite(Date.parse(commission.createdAt))) continue;
    const periodKey = literaryCirclePeriodKey(commission.createdAt);
    if (!requestedPeriods.has(periodKey)) continue;
    const existing = commissionsByPeriod.get(periodKey);
    if (existing) existing.push(commission);
    else commissionsByPeriod.set(periodKey, [commission]);
  }

  return periodKeys.flatMap(periodKey => {
    const bounds = literaryCirclePeriodBounds(periodKey);
    if (!bounds) return [];
    const isCurrent = periodKey === currentPeriodKey;
    const referenceAt = isCurrent ? now : bounds.endsAt;
    const periodSettings = resolveLiteraryCircleSettingsForTransaction(options.settings, referenceAt);
    const periodCommissions = commissionsByPeriod.get(periodKey) || [];
    const verified = periodCommissions.filter(isVerifiedAffiliateCommission);
    const qualifyingSales = countVerifiedSalesForPeriod(
      verified,
      periodKey,
      periodSettings.qualificationEffectiveFrom,
    );
    const recordedTierIds = [...new Set(verified
      .map(commission => commission.literaryCircleTierId)
      .filter((value): value is string => typeof value === 'string' && Boolean(value)))]
      .sort((left, right) => left.localeCompare(right));
    const recordedPolicyVersions = [...new Set(verified
      .map(commission => commission.literaryCirclePolicyVersion)
      .filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0))]
      .sort((left, right) => left - right);
    const policyEffectiveAt = Date.parse(periodSettings.commissionPolicy.effectiveAt || '');
    const qualificationMode = periodSettings.commissionPolicy.status === 'active'
      && Number.isFinite(policyEffectiveAt)
      && policyEffectiveAt <= Date.parse(referenceAt)
      ? 'active' as const
      : 'projected' as const;

    return [{
      periodKey,
      startsAt: bounds.startsAt,
      endsAt: bounds.endsAt,
      isCurrent,
      verifiedSales: verified.length,
      qualifyingSales,
      grossSalesKes: verified.reduce((total, commission) => total + safeAmount(commission.saleAmountKes), 0),
      commissionEarnedKes: verified.reduce((total, commission) => total + safeAmount(commission.commissionAmountKes), 0),
      retainedRevenueKes: verified.reduce((total, commission) => total + safeAmount(commission.grossCreatorRevenueKes), 0),
      pieceSales: verified.filter(commission => !commission.purchaseKind || commission.purchaseKind === 'piece').length,
      bundleSales: verified.filter(commission => commission.purchaseKind === 'bundle').length,
      subscriptionSales: verified.filter(commission => commission.purchaseKind === 'subscription').length,
      reversedOrRejectedSales: periodCommissions.filter(commission => commission.status === 'REVERSED' || commission.status === 'REJECTED').length,
      qualifiedTier: resolveLiteraryCircleTier(periodSettings, qualifyingSales),
      qualificationMode,
      policyVersion: periodSettings.commissionPolicy.version,
      recordedTierIds,
      recordedPolicyVersions,
    }];
  });
}

export function shouldApplyLiteraryCircleCommissionPolicy(
  settingsValue: LiteraryCircleSettings,
  transactionAt: string
): boolean {
  const settings = resolveLiteraryCircleSettingsForTransaction(settingsValue, transactionAt);
  const effectiveAt = Date.parse(settings.commissionPolicy.effectiveAt || '');
  const transactionTime = Date.parse(transactionAt);
  return settings.commissionPolicy.status === 'active'
    && Number.isFinite(effectiveAt)
    && Number.isFinite(transactionTime)
    && transactionTime >= effectiveAt;
}

export interface LiteraryCircleCommissionRateResolution {
  rate: number;
  source: 'campaign' | 'piece_override' | 'affiliate_override' | 'literary_circle_tier' | 'global_default';
  literaryCircleTierId?: string;
  literaryCirclePolicyVersion?: number;
}

export function resolveAffiliateCommissionRate(options: {
  affiliate: AffiliateAccount;
  articleId: string;
  affiliateSettings: AffiliateSettings;
  campaign?: AffiliateCampaign;
  literaryCircleSettings?: LiteraryCircleSettings;
  monthlyVerifiedSales?: number;
  transactionAt: string;
}): LiteraryCircleCommissionRateResolution {
  const { affiliate, articleId, affiliateSettings, campaign } = options;
  if (
    campaign?.isActive
    && Number.isFinite(campaign.commissionRate)
    && campaign.commissionRate > 0
    && campaign.commissionRate <= 100
    && (!campaign.eligiblePieceIds?.length || campaign.eligiblePieceIds.includes(articleId))
  ) {
    return { rate: campaign.commissionRate, source: 'campaign' };
  }

  const pieceRate = Number(affiliateSettings.pieceCommissionOverrides?.[articleId]);
  if (Number.isFinite(pieceRate) && pieceRate > 0 && pieceRate <= 100) {
    return { rate: pieceRate, source: 'piece_override' };
  }

  const affiliateRate = Number(affiliate.customCommissionRate);
  if (Number.isFinite(affiliateRate) && affiliateRate > 0 && affiliateRate <= 100) {
    return { rate: affiliateRate, source: 'affiliate_override' };
  }

  if (
    affiliate.literaryCircle
    && options.literaryCircleSettings
    && shouldApplyLiteraryCircleCommissionPolicy(options.literaryCircleSettings, options.transactionAt)
  ) {
    const settings = resolveLiteraryCircleSettingsForTransaction(
      options.literaryCircleSettings,
      options.transactionAt
    );
    const manualTier = affiliate.literaryCircle.tier.source === 'manual'
      ? settings.tiers.find(tier => tier.enabled && tier.id === affiliate.literaryCircle?.tier.id)
      : undefined;
    const tier = manualTier || resolveLiteraryCircleTier(settings, options.monthlyVerifiedSales || 0);
    if (tier && Number.isFinite(tier.proposedCommissionRate) && tier.proposedCommissionRate > 0) {
      return {
        rate: tier.proposedCommissionRate,
        source: 'literary_circle_tier',
        literaryCircleTierId: tier.id,
        literaryCirclePolicyVersion: settings.commissionPolicy.version
      };
    }
  }

  return {
    rate: affiliateSettings.defaultCommissionRate || 15,
    source: 'global_default'
  };
}

export function buildLiteraryCircleDashboardSummary(options: {
  affiliate: AffiliateAccount;
  commissions: AffiliateSaleCommission[];
  settings: LiteraryCircleSettings;
  now?: string;
  publishedPieceIds?: readonly string[];
}): LiteraryCircleDashboardSummary {
  const settings = normalizeLiteraryCircleSettings(options.settings);
  const now = safeOptionalIso(options.now) || new Date().toISOString();
  const periodKey = literaryCirclePeriodKey(now);
  const verified = options.commissions.filter(isVerifiedAffiliateCommission);
  const performancePeriods = buildLiteraryCirclePerformancePeriods({
    commissions: options.commissions,
    settings,
    now,
    periodCount: 6,
  });
  const monthlyVerifiedSales = performancePeriods.find(period => period.periodKey === periodKey)?.qualifyingSales
    ?? countVerifiedSalesForPeriod(verified, periodKey, settings.qualificationEffectiveFrom);
  const calculatedTier = resolveLiteraryCircleTier(settings, monthlyVerifiedSales);
  const manuallyAssignedTier = options.affiliate.literaryCircle?.tier.source === 'manual'
    ? settings.tiers.find(tier => tier.enabled && tier.id === options.affiliate.literaryCircle?.tier.id)
    : undefined;
  const currentTier = manuallyAssignedTier || calculatedTier;
  const nextTier = settings.tiers
    .filter(tier => tier.enabled && tier.monthlyVerifiedSalesThreshold > currentTier.monthlyVerifiedSalesThreshold)
    .sort((left, right) => left.monthlyVerifiedSalesThreshold - right.monthlyVerifiedSalesThreshold)[0];
  const salesToNextTier = nextTier
    ? Math.max(0, nextTier.monthlyVerifiedSalesThreshold - monthlyVerifiedSales)
    : 0;
  const progressToNextTierPercent = nextTier
    ? Math.min(100, Math.round((monthlyVerifiedSales / Math.max(1, nextTier.monthlyVerifiedSalesThreshold)) * 100))
    : 100;
  const membership = options.affiliate.literaryCircle || (() => {
    const pendingMigration = createLiteraryCircleMembership({
      now: options.affiliate.createdAt,
      settings,
      foundingMember: false,
      audience: 'existing_upgrade',
      actor: 'migration-required'
    });
    return {
      ...pendingMigration,
      complimentaryAccess: {
        ...pendingMigration.complimentaryAccess,
        status: 'revoked' as const,
        reason: 'Literary Circle membership migration is required.'
      }
    };
  })();
  const introEnd = Date.parse(membership.onboarding.introductoryPeriodEndsAt || '');

  return {
    enabled: settings.enabled,
    foundingMember: membership.foundingMember,
    complimentaryAccessStatus: membership.complimentaryAccess.status,
    currentTier,
    ...(nextTier ? { nextTier } : {}),
    monthlyVerifiedSales,
    lifetimeVerifiedSales: verified.length,
    progressToNextTierPercent,
    salesToNextTier,
    onboarding: membership.onboarding,
    ...(settings.enabled ? {
      onboardingContent: projectLiteraryCircleOnboardingContent(settings.onboardingContent, options.publishedPieceIds)
    } : {}),
    introductoryPeriodActive: Number.isFinite(introEnd) && Date.parse(now) <= introEnd,
    commissionPolicyStatus: settings.commissionPolicy.status,
    community: projectLiteraryCircleCommunityForAffiliate(settings, now),
    performancePeriods,
  };
}
