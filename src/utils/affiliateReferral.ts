/**
 * Affiliate & Referral Tracking Utility for Ink & Witness Narratives
 * Handles referral code extraction, persistence, attribution window validation,
 * and payload enrichment for payment requests.
 */

const REF_STORAGE_KEY = 'ink_witness_affiliate_ref';
const REF_TIMESTAMP_KEY = 'ink_witness_affiliate_time';
const CAMPAIGN_STORAGE_KEY = 'ink_witness_affiliate_campaign';
const DEFAULT_ATTRIBUTION_DAYS = 30;

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
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref') || urlParams.get('aff') || urlParams.get('referral');
    const campaign = urlParams.get('c') || urlParams.get('campaign');

    if (refCode && refCode.trim()) {
      const cleanCode = refCode.trim().toLowerCase();
      const now = Date.now();

      // Store in localStorage & sessionStorage
      localStorage.setItem(REF_STORAGE_KEY, cleanCode);
      localStorage.setItem(REF_TIMESTAMP_KEY, now.toString());
      sessionStorage.setItem(REF_STORAGE_KEY, cleanCode);

      if (campaign && campaign.trim()) {
        const cleanCampaign = campaign.trim().toLowerCase();
        localStorage.setItem(CAMPAIGN_STORAGE_KEY, cleanCampaign);
        sessionStorage.setItem(CAMPAIGN_STORAGE_KEY, cleanCampaign);
      }

      // Fire beacon/click registration to backend asynchronously
      registerClickOnBackend(cleanCode, campaign || undefined);

      return {
        code: cleanCode,
        campaign: campaign || undefined,
        timestamp: now
      };
    }

    // Check if existing stored referral is within attribution window
    return getActiveReferral();
  } catch (err) {
    console.warn('[Affiliate] Error initializing referral tracking:', err);
    return null;
  }
}

/**
 * Retrieves the currently active stored referral if valid and not expired
 */
export function getActiveReferral(attributionDays = DEFAULT_ATTRIBUTION_DAYS): StoredReferral | null {
  if (typeof window === 'undefined') return null;

  try {
    const code = sessionStorage.getItem(REF_STORAGE_KEY) || localStorage.getItem(REF_STORAGE_KEY);
    const timeStr = localStorage.getItem(REF_TIMESTAMP_KEY);
    const campaign = sessionStorage.getItem(CAMPAIGN_STORAGE_KEY) || localStorage.getItem(CAMPAIGN_STORAGE_KEY) || undefined;

    if (!code) return null;

    const timestamp = timeStr ? parseInt(timeStr, 10) : Date.now();
    const maxAgeMs = attributionDays * 24 * 60 * 60 * 1000;

    if (Date.now() - timestamp > maxAgeMs) {
      // Expired attribution window
      clearReferral();
      return null;
    }

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
    const articleId = urlParams.get('article') || undefined;

    await fetch('/api/affiliate/click', {
      method: 'POST',
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
