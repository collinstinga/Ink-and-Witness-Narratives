export type ArticleStatus = 'draft' | 'published' | 'scheduled';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  order: number;
  isEnabled?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface Topic {
  id: string;
  name: string;
  slug: string;
  description: string;
  displayOrder: number;
  homepageVisible: boolean;
  pieceIds: string[]; // Ordered list of assigned article IDs
  sortMode?: 'manual' | 'newest' | 'oldest' | 'most_purchased' | 'most_liked' | 'most_commented';
  createdAt: string;
  updatedAt?: string;
}

export interface TopicAnalyticsItem {
  topicId: string;
  topicName: string;
  topicSlug: string;
  description: string;
  homepageVisible: boolean;
  displayOrder: number;
  piecesCount: number;
  viewsCount: number;
  clicksCount: number;
  previewClicksCount: number;
  synopsisClicksCount: number;
  payClicksCount: number;
  confirmedPurchasesCount: number;
  revenueKes: number;
  conversionRate: number; // percentage
  likesCount: number;
  commentsCount: number;
  topPieces: {
    articleId: string;
    title: string;
    confirmedPurchases: number;
    revenueKes: number;
  }[];
}

export interface PriceHistoryEntry {
  priceKes: number;
  prices?: Record<string, number>;
  currencyOverrides?: string[];
  updatedAt: string;
  previousPriceKes?: number;
  reason?: string;
}

export interface Article {
  id: string;
  title: string;
  subtitle: string;
  slug: string;
  excerpt: string;
  synopsis?: string; // Short premise and contextual overview for evaluation before paying (no spoilers)
  content: string; // Full markdown / rich text content
  category: string;
  categories?: string[]; // Multiple assigned custom categories
  topics?: string[]; // Multiple assigned editorial topic slugs / IDs
  status: ArticleStatus; // 'draft', 'published', or 'scheduled'
  isPaid: boolean; // Free vs Pay to Read
  priceKes: number; // e.g. 1,050 KES (Hard minimum: 1,050 KES for paid pieces)
  prices?: Record<string, number>; // Multi-currency independent overrides (e.g. { KES: 1050, USD: 8.0, EUR: 7.5, GBP: 6.5 })
  currencyOverrides?: string[]; // List of currencies with manual price overrides
  priceHistory?: PriceHistoryEntry[]; // Audit trail of price changes
  readTimeMinutes: number;
  showReadTime?: boolean; // Defaults to visible for pieces created before this setting.
  publishedAt: string;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  coverImage?: string;
  coverImageOriginal?: string;
  coverImageCrop?: {
    aspectRatio: 'landscape' | 'square' | 'portrait' | 'freeform';
    zoom: number;
    positionX: number;
    positionY: number;
  };
  coverImageSavedPermanently?: boolean;
  coverImageSavedAt?: string;
  featured?: boolean;
  downloadsCount: number;
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  previewParagraphs: string[];
  tags: string[];
  seoTitle?: string;
  metaDescription?: string;
  manualRelatedPieceIds?: string[];
  behindThePiece?: {
    enabled: boolean;
    note?: string;
    inspiration?: string;
    songTitle?: string;
    songArtist?: string;
    songUrl?: string;
  };
  isUnlocked?: boolean;
}

export type ReaderReactionType =
  | 'this_hurt'
  | 'felt_seen'
  | 'beautiful'
  | 'reread'
  | 'damn';

export interface ReaderBookmark {
  id: string;
  blockId: string;
  label: string;
  createdAt: string;
}

export interface ReaderHighlight {
  id: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  text: string;
  color: 'amber';
  createdAt: string;
}

export interface ReaderArticleProgress {
  articleId: string;
  percent: number;
  /** Highest point reached, kept separately from the current resume position. */
  furthestPercent?: number;
  blockId?: string;
  activeChapterId?: string;
  activeChapterTitle?: string;
  chapterPercent?: number;
  bookmarks: ReaderBookmark[];
  /** Saved text selections. Optional for profiles created before highlights existed. */
  highlights?: ReaderHighlight[];
  startedAt: string;
  lastReadAt: string;
  completedAt?: string;
}

export interface ReaderHomeItem {
  article: Article & { isUnlocked?: boolean };
  progress?: ReaderArticleProgress;
  viewedAt?: string;
  accessSource?: LibraryAccessSource;
}

export interface CoverPosition {
  x: number;
  y: number;
}

export interface ContentCollection {
  id: string;
  name: string;
  slug: string;
  description: string;
  pieceIds: string[];
  coverImage?: string;
  coverPosition?: CoverPosition;
  order: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentBundle {
  id: string;
  name: string;
  slug: string;
  description: string;
  pieceIds: string[];
  priceKes: number;
  coverImage?: string;
  coverPosition?: CoverPosition;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  durationMonths: number;
  priceKes: number;
  renewable: boolean;
  badge?: string;
  coverImage?: string;
  coverImageAlt?: string;
  coverPosition?: CoverPosition;
  order: number;
  isPublished: boolean;
  isFeatured?: boolean;
  isArchived?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubscriptionPurchaseSnapshot {
  version: 1;
  planId: string;
  planName: string;
  durationMonths: number;
  priceKes: number;
  renewable: boolean;
}

export interface ReaderSubscription {
  id: string;
  userId: string;
  userEmail: string;
  status: 'active' | 'expired' | 'revoked';
  activePlanId: string;
  activePlanName: string;
  renewable: boolean;
  startedAt: string;
  expiresAt: string;
  lastRenewedAt: string;
  lastCheckoutRequestId: string;
  renewalCount: number;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface ReaderSubscriptionSummary {
  status: 'active' | 'expired' | 'revoked';
  planId: string;
  planName: string;
  startedAt: string;
  expiresAt: string;
  renewable: boolean;
  lastRenewedAt: string;
}

export interface PieceReview {
  id: string;
  articleId: string;
  rating: number;
  review: string;
  status: 'pending' | 'approved' | 'hidden';
  featured: boolean;
  verifiedReader: true;
  createdAt: string;
  updatedAt: string;
}

export interface PieceSocialProof {
  articleId: string;
  reactionCounts: Record<ReaderReactionType, number>;
  currentReaction?: ReaderReactionType;
  verifiedReviewCount: number;
  averageRating: number;
  completedReadCount: number;
  purchaseCount: number;
  viewCount: number;
  testimonials: PieceReview[];
}

export interface ReaderHomeResponse {
  success: true;
  continueReading: ReaderHomeItem[];
  purchased: ReaderHomeItem[];
  recentlyViewed: ReaderHomeItem[];
  recommendations: ReaderHomeItem[];
  collections: Array<ContentCollection & { pieces: Article[] }>;
  bundles: Array<ContentBundle & { pieces: Article[] }>;
  activeSubscription?: ReaderSubscriptionSummary;
}

export interface PieceLike {
  id: string;
  articleId: string;
  readerHash: string;
  createdAt: string;
}

export interface PieceComment {
  id: string;
  articleId: string;
  articleTitle?: string;
  readerName: string;
  readerEmail?: string;
  /** Private ownership key. Public comment responses omit this field. */
  readerHash?: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  status: 'approved' | 'hidden' | 'deleted';
  isReported?: boolean;
  reportedReason?: string;
}

export interface ArticleRevision {
  id: string;
  articleId: string;
  title: string;
  subtitle?: string;
  excerpt?: string;
  synopsis?: string;
  content: string;
  category?: string;
  summary?: string;
  createdAt: string;
  wordCount: number;
}

export interface ReaderLicense {
  token: string;
  articleId: string;
  articleTitle?: string;
  phone: string;
  receipt?: string;
  amount?: number;
  createdAt: string;
  expiresAt: number | string;
  status?: 'active' | 'expired' | 'revoked';
  grantedBy?: 'payment' | 'admin' | 'system';
  issuedAt?: string;
  revokedAt?: string;
  durationDays?: number;
  checkoutRequestId?: string;
}

export type NewsletterSubscriberStatus = 'pending' | 'active' | 'unsubscribed' | 'suppressed';

export interface NewsletterSubscriber {
  id: string;
  email: string;
  name?: string;
  interests: string[];
  followedWorkIds?: string[];
  status: NewsletterSubscriberStatus;
  consentSource: 'homepage' | 'reader_preferences' | 'writer_import';
  consentVersion: string;
  consentAt: string;
  subscribedAt: string;
  updatedAt: string;
  confirmedAt?: string;
  unsubscribedAt?: string;
  suppressionReason?: string;
  lastEmailAt?: string;
  contentMode?: 'standard' | 'discreet';
}

export type NewsletterAudienceType = 'all' | 'interests' | 'selected' | 'work_followers';
export type NewsletterCampaignStatus =
  | 'draft'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'partially_sent'
  | 'failed';
export type NewsletterCampaignKind = 'manual' | 'release';
export type NewsletterDeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'suppressed'
  | 'failed';

export interface NewsletterAudience {
  type: NewsletterAudienceType;
  interests?: string[];
  subscriberIds?: string[];
  workId?: string;
}

export interface NewsletterCampaignContent {
  subject: string;
  preheader?: string;
  heading?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  pieceId?: string;
  chapterId?: string;
  coverImageUrl?: string;
}

export interface NewsletterCampaign {
  id: string;
  kind: NewsletterCampaignKind;
  content: NewsletterCampaignContent;
  audience: NewsletterAudience;
  status: NewsletterCampaignStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  queuedAt?: string;
  sentAt?: string;
  provider: 'resend';
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  lastError?: string;
}

export interface ArticleSaveOptions {
  notifySubscribers?: boolean;
}

export interface PublicationNewsletterResult {
  requested: true;
  status: 'ready' | 'sent' | 'paused';
  campaign?: NewsletterCampaign;
  message?: string;
}

export interface ArticleSaveResult {
  article: Article;
  newsletter?: PublicationNewsletterResult;
}

export interface ArticleMutationResponse extends ArticleSaveResult {
  success: boolean;
}

export interface NewsletterDelivery {
  id: string;
  campaignId: string;
  subscriberId: string;
  email: string;
  status: NewsletterDeliveryStatus;
  provider: 'resend';
  providerMessageId?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  error?: string;
}

export interface NewsletterAdminSummary {
  totalSubscribers: number;
  activeSubscribers: number;
  unsubscribedSubscribers: number;
  suppressedSubscribers: number;
  subscribers: NewsletterSubscriber[];
  recentCampaigns: NewsletterCampaign[];
}

export type LibraryAccessSource = 'MPESA_PURCHASE' | 'MANUAL_GRANT' | 'SUBSCRIPTION' | 'SYSTEM';

export type LibraryArticle = Article & {
  libraryAccessSource?: LibraryAccessSource;
};

export interface UserLibraryEntry {
  articleId: string;
  articleTitle: string;
  accessSource: LibraryAccessSource;
  createdAt: string;
  expiresAt: number;
  receipt?: string;
  article: Article & { isUnlocked: true };
}

export interface UserLibraryResponse {
  success: boolean;
  library: UserLibraryEntry[];
  totalCount: number;
  activeSubscription?: ReaderSubscriptionSummary;
}

export interface ManualAccessGrant {
  id: string;
  articleId: string;
  articleTitle?: string;
  phone: string;
  rawPhone?: string;
  status: 'active' | 'claimed' | 'revoked' | 'deleted' | 'expired';
  activated?: boolean;
  claimedAt?: string;
  claimedPhone?: string;
  claimedUserId?: string;
  claimedUserEmail?: string;
  claimedUserName?: string;
  boundUserId?: string;
  boundUserEmail?: string;
  boundUserName?: string;
  phoneReservationId?: string;
  entitlementId?: string;
  /** Legacy-only bearer retained for controlled migration/revocation. Never issue for new grants. */
  token?: string;
  grantedAt: string;
  grantedBy: string;
  accessType: 'manual';
  accessSource?: 'MANUAL_GRANT';
  notes?: string;
  expiresAt?: number;
  revokedAt?: string;
  deletedAt?: string;
}

export interface ManualAccessVerifyResult {
  success: boolean;
  verified: boolean;
  activated?: boolean;
  alreadyActivated?: boolean;
  requiresAuth?: boolean;
  isOriginalUser?: boolean;
  articleId?: string;
  articleTitle?: string;
  boundUser?: {
    id: string;
    email: string;
    name?: string;
  };
  error?: string;
  code?: string;
  message?: string;
}

export type AnalyticsTimePeriod = 'today' | '7d' | '30d' | '90d' | 'this_year' | 'all_time' | 'custom';

export interface InteractionEvent {
  id: string;
  articleId?: string;
  category?: string;
  eventType: string;
  readerHash?: string;
  readerId?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD
  label?: string; // e.g. "Aug 14"
  revenueKes: number;
  salesRevenueKes?: number;
  tipsRevenueKes?: number;
  purchasesCount: number;
  averagePurchaseKes?: number;
  viewsCount: number;
  previewCount?: number;
  tipsCount?: number;
  uniqueReaders?: number;
  siteVisits?: number;
  uniqueVisitors?: number;
}

export interface PiecePerformanceItem {
  articleId: string;
  title: string;
  slug: string;
  category: string;
  categories?: string[];
  status: ArticleStatus;
  isPaid: boolean;
  priceKes: number;
  publishedAt?: string;
  createdAt?: string;
  views?: number;
  viewsCount?: number;
  uniqueReaders?: number;
  previewViews?: number;
  previewCount?: number;
  synopsisViews?: number;
  paymentAttempts?: number;
  confirmedPurchases?: number;
  purchasesCount?: number;
  directPurchases?: number;
  bundlePurchases?: number;
  failedPayments?: number;
  pendingPayments?: number;
  conversionRate: number; // %
  revenueKes: number;
  salesRevenueKes?: number;
  averagePurchaseKes?: number;
  tipsCount?: number;
  tipsTotalKes?: number;
  totalGrossKes?: number;
  isPieceOfWeek?: boolean;
  isMostSelling?: boolean;
  mpesaConfirmedCount?: number;
  bankConfirmedCount?: number;
}

export interface TrafficPieceAggregate {
  articleId: string;
  views: number;
  previews: number;
  unlockStarts: number;
  paymentStarts: number;
}

export interface TrafficDayAggregate {
  date: string;
  siteVisits: number;
  uniqueVisitors: number;
  pieceViews: number;
  previewViews: number;
  unlockStarts: number;
  paymentStarts: number;
  pieces: Record<string, TrafficPieceAggregate>;
}

export interface TrafficPeriodAggregate extends Omit<TrafficDayAggregate, 'date'> {
  days: TrafficDayAggregate[];
}

export interface TrafficAnalyticsSnapshot {
  trackingSince?: string;
  current: TrafficPeriodAggregate;
  previous: TrafficPeriodAggregate;
}

export interface FunnelStage {
  stage: string;
  label: string;
  count: number;
  conversionFromPrevious: number;
  percentageOfTop: number;
}

export interface ReaderFunnelStage {
  stage: string;
  count: number;
  conversionFromPrev: number; // percentage
  conversionFromTotal: number; // percentage
  dropoffCount: number;
  dropoffPercent: number;
}

export interface EditorialInsight {
  id: string;
  type: string;
  title: string;
  description?: string;
  message?: string;
  articleId?: string;
  articleTitle?: string;
  metric?: string;
  metricValue?: string;
  actionLabel?: string;
  actionType?: string;
  suggestedAction?: string;
}

export interface CategoryAnalyticsItem {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  viewsCount: number;
  filterUsageCount: number;
  piecesCount: number;
  purchasesCount: number;
  revenueKes: number;
}

export interface HomepagePerformanceItem {
  articleId: string;
  article?: Article;
  slot?: number;
  views?: number;
  purchases?: number;
  revenueKes: number;
  tipsCount?: number;
}

export interface StartHerePerformanceItem {
  articleId: string;
  article?: Article;
  slot: number;
  impressions: number;
  clicks: number;
  previewClicks: number;
  synopsisClicks: number;
  payToReadClicks: number;
  confirmedPurchases: number;
  conversionRate: number; // percentage (confirmedPurchases / impressions * 100)
  revenueKes: number;
}

export interface CashFlowSummary {
  confirmedInflowKes: number;
  pendingInflowKes: number;
  failedInflowKes: number;
  totalTransactionAttempts: number;
  confirmedTransactionCount: number;
  pendingTransactionCount: number;
  failedTransactionCount: number;
  confirmedRevenueKes?: number;
  pendingRevenueKes?: number;
  failedRevenueKes?: number;
  confirmedPurchasesCount?: number;
  averageDailyRevenueKes?: number;
  bestRevenueDay?: { date: string; label: string; revenueKes: number } | null;
  bestRevenueMonth?: { month: string; revenueKes: number } | null;
  paymentMethodBreakdown: {
    mpesa: { count: number; amountKes: number };
    card?: { count: number; amountKes: number };
    bank: { count: number; amountKes: number };
    manual: { count: number; amountKes: number };
  };
}

export interface GrowthMetrics {
  revenueGrowth: number;
  purchasesGrowth: number;
  readersGrowth: number;
  conversionGrowth: number;
  viewsGrowthPercent?: number;
  purchasesGrowthPercent?: number;
  revenueGrowthPercent?: number;
  conversionGrowthPercent?: number;
  previousPeriodRevenueKes?: number;
  previousPeriodPurchasesCount?: number;
  previousPeriodViewsCount?: number;
}

export interface ArticleAnalyticsItem {
  articleId: string;
  title: string;
  slug: string;
  category: string;
  status: ArticleStatus;
  isPaid: boolean;
  priceKes: number;
  viewsCount: number;
  purchasesCount: number;
  revenueKes: number;
  tipsCount: number;
  tipsTotalKes: number;
  conversionRate: number; // percentage (purchases / views * 100)
  isMostSellingCurated?: boolean;
  isPieceOfWeekCurated?: boolean;
}

export interface DetailedAnalytics {
  period: AnalyticsTimePeriod | string;
  periodLabel?: string;
  startDate: string;
  endDate: string;
  overview: {
    confirmedRevenueKes: number;
    pendingRevenueKes: number;
    pendingCount: number;
    failedPaymentsCount: number;
    failedPaymentsValueKes: number;
    confirmedPurchasesCount: number;
    uniqueReadersCount: number;
    totalViewsCount: number;
    conversionRate: number;
    averagePurchaseKes: number;
    topPiece?: { id: string; title: string; revenueKes: number; purchasesCount: number } | null;
  };
  traffic?: {
    siteVisits: number;
    uniqueVisitors: number;
    pieceViews: number;
    previewViews: number;
    trackingSince?: string;
    collectionNote: string;
  };
  growth: GrowthMetrics;
  revenue: {
    totalConfirmedKes: number;
    salesRevenueKes: number;
    tipsRevenueKes: number;
    totalSalesKes?: number;
    verifiedPurchasesCount?: number;
    averagePurchaseKes?: number;
    topEarningPieces?: { articleId: string; title: string; revenueKes: number; purchasesCount: number }[];
    recentSales?: PaymentTransaction[];
  };
  purchases: {
    confirmedCount: number;
    averageOrderValueKes: number;
    mpesaConfirmedCount: number;
    bankConfirmedCount: number;
  };
  readers: {
    uniqueReadersCount: number;
    totalArticleViews: number;
    totalPreviewReads: number;
    averageViewsPerReader: number;
  };
  conversion: {
    overallConversionRate: number;
    previewToPurchaseRate: number;
    checkoutToPurchaseRate: number;
    estimatedVisitors?: number;
    totalArticleViews?: number;
    totalUnlocks?: number;
  };
  pendingPayments: {
    count: number;
    totalAmountKes: number;
  };
  tips: {
    totalTipsKes: number;
    verifiedTipsCount: number;
    averageTipKes: number;
    topTippedPieces?: { articleId: string; title: string; tipsTotalKes: number; tipsCount: number }[];
    currencyBreakdown: Record<string, { count: number; totalOriginal: number; totalKes: number }>;
    recentTips?: PaymentTransaction[];
  };
  cashFlow: CashFlowSummary;
  timeSeries: TimeSeriesPoint[];
  conversionFunnel: {
    viewsToPurchaseRate: number;
    previewToCheckoutRate: number;
    checkoutToPurchaseRate: number;
    overallRate: number;
    stages: FunnelStage[];
  };
  funnel?: {
    stages: ReaderFunnelStage[];
    pieceViews: number;
    previewSynopsisViews: number;
    unlockSelected: number;
    paymentInitiated: number;
    paymentConfirmed: number;
  };
  editorialInsights: EditorialInsight[];
  insights?: EditorialInsight[];
  startHerePerformance?: StartHerePerformanceItem[];
  homepagePerformance: {
    pieceOfTheWeek?: HomepagePerformanceItem;
    mostSellingPieces: HomepagePerformanceItem[];
    startHerePieces?: StartHerePerformanceItem[];
    mostSellingMode?: 'auto' | 'manual';
    autoRankedPieces?: HomepagePerformanceItem[];
  };
  homepageSettings?: {
    pieceOfTheWeekId?: string;
    mostSellingMode: 'auto' | 'manual';
    mostSellingPieceIds: string[];
    autoRankedPieceIds: string[];
  };
  pieceAnalytics: PiecePerformanceItem[];
  piecePerformance?: PiecePerformanceItem[];
  categoryPerformance?: CategoryAnalyticsItem[];
  topicPerformance?: TopicAnalyticsItem[];
  content?: {
    totalPieces: number;
    publishedPieces: number;
    draftPieces: number;
    scheduledPieces: number;
    totalViews: number;
    totalWords: number;
    topViewedPieces: Article[];
  };
  reconciliation?: PaymentTransaction[];
}

export type TransactionType = 'PURCHASE' | 'TIP' | 'MANUAL' | 'TEST';
export type PaymentMethod = 'mpesa' | 'bank' | 'manual';
export type TransactionStatus = 'INITIATED' | 'STK_SENT' | 'PENDING' | 'CONFIRMED' | 'SUCCESS' | 'PAID' | 'FAILED' | 'CANCELLED' | 'TIMEOUT' | 'TIMED_OUT' | 'EXPIRED';
export type SaleChannel = 'DIRECT' | 'AFFILIATE';

export interface PaymentBuyerSnapshot {
  userId?: string;
  email?: string;
  phoneNumber?: string;
  phoneVerifiedAt?: string;
  name?: string;
}

export interface PaymentCommissionSnapshot {
  id: string;
  affiliateId: string;
  affiliateCode: string;
  affiliateName?: string;
  amountKes: number;
  rate: number;
  status: CommissionStatus;
}

export interface PaymentTransaction {
  id: string;
  checkoutRequestId: string;
  /** Additive v2 reporting identifier; legacy transactions remain valid without it. */
  orderId?: string;
  /** Present on records written by the v2 sales ledger path. */
  schemaVersion?: 2;
  buyer?: PaymentBuyerSnapshot;
  saleChannel?: SaleChannel;
  /** Writer-only joined projection. Never required on the canonical payment document. */
  commission?: PaymentCommissionSnapshot;
  settledAt?: string;
  commissionId?: string;
  accessEntitlementId?: string;
  paymentAttemptId?: string;
  merchantRequestId?: string;
  articleId: string;
  articleTitle?: string;
  purchaseKind?: 'piece' | 'bundle' | 'subscription';
  bundleId?: string;
  /** Immutable entitlement snapshot captured before payment initiation. */
  bundlePieceIds?: string[];
  subscriptionPlanId?: string;
  /** Immutable plan snapshot captured before the payment provider is contacted. */
  subscriptionPlanName?: string;
  subscriptionDurationMonths?: number;
  subscriptionRenewable?: boolean;
  /** True when this payment extends or replaces an existing Reader Pass. */
  subscriptionRenewal?: boolean;
  subscriptionPlanVersion?: number;
  subscriptionPeriodStartsAt?: string;
  subscriptionExpiresAt?: string;
  phoneNumber?: string; // Sanitized or masked
  senderName?: string;
  amount: number; // KES amount charged
  currency?: string; // e.g. 'KES', 'USD', 'EUR', 'GBP'
  originalAmount?: number; // amount in original currency
  exchangeRate?: number; // rate used to convert to KES (e.g. 130)
  exchangeRateTimestamp?: string;
  paymentMethod?: PaymentMethod; // 'mpesa' | 'bank' | 'manual'
  type: TransactionType;
  status: TransactionStatus;
  mpesaReceiptNumber?: string;
  receiptNumber?: string;
  resultCode?: number;
  resultDesc?: string;
  transactionTimestamp?: string;
  bankReference?: string;
  bankOrderReference?: string;
  bankAccountRef?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  downloadToken?: string;
  isSeed?: boolean; // Distinguish seed demo records from real earnings
  affiliateCode?: string;
  campaignCode?: string;
  affiliateAttributionVersion?: 2;
  affiliateAttributionClaimId?: string;
  affiliateAttributionAt?: string;
  affiliateAttributionExpiresAt?: string;
  shortcodeUsed?: string;
  paymentCapabilityHash?: string;
  callbackCapabilityHash?: string;
  userId?: string;
  userEmail?: string;
}

export interface SupportedCurrency {
  code: string;
  name: string;
  symbol: string;
  flag: string;
  defaultPresets?: number[];
  enabled?: boolean;
  isBase?: boolean;
  defaultPrice?: number;
  exchangeRateToKes?: number;
}

export interface ExchangeRatesData {
  base: string;
  timestamp: string;
  rates: Record<string, number>;
  kesRates: Record<string, number>;
  supportedCurrencies: SupportedCurrency[];
  source: string;
  cached: boolean;
  minTipKes: number;
}

export interface AuthorProfile {
  name: string;
  handle: string;
  instagram: string;
  instagramUrl: string;
  whatsappNumber?: string;
  callPhoneNumber?: string;
  twitter?: string;
  twitterUrl?: string;
  title: string;
  bio: string;
  extendedBio: string;
  location: string;
  featuredQuote: string;
  avatarUrl?: string;
  avatarSavedPermanently?: boolean;
  avatarSavedAt?: string;
  coverPhotoUrl?: string;
  coverPhotoSavedPermanently?: boolean;
  coverPhotoSavedAt?: string;
  welcomeBackgroundUrl?: string;
  welcomeBackgroundSavedPermanently?: boolean;
  welcomeBackgroundSavedAt?: string;
  faviconUrl?: string;
  faviconSavedPermanently?: boolean;
  faviconSavedAt?: string;
  logoUrl?: string;
  logoSavedPermanently?: boolean;
  logoSavedAt?: string;
  heroHeadline?: string;
  displayLikesPublicly?: boolean;
  commentsModerationEnabled?: boolean;
  stats: {
    articlesCount: number;
    readersCount: number;
    satisfactionRate: string;
    instagramFollowers: string;
  };
}

export interface WelcomeBackgroundSettings {
  imageUrl?: string;
  fit: 'cover' | 'contain' | 'custom';
  positionX: number; // 0 to 100 percentage
  positionY: number; // 0 to 100 percentage
  zoom: number; // 50 to 200 percentage
  overlayStrength: number; // 0 to 100 percentage (e.g. 25 = light subtle overlay)
  savedPermanently?: boolean;
  lastSavedAt?: string;
}

export interface SavedAssetRecord {
  id: string;
  target: 'author_avatar' | 'author_cover' | 'welcome_background' | 'favicon' | 'logo' | 'piece_cover' | string;
  filename: string;
  url: string;
  dataUrl?: string;
  mimeType?: string;
  size?: number;
  articleId?: string;
  savedPermanently: boolean;
  savedAt: string;
  updatedAt: string;
  cropSettings?: any;
  accessScope?: 'public' | 'literary_circle_private';
  resourceId?: string;
  shareable?: boolean;
}

export interface HomepageBanner {
  id: string;
  text: string;
  linkText?: string;
  linkUrl?: string;
  bgStyle?: 'sky' | 'indigo' | 'amber' | 'emerald';
  isVisible: boolean;
  priority?: number;
}

export interface HomepageSectionItem {
  id: string;
  title?: string;
  subtitle?: string;
  isVisible: boolean;
  order: number;
}

export interface HomepageConfig {
  welcomeBackground: WelcomeBackgroundSettings;
  homepageCollectionIds?: string[];
  homepageBundleIds?: string[];
  homepagePieceIds?: string[];
  homepageLibraryHeading?: string;
  homepageLibrarySubtitle?: string;
  homepageBundlesHeading?: string;
  homepageBundlesSubtitle?: string;
  homepageCollectionsHeading?: string;
  homepageCollectionsSubtitle?: string;
  homepagePiecesHeading?: string;
  homepagePiecesSubtitle?: string;
  homepageSubscriptionsHeading?: string;
  homepageSubscriptionsSubtitle?: string;
  homepageSubscriptionsBadge?: string;
  communicationHeading?: string;
  communicationDescription?: string;
  communicationEmailEnabled?: boolean;
  communicationWhatsappEnabled?: boolean;
  communicationWhatsappLabel?: string;
  communicationWhatsappDescription?: string;
  communicationWhatsappUrl?: string;
  startHerePieceIds?: string[]; // 3 curated piece IDs
  startHereHeading?: string;
  startHereSubtitle?: string;
  theWritingHeading?: string;
  theWritingSubtitle?: string;
  aboutTheWritingHeading?: string;
  aboutTheWritingStatement?: string;
  aboutTheWritingPurpose?: string;
  aboutTheWritingButtonText?: string;
  mostSellingPieceIds: string[]; // 3 curated piece IDs
  pieceOfTheWeekId?: string; // 1 curated piece ID
  mostSellingMode?: 'auto' | 'manual'; // 'auto' (ranked by performance) or 'manual' (writer picks slots)
  banners?: HomepageBanner[];
  heroHeadline?: string;
  heroSubheadline?: string;
  heroQuote?: string;
  heroBadge?: string;
  heroCtaText?: string;
  sections?: HomepageSectionItem[];
  sectionOrder?: string[];
  pieceOrdering?: string[];
  updatedAt?: string;
  lastSavedAt?: string;
  version?: string;
}

export interface AdminAuthResponse {
  success: boolean;
  token?: string;
  message?: string;
}

export interface MpesaConfig {
  paymentType: 'till' | 'paybill';
  shortcode: string;
  tillNumber: string;
  tillName?: string;
  storeNumber?: string;
  paybillNumber?: string;
  accountReference: string;
  businessPhone?: string;
  whatsappNumber?: string;
  callPhoneNumber?: string;
  consumerKey?: string;
  consumerSecret?: string;
  passkey?: string;
  env: 'sandbox' | 'production';
  defaultPriceKes: number;
  supportedCurrencies?: SupportedCurrency[];
  tippingEnabled?: boolean;
  minTipKes?: number;
  hasConsumerKey: boolean;
  hasConsumerSecret: boolean;
  hasPasskey: boolean;
  credentialsEnvironmentManaged?: boolean;
  credentialsLegacyFallback?: boolean;
}

export interface DashboardStats {
  totalPieces: number;
  publishedPieces: number;
  draftPieces: number;
  paidPieces: number;
  payToReadSalesKes: number;
  tipsReceivedKes: number;
  totalTransactionsCount: number;
  verifiedPurchasesCount: number;
  verifiedTipsCount: number;
  recentPieces: Article[];
  recentTransactions: PaymentTransaction[];
}

export type WriterNavTab = 
  | 'overview' 
  | 'editor' 
  | 'drafts' 
  | 'pieces' 
  | 'published' 
  | 'homepage'
  | 'topics'
  | 'reader-experience'
  | 'subscriptions'
  | 'media'
  | 'affiliates'
  | 'payments' 
  | 'tips' 
  | 'comments'
  | 'analytics'
  | 'readers'
  | 'newsletter'
  | 'settings'
  | 'categories';

// ==========================================
// AFFILIATE & REFERRAL SALES SYSTEM TYPES
// ==========================================

export type AffiliateStatus = 'active' | 'suspended' | 'pending';
export type CommissionStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'REVERSED';
export type PayoutStatus = 'PENDING' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REJECTED';
export type AffiliatePayoutMethod = 'mpesa' | 'bank' | 'paypal';

export interface AffiliatePayoutDetails {
  mpesaPhone?: string;
  mpesaName?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  bankBranch?: string;
  bankSwiftCode?: string;
  paypalEmail?: string;
  notes?: string;
}

export type LiteraryCircleComplimentaryAccessStatus = 'active' | 'suspended' | 'revoked';
export type LiteraryCircleTierSource = 'default' | 'monthly_performance' | 'manual';
export type LiteraryCircleOnboardingStatus = 'not_started' | 'in_progress' | 'completed' | 'dismissed';
export type LiteraryCircleCommissionPolicyStatus = 'draft' | 'active';
export type LiteraryCircleNotificationEventType =
  | 'activation'
  | 'new_release'
  | 'upcoming_campaign'
  | 'new_commission'
  | 'tier_upgrade'
  | 'inactivity_reminder'
  | 'exclusive_opportunity';
export type LiteraryCircleNotificationDeliveryMode = 'preview_only';
export type AffiliateMarketingConsentStatus = 'unknown' | 'granted' | 'denied';
export type LiteraryCircleCommunityPostType =
  | 'announcement'
  | 'release_preview'
  | 'exclusive_excerpt'
  | 'monthly_campaign'
  | 'featured_piece'
  | 'promotional_guidance';

export type LiteraryCircleResourceKind =
  | 'campaign_kit'
  | 'social_copy'
  | 'piece_cover'
  | 'excerpt'
  | 'guidance'
  | 'subscription_campaign';

export type LiteraryCircleResourceDestination =
  | { kind: 'home' }
  | {
      kind: 'piece' | 'collection' | 'bundle' | 'subscription';
      id: string;
    };

export interface LiteraryCirclePromotionalResource {
  id: string;
  kind: LiteraryCircleResourceKind;
  title: string;
  description?: string;
  body?: string;
  destination: LiteraryCircleResourceDestination;
  campaignCode?: string;
  assetId?: string;
  assetAlt?: string;
  isPublished: boolean;
  order: number;
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LiteraryCircleResourceLibrary {
  schemaVersion: 1;
  revision: number;
  enabled: boolean;
  title: string;
  description: string;
  items: LiteraryCirclePromotionalResource[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface LiteraryCircleNotificationEligibility {
  foundingMembersOnly: boolean;
  tierIds: string[];
  requireComplimentaryAccess: boolean;
}

export interface LiteraryCircleNotificationTiming {
  /** Delay after the source event. */
  delayMinutes: number;
  /** Campaign-only lead time before the configured start. */
  leadTimeHours?: number;
  /** Inactivity-only number of quiet days before eligibility. */
  inactivityDays?: number;
  /** Minimum days before another inactivity reminder can become eligible. */
  cooldownDays?: number;
}

export interface LiteraryCircleNotificationTemplate {
  eventType: LiteraryCircleNotificationEventType;
  enabled: boolean;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  timing: LiteraryCircleNotificationTiming;
  eligibility: LiteraryCircleNotificationEligibility;
}

export interface LiteraryCircleNotificationSettings {
  schemaVersion: 1;
  /** Monotonic server-managed revision used to reject stale saves. */
  revision: number;
  enabled: boolean;
  /** Intentionally restricted until consent, approval and outbox migration are complete. */
  deliveryMode: LiteraryCircleNotificationDeliveryMode;
  timezone: 'Africa/Nairobi';
  templates: LiteraryCircleNotificationTemplate[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface AffiliateNotificationEligibilitySummary {
  eventType: LiteraryCircleNotificationEventType;
  total: number;
  eligible: number;
  excluded: number;
  reasons: Record<string, number>;
}

export interface AffiliateNotificationPreferences {
  schemaVersion: 1;
  revision: number;
  marketingConsent: AffiliateMarketingConsentStatus;
  marketingConsentVersion?: string;
  marketingConsentAt?: string;
  marketingConsentSource?: 'affiliate_dashboard' | 'affiliate_onboarding' | 'writer_recorded';
  marketingOptOutAt?: string;
  marketingOptOutSource?: 'affiliate_dashboard' | 'signed_email_link';
  releaseUpdates: boolean;
  campaignUpdates: boolean;
  inactivityReminders: boolean;
  exclusiveOpportunities: boolean;
  commissionAlerts: boolean;
  tierAlerts: boolean;
  allMarketingOptOut: boolean;
  updatedAt?: string;
}

export interface LiteraryCircleCommunityPost {
  id: string;
  type: LiteraryCircleCommunityPostType;
  title: string;
  body: string;
  isPublished: boolean;
  order: number;
  publishedAt?: string;
  expiresAt?: string;
  pieceId?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export interface LiteraryCircleTierDefinition {
  id: string;
  name: string;
  description: string;
  rank: number;
  monthlyVerifiedSalesThreshold: number;
  proposedCommissionRate: number;
  enabled: boolean;
  badgeLabel?: string;
}

export interface AffiliateLiteraryCircleMembership {
  schemaVersion: 1;
  memberSince: string;
  foundingMember: boolean;
  foundingRecognizedAt?: string;
  complimentaryAccess: {
    status: LiteraryCircleComplimentaryAccessStatus;
    scope: 'all_published';
    grantedAt?: string;
    updatedAt: string;
    updatedBy: string;
    reason?: string;
  };
  tier: {
    id: string;
    assignedAt: string;
    source: LiteraryCircleTierSource;
    qualificationPeriod?: string;
    policyVersion?: number;
  };
  onboarding: {
    version: number;
    audience: 'existing_upgrade' | 'new_affiliate';
    status: LiteraryCircleOnboardingStatus;
    completedStepIds: string[];
    welcomeRequired: boolean;
    startedAt?: string;
    completedAt?: string;
    introductoryPeriodEndsAt?: string;
  };
}

export interface LiteraryCircleSettings {
  schemaVersion: 1;
  /** Monotonic server-managed revision used to reject stale full-document saves. */
  revision?: number;
  enabled: boolean;
  defaultTierId: string;
  qualificationTimezone: 'Africa/Nairobi';
  qualificationEffectiveFrom?: string;
  introductoryPeriodDays: number;
  onboardingVersion: number;
  tiers: LiteraryCircleTierDefinition[];
  commissionPolicy: {
    status: LiteraryCircleCommissionPolicyStatus;
    version: number;
    effectiveAt?: string;
    subscriptionRenewalsEligible: boolean;
  };
  /** Server-managed, effective-dated snapshots used for delayed settlement. */
  commissionPolicyHistory?: LiteraryCircleCommissionPolicySnapshot[];
  community: {
    enabled: boolean;
    title: string;
    description: string;
    whatsappInviteUrl?: string;
    posts?: LiteraryCircleCommunityPost[];
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface LiteraryCircleCommissionPolicySnapshot {
  version: number;
  status: LiteraryCircleCommissionPolicyStatus;
  effectiveAt: string;
  defaultTierId: string;
  qualificationEffectiveFrom?: string;
  tiers: LiteraryCircleTierDefinition[];
  subscriptionRenewalsEligible: boolean;
  confirmedAt: string;
  confirmedBy: string;
}

export interface AffiliateAccount {
  id: string;
  affiliateCode: string; // e.g. MIKE123
  name: string;
  email: string;
  phone: string;
  passwordHash?: string;
  status: AffiliateStatus;
  /** Explicit writer approval; status alone is not proof of approval. */
  approvedAt?: string;
  approvedBy?: string;
  customCommissionRate?: number | null; // null => inherits global default %
  commissionRate?: number; // active calculated commission %
  payoutMethod: AffiliatePayoutMethod;
  payoutDetails: AffiliatePayoutDetails;
  allowedPieceIds?: string[]; // empty means all pieces
  attributionDays?: number | null; // null => inherits global default attribution window
  totalClicks: number;
  uniqueVisitors: number;
  totalSalesCount: number;
  totalRevenueKes: number;
  totalCommissionEarnedKes: number;
  totalCommissionPaidKes: number;
  balanceAvailableKes: number;
  balancePendingKes: number;
  linksDisabled?: boolean;
  notes?: string;
  acceptedTerms?: boolean;
  termsVersion?: string;
  termsAcceptedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastActivityAt?: string;
  lastReferralAt?: string;
  lastVerifiedSaleAt?: string;
  lastDashboardAt?: string;
  literaryCircle?: AffiliateLiteraryCircleMembership;
  notificationPreferences?: AffiliateNotificationPreferences;
  /** Private revocation generation. Never include this in browser responses. */
  sessionVersion?: string;
}

export type AffiliatePublicProfile = Omit<AffiliateAccount, 'passwordHash' | 'sessionVersion'>;
export type AffiliateDashboardData = AffiliateDashboardStats;

export interface AffiliateSession {
  storageVersion: 2;
  affiliateId: string;
  sessionVersion: string;
  createdAt: number;
  expiresAt: number;
}

export interface AffiliateSaleCommission {
  id: string;
  orderId?: string;
  affiliateId: string;
  affiliateCode: string;
  affiliateName: string;
  transactionId: string;
  checkoutRequestId?: string;
  receiptNumber: string;
  articleId: string;
  articleTitle: string;
  saleAmountKes: number;
  currency?: string;
  originalAmount?: number;
  commissionRate: number; // e.g. 15
  commissionAmountKes: number;
  grossCreatorRevenueKes: number; // saleAmountKes - commissionAmountKes
  paymentMethod: string;
  status: CommissionStatus;
  payoutId?: string;
  reversalReason?: string;
  fraudFlag?: {
    flagged: boolean;
    reason?: string;
    severity?: 'low' | 'medium' | 'high';
    reviewed?: boolean;
  };
  campaignCode?: string;
  purchaseKind?: 'piece' | 'bundle' | 'subscription';
  subscriptionPlanId?: string;
  subscriptionRenewal?: boolean;
  commissionRateSource?: 'campaign' | 'piece_override' | 'affiliate_override' | 'literary_circle_tier' | 'global_default';
  literaryCircleTierId?: string;
  literaryCirclePolicyVersion?: number;
  createdAt: string;
  approvedAt?: string;
  paidAt?: string;
  reversedAt?: string;
}

export interface AffiliateClickEvent {
  id: string;
  affiliateCode: string;
  affiliateId?: string;
  articleId?: string;
  campaignCode?: string;
  /** Durable v2 click events use a random-cookie-derived HMAC pseudonym. */
  visitorKey?: string;
  schemaVersion?: 2;
  referrerOrigin?: string;
  dedupeWindowStartedAt?: string;
  /** Legacy local-only fields retained for backwards-compatible backup reads. */
  ipHash?: string;
  userAgent?: string;
  referrer?: string;
  timestamp: string;
}

export interface AffiliatePayoutRequest {
  id: string;
  affiliateId: string;
  affiliateCode: string;
  affiliateName: string;
  amountKes: number;
  salesCount: number;
  commissionIds: string[];
  payoutMethod: AffiliatePayoutMethod;
  payoutDetails: AffiliatePayoutDetails;
  status: PayoutStatus;
  paymentReference?: string; // e.g. Safaricom B2C Ref "QK9283719"
  requestedAt: string;
  processedAt?: string;
  paidAt?: string;
  notes?: string;
  rejectedReason?: string;
}

export interface AffiliateCampaign {
  id: string;
  code: string;
  name: string;
  description?: string;
  commissionRate: number;
  attributionDays: number;
  eligiblePieceIds: string[]; // empty means all pieces
  startDate: string;
  endDate: string;
  isActive: boolean;
  clicksCount: number;
  salesCount: number;
  revenueKes: number;
  commissionsKes: number;
  createdAt: string;
  updatedAt?: string;
}

export interface AffiliateSettings {
  defaultCommissionRate: number; // e.g. 15 (%)
  minPayoutThresholdKes: number; // e.g. 1000 (KES)
  defaultAttributionDays: number; // 7, 14, 30, 60, 90 (default 30)
  allowTipsCommission: boolean; // default false
  autoApproveCommissions: boolean; // default true
  autoApproveDelayHours: number; // default 24
  enablePublicLeaderboard: boolean; // default false
  allowSelfRegistration: boolean; // default true
  pieceCommissionOverrides: Record<string, number>; // pieceId -> commission %
}

export interface AffiliateAuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  targetType: 'affiliate' | 'commission' | 'payout' | 'settings' | 'campaign' | 'link' | 'resource' | 'notification';
  targetId?: string;
  summary: string;
  previousValue?: any;
  newValue?: any;
}

export interface AffiliatePublicStats {
  totalAffiliatesCount: number;
  activeAffiliatesCount: number;
  totalCommissionsPaidKes: number;
}

export interface AffiliateDashboardStats {
  affiliate: AffiliatePublicProfile;
  clicks: number;
  uniqueVisitors: number;
  totalPiecesSold: number;
  totalConfirmedSales: number;
  totalRevenueGeneratedKes: number;
  commissionEarnedKes: number;
  commissionPendingKes: number;
  commissionApprovedKes: number;
  commissionPaidKes: number;
  availableBalanceKes: number;
  minPayoutThresholdKes: number;
  sales: AffiliateSaleCommission[];
  payouts: AffiliatePayoutRequest[];
  campaigns: AffiliateCampaign[];
  settings: {
    defaultCommissionRate: number;
    activeCommissionRate?: number;
    attributionDays: number;
    minPayoutThresholdKes: number;
  };
  literaryCircle?: LiteraryCircleDashboardSummary;
}

export interface LiteraryCirclePerformancePeriod {
  periodKey: string;
  startsAt: string;
  endsAt: string;
  isCurrent: boolean;
  verifiedSales: number;
  qualifyingSales: number;
  grossSalesKes: number;
  commissionEarnedKes: number;
  retainedRevenueKes: number;
  pieceSales: number;
  bundleSales: number;
  subscriptionSales: number;
  reversedOrRejectedSales: number;
  qualifiedTier: LiteraryCircleTierDefinition;
  qualificationMode: 'active' | 'projected';
  policyVersion: number;
  recordedTierIds: string[];
  recordedPolicyVersions: number[];
}

export interface LiteraryCircleAffiliatePerformanceReport {
  affiliateId: string;
  affiliateCode: string;
  affiliateName: string;
  manuallyAssignedTierId?: string;
  periods: LiteraryCirclePerformancePeriod[];
}

export interface LiteraryCircleDashboardSummary {
  enabled: boolean;
  foundingMember: boolean;
  complimentaryAccessStatus: LiteraryCircleComplimentaryAccessStatus;
  currentTier: LiteraryCircleTierDefinition;
  nextTier?: LiteraryCircleTierDefinition;
  monthlyVerifiedSales: number;
  lifetimeVerifiedSales: number;
  progressToNextTierPercent: number;
  salesToNextTier: number;
  onboarding: AffiliateLiteraryCircleMembership['onboarding'];
  introductoryPeriodActive: boolean;
  commissionPolicyStatus: LiteraryCircleCommissionPolicyStatus;
  community: LiteraryCircleSettings['community'];
  performancePeriods?: LiteraryCirclePerformancePeriod[];
}

export interface AffiliateAnalyticsWindow {
  startDate: string;
  endDate: string;
  startsAt: string;
  endsAt: string;
  days: number;
  timeZone: 'Africa/Nairobi';
}

export interface AffiliateAnalyticsFilters {
  affiliateId?: string;
  articleId?: string;
  purchaseKind?: 'piece' | 'bundle' | 'subscription';
  subscriptionPlanId?: string;
  literaryCircleTierId?: string;
}

/** Aggregate-only writer analytics. This response intentionally contains no reader identifiers. */
export interface AffiliateAnalyticsReport {
  generatedAt: string;
  window: AffiliateAnalyticsWindow;
  filters: AffiliateAnalyticsFilters;
  accounts: {
    registered: number;
    active: number;
    pending: number;
    suspended: number;
    withLifetimeVerifiedSales: number;
    withoutLifetimeVerifiedSales: number;
    withVerifiedSalesInWindow: number;
  };
  totals: {
    verifiedSales: number;
    pieceSales: number;
    bundleSales: number;
    subscriptionSales: number;
    grossSalesKes: number;
    commissionsRecordedKes: number;
    commissionsPaidKes: number;
    retainedRevenueKes: number;
  };
  buyerMetrics: {
    coverage: 'complete' | 'partial' | 'unavailable';
    identifiedSales: number;
    unidentifiedSales: number;
    uniquePayingReaders: number | null;
    newAffiliateAcquiredReaders: number | null;
    repeatPurchases: number | null;
    repeatPayingReaders: number | null;
  };
  referralTraffic: {
    coverage: 'complete' | 'partial' | 'unavailable';
    reason: 'complete' | 'not_provided' | 'incomplete_history' | 'unsupported_filter';
    clicks: number | null;
    knownUniqueVisitors: number | null;
    clicksWithoutVisitorKey: number | null;
    conversionRate: number | null;
  };
  monthly: Array<{
    periodKey: string;
    verifiedSales: number;
    grossSalesKes: number;
    commissionsRecordedKes: number;
    retainedRevenueKes: number;
  }>;
  topAffiliates: Array<{
    affiliateId: string;
    affiliateCode: string;
    affiliateName: string;
    verifiedSales: number;
    grossSalesKes: number;
    commissionsRecordedKes: number;
    retainedRevenueKes: number;
  }>;
  topOffers: Array<{
    purchaseKind: 'piece' | 'bundle' | 'subscription';
    offerId: string;
    title: string;
    verifiedSales: number;
    grossSalesKes: number;
  }>;
  integrity: {
    invalidRecordsExcluded: number;
    unverifiedRecordsExcluded: number;
    duplicateRecordsExcluded: number;
  };
}

export interface AdminAffiliatesSummary {
  totalAffiliates: number;
  activeAffiliates: number;
  suspendedAffiliates: number;
  pendingAffiliates: number;
  totalAffiliateClicks: number;
  totalAffiliateSales: number;
  totalRevenueGeneratedKes: number;
  totalCommissionsKes: number;
  pendingCommissionsKes: number;
  approvedCommissionsKes: number;
  paidCommissionsKes: number;
  outstandingBalanceKes: number;
  affiliates: AffiliatePublicProfile[];
  recentSales: AffiliateSaleCommission[];
  payouts: AffiliatePayoutRequest[];
  campaigns: AffiliateCampaign[];
  settings: AffiliateSettings;
  auditLogs: AffiliateAuditLogEntry[];
  flaggedCount: number;
  affiliatesWithLifetimeSales?: number;
  affiliatesWithoutSales?: number;
  literaryCircleSettings?: LiteraryCircleSettings;
  literaryCirclePerformance?: LiteraryCircleAffiliatePerformanceReport[];
  topAffiliates: {
    id: string;
    name: string;
    affiliateCode: string;
    salesCount: number;
    revenueKes: number;
    commissionEarnedKes: number;
    conversionRate: number;
  }[];
}

// User & Authentication Types
export type UserRole = 'client' | 'admin';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

export interface UserRecord extends User {
  passwordHash: string;
}

export interface AuthSession {
  storageVersion: 2;
  userId: string;
  role: UserRole;
  email: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  /** New reader sessions must match the server-side active-session pointer. */
  activeReaderSession?: true;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  error?: string;
  message?: string;
}

