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
  isUnlocked?: boolean;
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
  readerHash: string;
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
  token?: string;
  grantedAt: string;
  grantedBy: string;
  accessType: 'manual';
  accessSource?: 'MANUAL_GRANT';
  notes?: string;
  expiresAt?: number;
}

export interface ManualAccessVerifyResult {
  success: boolean;
  verified: boolean;
  activated?: boolean;
  alreadyActivated?: boolean;
  requiresAuth?: boolean;
  isOriginalUser?: boolean;
  token?: string;
  articleId?: string;
  articleTitle?: string;
  boundUser?: {
    id: string;
    email: string;
    name?: string;
  };
  error?: string;
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

export interface PaymentTransaction {
  id: string;
  checkoutRequestId: string;
  merchantRequestId?: string;
  articleId: string;
  articleTitle?: string;
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
  bankAccountRef?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  downloadToken?: string;
  isSeed?: boolean; // Distinguish seed demo records from real earnings
  affiliateCode?: string;
  campaignCode?: string;
  shortcodeUsed?: string;
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
  | 'media'
  | 'affiliates'
  | 'payments' 
  | 'tips' 
  | 'comments'
  | 'analytics'
  | 'readers'
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

export interface AffiliateAccount {
  id: string;
  affiliateCode: string; // e.g. MIKE123
  name: string;
  email: string;
  phone: string;
  passwordHash?: string;
  status: AffiliateStatus;
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
}

export type AffiliatePublicProfile = Omit<AffiliateAccount, 'passwordHash'>;
export type AffiliateDashboardData = AffiliateDashboardStats;

export interface AffiliateSaleCommission {
  id: string;
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
  targetType: 'affiliate' | 'commission' | 'payout' | 'settings' | 'campaign' | 'link';
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
  affiliate: Omit<AffiliateAccount, 'passwordHash'>;
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
  sessionId: string;
  userId: string;
  role: UserRole;
  email: string;
  name: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  error?: string;
  message?: string;
}

