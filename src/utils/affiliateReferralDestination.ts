export type AffiliateReferralDestination =
  | { type: 'home' }
  | { type: 'piece'; id: string }
  | { type: 'collection'; id: string }
  | { type: 'bundle'; id: string }
  | { type: 'subscription'; id: string };

export const HOME_AFFILIATE_REFERRAL_DESTINATION: AffiliateReferralDestination = {
  type: 'home',
};

const DESTINATION_QUERY_KEYS: Record<Exclude<AffiliateReferralDestination['type'], 'home'>, string> = {
  piece: 'article',
  collection: 'collection',
  bundle: 'bundle',
  subscription: 'subscription',
};

const DESTINATION_TRACKING_PREFIXES: Record<Exclude<AffiliateReferralDestination['type'], 'home'>, string> = {
  piece: '',
  collection: 'collection:',
  bundle: 'bundle:',
  subscription: 'subscription:',
};

const SELECT_DESTINATION_TYPES = new Set<AffiliateReferralDestination['type']>([
  'piece',
  'collection',
  'bundle',
  'subscription',
]);

const SAFE_DESTINATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function isSafeDestinationId(
  type: Exclude<AffiliateReferralDestination['type'], 'home'>,
  id: string,
): boolean {
  const value = id.trim();
  return value.length > 0
    && value.length <= 128 - DESTINATION_TRACKING_PREFIXES[type].length
    && SAFE_DESTINATION_ID.test(value);
}

export function getAffiliateReferralTrackingTargetFromSearchParams(
  params: URLSearchParams,
): string | undefined {
  const definitions = [
    { queryKey: 'article', prefix: '' },
    { queryKey: 'collection', prefix: 'collection:' },
    { queryKey: 'bundle', prefix: 'bundle:' },
    { queryKey: 'subscription', prefix: 'subscription:' },
  ] as const;
  const candidates = definitions.flatMap(({ queryKey, prefix }) => {
    const value = (params.get(queryKey) || '').trim();
    const maxIdLength = 128 - prefix.length;
    return value && value.length <= maxIdLength && SAFE_DESTINATION_ID.test(value)
      ? [`${prefix}${value}`]
      : [];
  });

  return candidates.length === 1 ? candidates[0] : undefined;
}

export function serializeAffiliateReferralDestination(destination: AffiliateReferralDestination): string {
  return destination.type === 'home'
    ? 'home'
    : `${destination.type}:${destination.id}`;
}

export function parseAffiliateReferralDestination(value: string): AffiliateReferralDestination {
  if (!value || value === 'home') return HOME_AFFILIATE_REFERRAL_DESTINATION;

  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) return HOME_AFFILIATE_REFERRAL_DESTINATION;

  const type = value.slice(0, separatorIndex) as AffiliateReferralDestination['type'];
  const id = value.slice(separatorIndex + 1).trim();
  if (
    !SELECT_DESTINATION_TYPES.has(type)
    || !id
    || !isSafeDestinationId(type as Exclude<AffiliateReferralDestination['type'], 'home'>, id)
  ) {
    return HOME_AFFILIATE_REFERRAL_DESTINATION;
  }

  return { type, id } as AffiliateReferralDestination;
}

export function normalizeAffiliateCampaign(value?: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[_-]+/, '')
    .slice(0, 64);
}

export function createAffiliateReferralUrl(input: {
  origin: string;
  affiliateCode: string;
  destination?: AffiliateReferralDestination;
  campaign?: string;
}): string {
  const destination = input.destination || HOME_AFFILIATE_REFERRAL_DESTINATION;
  const affiliateCode = input.affiliateCode.trim() || 'partner';
  const url = new URL(`/r/${encodeURIComponent(affiliateCode)}`, input.origin);

  if (destination.type !== 'home') {
    const id = destination.id.trim();
    if (isSafeDestinationId(destination.type, id)) {
      url.searchParams.set(DESTINATION_QUERY_KEYS[destination.type], id);
    }
  }

  const campaign = normalizeAffiliateCampaign(input.campaign);
  if (campaign) url.searchParams.set('c', campaign);

  return url.toString();
}
