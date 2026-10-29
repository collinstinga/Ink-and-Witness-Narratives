/** Writer-only manual partner email DTOs. No provider credentials or delivery capabilities. */
export interface AffiliatePartnerEmailInput {
  subject: string;
  body: string;
  audience: 'all' | 'selected';
  affiliateIds: string[];
}

export interface AffiliatePartnerEmailRecipient {
  id: string;
  name: string;
  email: string;
  eligible: boolean;
  reason?: string;
}

export interface AffiliatePartnerEmailPreview {
  eligible: number;
  excluded: number;
  total: number;
}

export interface AffiliatePartnerEmailCampaign extends AffiliatePartnerEmailInput {
  id: string;
  status: 'draft' | 'sending' | 'sent' | 'partially_sent' | 'paused';
  eligibleCount: number;
  /** Accepted by the email provider; this is not a claim of inbox delivery. */
  sentCount: number;
  failedCount: number;
  excludedCount?: number;
  remainingCount?: number;
  uncertainCount?: number;
  createdAt: string;
}

export interface AffiliatePartnerEmailOverview {
  providerConfigured: boolean;
  campaigns: AffiliatePartnerEmailCampaign[];
  recipients: AffiliatePartnerEmailRecipient[];
}

export interface AffiliatePartnerEmailStep {
  campaign: AffiliatePartnerEmailCampaign;
  complete: boolean;
}
