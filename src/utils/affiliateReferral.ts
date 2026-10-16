/**
 * Affiliate & Referral Tracking Utility for Ink & Witness Narratives
 * Handles referral code extraction and current-tab checkout context. The signed
 * HttpOnly server cookie remains the only authority for commission attribution.
 */

import { getAffiliateReferralTrackingTargetFromSearchParams } from './affiliateReferralDestination.js';

const REF_STORAGE_KEY = 'ink_witness_affiliate_ref';
const REF_TIMESTAMP_KEY = 'ink_witness_affiliate_time';
const CAMPAIGN_STORAGE_KEY = 'ink_witness_affiliate_campaign';

export interface StoredReferral {
  code: string;
  campaign?: string;
  timestamp: number;
}

/**
 * Initializes affiliate tracking on page load from URL parameters.
 * Checks for ?ref=CODE or ?aff=CODE or ?referral=CODE and optional ?c=CAMPAIGN or ?campaign=CAMPAIGN
 */
export function initReferralTracking(): StoredReferral | null {
  if (typeof window === 'undefined') return null;

  try {
    // Remove the legacy 30-day referral state. Attribution is intentionally
    // scoped to the browser tab/session and consumed by the first checkout.
    localStorage.removeItem(REF_STORAGE_KEY);
    localStorage.removeItem(REF_TIMESTAMP_KEY);
    localStorage.removeItem(CAMPAIGN_STORAGE_KEY);
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref') || urlParams.get('aff') || urlParams.get('referral');
    const campaign = urlParams.get('c') || urlParams.get('campaign');

    if (refCode && refCode.trim()) {
      const cleanCode = refCode.trim().toLowerCase();
      const now = Date.now();

      // Session storage is display context only; it is never trusted by the
      // payment server as proof of affiliate attribution.
      sessionStorage.setItem(REF_STORAGE_KEY, cleanCode);
      sessionStorage.setItem(REF_TIMESTAMP_KEY, now.toString());

      if (campaign && campaign.trim()) {
        const cleanCampaign = campaign.trim().toLowerCase();
        sessionStorage.setItem(CAMPAIGN_STORAGE_KEY, cleanCampaign);
      } else {
        sessionStorage.removeItem(CAMPAIGN_STORAGE_KEY);
      }

      // The server deduplicates redirect-originated clicks with a short-lived,
      // HttpOnly signed cookie. Query parameters are never trusted as proof that
      // a click was already recorded.
      registerClickOnBackend(cleanCode, campaign || undefined);

      return {
        code: cleanCode,
        campaign: campaign || undefined,
        timestamp: now
      };
    }

    // Continue only the current browser-tab referral journey.
    return getActiveReferral();
  } catch (err) {
    console.warn('[Affiliate] Error initializing referral tracking:', err);
    return null;
  }
}

/**
 * Retrieves referral display context for the current browser tab.
 */
export function getActiveReferral(): StoredReferral | null {
  if (typeof window === 'undefined') return null;

  try {
    const code = sessionStorage.getItem(REF_STORAGE_KEY);
    const timeStr = sessionStorage.getItem(REF_TIMESTAMP_KEY);
    const campaign = sessionStorage.getItem(CAMPAIGN_STORAGE_KEY) || undefined;

    if (!code) return null;

    const timestamp = timeStr ? parseInt(timeStr, 10) : Date.now();

    return {
      code,
      campaign,
      timestamp
    };
  } catch {
    return null;
  }
}

/**
 * Clears stored referral
 */
export function clearReferral() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(REF_STORAGE_KEY);
    localStorage.removeItem(REF_TIMESTAMP_KEY);
    localStorage.removeItem(CAMPAIGN_STORAGE_KEY);
    sessionStorage.removeItem(REF_STORAGE_KEY);
    sessionStorage.removeItem(REF_TIMESTAMP_KEY);
    sessionStorage.removeItem(CAMPAIGN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Registers click on backend
 */
async function registerClickOnBackend(ref: string, campaign?: string) {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    // Mirror the redirect route's canonical target so its signed dedup cookie
    // matches this non-blocking client request. This prevents a collection,
    // bundle, or Reader Pass landing from being counted again as a homepage
    // click or overwriting its destination-specific attribution context.
    const articleId = getAffiliateReferralTrackingTargetFromSearchParams(urlParams);

    await fetch('/api/affiliate/click', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref,
        articleId,
        campaign
      })
    });
  } catch {
    // Non-blocking
  }
}
