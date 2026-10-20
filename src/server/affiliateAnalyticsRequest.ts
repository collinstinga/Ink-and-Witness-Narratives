import type { AffiliateAnalyticsFilters } from '../types.js';
import { AffiliateAnalyticsValidationError } from './affiliateAnalytics.js';

export interface AffiliateAnalyticsRequestOptions {
  startDate?: string;
  endDate?: string;
  filters?: AffiliateAnalyticsFilters;
}

function singleQueryValue(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value) || typeof value !== 'string') {
    throw new AffiliateAnalyticsValidationError(`${label} must be provided once.`);
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AffiliateAnalyticsValidationError(`${label} is invalid.`);
  }
  return normalized;
}

/** Parse only the documented analytics query parameters; unknown input is never reflected. */
export function parseAffiliateAnalyticsQuery(
  query: Record<string, unknown>,
): AffiliateAnalyticsRequestOptions {
  const startDate = singleQueryValue(query.startDate, 'Start date');
  const endDate = singleQueryValue(query.endDate, 'End date');
  const affiliateId = singleQueryValue(query.affiliateId, 'Affiliate');
  const articleId = singleQueryValue(query.articleId, 'Piece');
  const subscriptionPlanId = singleQueryValue(query.subscriptionPlanId, 'Subscription plan');
  const literaryCircleTierId = singleQueryValue(query.literaryCircleTierId, 'Literary Circle tier');
  const purchaseKindValue = singleQueryValue(query.purchaseKind, 'Purchase type');
  let purchaseKind: AffiliateAnalyticsFilters['purchaseKind'];
  if (purchaseKindValue !== undefined) {
    if (purchaseKindValue !== 'piece' && purchaseKindValue !== 'bundle' && purchaseKindValue !== 'subscription') {
      throw new AffiliateAnalyticsValidationError('Purchase type must be piece, bundle, or subscription.');
    }
    purchaseKind = purchaseKindValue;
  }

  const filters: AffiliateAnalyticsFilters = {
    ...(affiliateId ? { affiliateId } : {}),
    ...(articleId ? { articleId } : {}),
    ...(purchaseKind ? { purchaseKind } : {}),
    ...(subscriptionPlanId ? { subscriptionPlanId } : {}),
    ...(literaryCircleTierId ? { literaryCircleTierId } : {}),
  };

  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  };
}
