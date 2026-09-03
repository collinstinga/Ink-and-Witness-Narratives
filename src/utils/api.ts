import { 
  Article, 
  AuthorProfile, 
  PaymentTransaction, 
  MpesaConfig, 
  Category,
  Topic,
  TopicAnalyticsItem,
  DashboardStats,
  DetailedAnalytics,
  PieceLike,
  PieceComment,
  AffiliateAccount,
  AffiliatePublicProfile,
  AffiliateDashboardData,
  AffiliateSaleCommission,
  AffiliatePayoutRequest,
  AffiliateCampaign,
  AffiliateSettings,
  AffiliateAuditLogEntry,
  AdminAffiliatesSummary,
  ReaderLicense
} from '../types.js';
import { getActiveReferral } from './affiliateReferral.js';

// Local storage key for purchased tokens
const TOKENS_STORAGE_KEY = 'ink_witness_tokens';
const ADMIN_SESSION_MARKER_KEY = 'ink_writer_session_active';
const AFFILIATE_SESSION_MARKER_KEY = 'ink_affiliate_session_active';
const LEGACY_ADMIN_SESSION_KEYS = ['ink_writer_session_token', 'ink_admin_token'];
const LEGACY_AFFILIATE_SESSION_KEY = 'ink_affiliate_session_token';
const READER_ID_KEY = 'ink_reader_anon_id';

export function getAnonymousReaderId(): string {
  try {
    let id = localStorage.getItem(READER_ID_KEY);
    if (!id) {
      id = 'rdr_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      localStorage.setItem(READER_ID_KEY, id);
    }
    return id;
  } catch {
    return 'rdr_guest';
  }
}

export function getStoredTokens(): Record<string, { token: string; receipt: string; phone: string; purchasedAt: string }> {
  try {
    const raw = localStorage.getItem(TOKENS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function savePurchasedToken(articleId: string, token: string, receipt: string, phone: string) {
  try {
    const current = getStoredTokens();
    current[articleId] = {
      token,
      receipt,
      phone,
      purchasedAt: new Date().toISOString()
    };
    localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.error("Failed to store token", err);
  }
}

export function getArticleToken(articleId: string): string | null {
  const tokens = getStoredTokens();
  return tokens[articleId]?.token || null;
}

export function getArticleReceipt(articleId: string): string | null {
  const tokens = getStoredTokens();
  return tokens[articleId]?.receipt || null;
}

export function clearStoredTokens() {
  try {
    localStorage.removeItem(TOKENS_STORAGE_KEY);
  } catch (err) {
    console.error("Failed to clear tokens", err);
  }
}

export function getWriterToken(): string | null {
  try {
    LEGACY_ADMIN_SESSION_KEYS.forEach(key => localStorage.removeItem(key));
    return localStorage.getItem(ADMIN_SESSION_MARKER_KEY) === '1' ? 'cookie-session' : null;
  } catch {
    return null;
  }
}

export function setWriterToken(_token: string) {
  try {
    LEGACY_ADMIN_SESSION_KEYS.forEach(key => localStorage.removeItem(key));
    localStorage.setItem(ADMIN_SESSION_MARKER_KEY, '1');
  } catch (err) {
    console.error("Failed to save writer session state", err);
  }
}

export function clearWriterToken() {
  try {
    localStorage.removeItem(ADMIN_SESSION_MARKER_KEY);
    LEGACY_ADMIN_SESSION_KEYS.forEach(key => localStorage.removeItem(key));
  } catch (err) {
    console.error("Failed to clear writer session state", err);
  }
}

export function getAdminHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  return { ...customHeaders };
}

export function getAffiliateToken(): string | null {
  try {
    localStorage.removeItem(LEGACY_AFFILIATE_SESSION_KEY);
    return localStorage.getItem(AFFILIATE_SESSION_MARKER_KEY) === '1' ? 'cookie-session' : null;
  } catch {
    return null;
  }
}

export function setAffiliateToken(_token: string) {
  try {
    localStorage.removeItem(LEGACY_AFFILIATE_SESSION_KEY);
    localStorage.setItem(AFFILIATE_SESSION_MARKER_KEY, '1');
  } catch (err) {
    console.error("Failed to save affiliate session state", err);
  }
}

export function clearAffiliateToken() {
  try {
    localStorage.removeItem(AFFILIATE_SESSION_MARKER_KEY);
    localStorage.removeItem(LEGACY_AFFILIATE_SESSION_KEY);
  } catch (err) {
    console.error("Failed to clear affiliate session state", err);
  }
}

/**
 * Robust JSON fetch helper with defensive non-JSON error trapping
 * Prevents HTML/doctype JSON parse errors from escaping into UI state
 */
export async function safeFetchJson<T = any>(
  url: string,
  options?: RequestInit,
  fallbackErrorMessage = "Unable to process request at this time. Please try again shortly."
): Promise<T> {
  let res: Response;
  const mergedOptions: RequestInit = {
    credentials: 'include',
    ...options,
    headers: {
      ...(options?.headers || {})
    }
  };
  try {
    res = await fetch(url, mergedOptions);
  } catch (networkErr: any) {
    console.error("Network fetch failed for", url, networkErr);
    throw new Error("Unable to connect to the server. Please check your internet connection and try again.");
  }

  const contentType = res.headers.get("content-type") || "";
  let data: any = null;

  try {
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
  } catch (parseErr) {
    console.warn("Non-JSON response received from", url, parseErr);
    data = null;
  }

  if (res.status === 401 || res.status === 403) {
    if (url.includes("/affiliate/")) {
      clearAffiliateToken();
      throw new Error(data?.error || data?.message || "Affiliate session expired. Please log in again.");
    }
    if (url.includes("/admin/")) {
      clearWriterToken();
      throw new Error(data?.error || data?.message || "Writer session expired. Please log in again.");
    }
    throw new Error(data?.error || data?.message || "Authentication required.");
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || (typeof data === "string" ? data : null) || fallbackErrorMessage;
    throw new Error(msg);
  }

  if (data === null) {
    throw new Error(fallbackErrorMessage);
  }

  return data as T;
}

export const api = {
  // Public APIs
  async getAuthor(): Promise<AuthorProfile> {
    const res = await fetch('/api/author');
    if (!res.ok) throw new Error('Failed to fetch author profile');
    return res.json();
  },

  async getArticles(): Promise<Article[]> {
    const res = await fetch('/api/articles');
    if (!res.ok) throw new Error('Failed to fetch articles');
    return res.json();
  },

  async getCategories(): Promise<Category[]> {
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error('Failed to fetch categories');
    return res.json();
  },

  async createCategory(name: string, description?: string, order?: number): Promise<Category> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ name, description, order })
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create category');
    }
    const data = await res.json();
    return data.category;
  },

  async updateCategory(id: string, name: string, description?: string, order?: number): Promise<Category> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/categories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ name, description, order })
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update category');
    }
    const data = await res.json();
    return data.category;
  },

  async deleteCategory(id: string): Promise<{ success: boolean; message: string }> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'x-admin-token': activeToken || ''
      }
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete category');
    }
    return res.json();
  },

  async reorderCategories(ids: string[]): Promise<Category[]> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/categories-reorder', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ ids })
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reorder categories');
    }
    const data = await res.json();
    return data.categories;
  },

  // Topics Catalogue APIs
  async getTopics(includeHidden = false): Promise<Topic[]> {
    const adminToken = getWriterToken();
    const headers: Record<string, string> = {};
    if (adminToken) {
      headers['x-admin-token'] = adminToken;
    }
    const url = includeHidden ? '/api/topics?includeHidden=true' : '/api/topics';
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Failed to fetch topics');
    return res.json();
  },

  async getTopic(idOrSlug: string): Promise<{ topic: Topic; pieces: Article[] }> {
    const adminToken = getWriterToken();
    const headers: Record<string, string> = {};
    if (adminToken) {
      headers['x-admin-token'] = adminToken;
    }
    const res = await fetch(`/api/topics/${encodeURIComponent(idOrSlug)}`, { headers });
    if (!res.ok) throw new Error('Failed to fetch topic details');
    return res.json();
  },

  async createTopic(topicData: Partial<Topic> & { name: string }): Promise<Topic> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/topics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify(topicData)
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create topic');
    }
    const data = await res.json();
    return data.topic;
  },

  async updateTopic(id: string, topicData: Partial<Topic> & { name: string }): Promise<Topic> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/topics/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify(topicData)
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update topic');
    }
    const data = await res.json();
    return data.topic;
  },

  async deleteTopic(id: string): Promise<{ success: boolean; message: string }> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/topics/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'x-admin-token': activeToken || ''
      }
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete topic');
    }
    return res.json();
  },

  async reorderTopics(ids: string[]): Promise<Topic[]> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/topics-reorder', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ ids })
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reorder topics');
    }
    const data = await res.json();
    return data.topics;
  },

  async assignPiecesToTopic(topicId: string, pieceIds: string[]): Promise<Topic> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/topics/${encodeURIComponent(topicId)}/pieces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ pieceIds })
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to assign pieces to topic');
    }
    const data = await res.json();
    return data.topic;
  },

  async getTopicAnalytics(options: { period?: string; startDate?: string; endDate?: string } = {}): Promise<TopicAnalyticsItem[]> {
    const activeToken = getWriterToken();
    const params = new URLSearchParams();
    if (options.period) params.append('period', options.period);
    if (options.startDate) params.append('startDate', options.startDate);
    if (options.endDate) params.append('endDate', options.endDate);

    const res = await fetch(`/api/admin/topics-analytics?${params.toString()}`, {
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) throw new Error('Failed to fetch topic analytics');
    return res.json();
  },

  async getArticle(id: string, token?: string): Promise<Article & { isUnlocked: boolean }> {
    const headers: Record<string, string> = {};
    if (token) {
      headers['x-download-token'] = token;
    }
    const adminToken = getWriterToken();
    if (adminToken) {
      headers['x-admin-token'] = adminToken;
    }

    const url = token ? `/api/articles/${id}?token=${encodeURIComponent(token)}` : `/api/articles/${id}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Failed to fetch piece');
    return res.json();
  },

  async getMpesaConfig(): Promise<MpesaConfig> {
    const res = await fetch('/api/mpesa/config');
    if (!res.ok) throw new Error('Failed to fetch M-Pesa configuration');
    return res.json();
  },

  async getExchangeRates(forceRefresh = false) {
    const url = forceRefresh ? '/api/exchange-rates?refresh=true' : '/api/exchange-rates';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch live exchange rates');
    return res.json();
  },

  async initiateStkPush(
    articleId: string, 
    phoneNumber: string, 
    amount: number, 
    isTip = false,
    currencyMeta?: {
      currency?: string;
      originalAmount?: number;
      exchangeRate?: number;
      exchangeRateTimestamp?: string;
    },
    affiliateMeta?: {
      affiliateCode?: string;
      campaignCode?: string;
    }
  ) {
    const ref = getActiveReferral();
    const res = await fetch('/api/mpesa/stkpush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        articleId, 
        phoneNumber, 
        amount, 
        isTip,
        currency: currencyMeta?.currency || 'KES',
        originalAmount: currencyMeta?.originalAmount || amount,
        exchangeRate: currencyMeta?.exchangeRate,
        exchangeRateTimestamp: currencyMeta?.exchangeRateTimestamp,
        affiliateCode: affiliateMeta?.affiliateCode || ref?.code,
        campaignCode: affiliateMeta?.campaignCode || ref?.campaign
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false || !data.checkoutRequestId) {
      const errorMsg = data.error || data.message || 'Safaricom M-Pesa rejected the payment request. Please verify your phone number.';
      throw new Error(errorMsg);
    }
    return data;
  },

  async queryPayment(checkoutRequestId: string): Promise<PaymentTransaction> {
    const res = await fetch(`/api/mpesa/query/${encodeURIComponent(checkoutRequestId)}`);
    if (!res.ok) throw new Error('Transaction query failed');
    return res.json();
  },

  async createBankOrder(data: {
    articleId: string;
    customerName?: string;
    email?: string;
    phoneNumber?: string;
    currency?: string;
    amount?: number;
    affiliateCode?: string;
    campaignCode?: string;
  }): Promise<{
    success: boolean;
    checkoutRequestId: string;
    bankReference: string;
    bankDetails: {
      bankName: string;
      accountName: string;
      accountNumber: string;
      branch: string;
      paybillAlternative: string;
      tillAlternative: string;
      referenceToInclude: string;
      amountKes: number;
    };
    message: string;
  }> {
    const ref = getActiveReferral();
    const payload = {
      ...data,
      affiliateCode: data.affiliateCode || ref?.code,
      campaignCode: data.campaignCode || ref?.campaign
    };
    const res = await fetch('/api/payments/bank-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to generate bank order');
    }
    return res.json();
  },

  async submitBankReference(checkoutRequestId: string, customerRef: string, senderPhone?: string): Promise<any> {
    const res = await fetch('/api/payments/bank-submit-ref', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkoutRequestId, customerRef, senderPhone })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to submit bank reference');
    }
    return res.json();
  },

  async getPaymentStatus(id: string): Promise<PaymentTransaction> {
    const res = await fetch(`/api/payments/status/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Payment status check failed');
    return res.json();
  },

  async confirmPaymentAsAdmin(id: string, receiptNumber?: string): Promise<{ success: boolean; transaction: PaymentTransaction; downloadToken?: string; message: string }> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/payments/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ receiptNumber })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to confirm payment');
    }
    return res.json();
  },

  async rejectPaymentAsAdmin(id: string): Promise<{ success: boolean; transaction: PaymentTransaction; message: string }> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/payments/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reject payment');
    }
    return res.json();
  },

  async payWithCard(data: {
    articleId?: string;
    cardNumber: string;
    cardExpiry: string;
    cardCvc: string;
    cardHolderName?: string;
    country?: string;
    email?: string;
    currency?: string;
    amount?: number;
    isTip?: boolean;
    affiliateCode?: string;
    campaignCode?: string;
  }): Promise<{
    success: boolean;
    status: string;
    receipt: string;
    downloadToken?: string;
    articleId?: string;
    amount: number;
    currency: string;
    amountKes: number;
    message: string;
  }> {
    const ref = getActiveReferral();
    const payload = {
      ...data,
      affiliateCode: data.affiliateCode || ref?.code,
      campaignCode: data.campaignCode || ref?.campaign
    };
    const res = await fetch('/api/payments/card-charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to process card payment');
    }
    return res.json();
  },



  async verifyPaymentByReference(referenceCode: string, phoneNumber?: string) {
    const res = await fetch('/api/mpesa/restore-purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        transactionCode: referenceCode, 
        phoneNumber
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Failed to verify payment reference');
    }
    const data = await res.json();
    return {
      verified: Boolean(data.success && data.downloadToken),
      articleId: data.articleId,
      articleTitle: data.articleTitle,
      token: data.downloadToken,
      receipt: data.receipt,
      message: data.message
    };
  },

  async verifyAccess(token: string, articleId?: string) {
    const url = articleId ? `/api/verify-access?token=${encodeURIComponent(token)}&articleId=${encodeURIComponent(articleId)}` : `/api/verify-access?token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Invalid or expired access token');
    }
    return res.json();
  },

  async verifyManualAccess(articleId: string, phone: string): Promise<{ 
    success: boolean; 
    verified: boolean; 
    activated?: boolean; 
    alreadyActivated?: boolean; 
    requiresAuth?: boolean; 
    isOriginalUser?: boolean; 
    token?: string; 
    articleId?: string; 
    articleTitle?: string; 
    boundUser?: { id: string; email: string; name?: string }; 
    error?: string; 
    message?: string 
  }> {
    const res = await fetch('/api/manual-access/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ articleId, phone })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.error || data.message || 'No manual access found for this phone number.');
      err.alreadyActivated = Boolean(data.alreadyActivated || res.status === 403);
      err.requiresAuth = Boolean(data.requiresAuth);
      err.data = data;
      throw err;
    }
    if (data.verified && data.token) {
      if (data.articleId) {
        savePurchasedToken(data.articleId, data.token, 'MANUAL-GRANT', phone);
      }
      if (articleId && articleId !== data.articleId) {
        savePurchasedToken(articleId, data.token, 'MANUAL-GRANT', phone);
      }
    }
    return data;
  },

  // Unified Authentication APIs (Clients & Admins)
  async authLogin(email: string, password: string): Promise<{ success: boolean; user?: any; message?: string; error?: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Authentication failed.');
    }
    if (data.success && data.user?.role === 'admin') {
      setWriterToken('cookie-session');
    }
    return data;
  },

  async authRegister(email: string, password: string, name?: string): Promise<{ success: boolean; user?: any; message?: string; error?: string }> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, name })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Account registration failed.');
    }
    return data;
  },

  async authGetMe(): Promise<{ authenticated: boolean; user: any | null }> {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) {
        clearWriterToken();
        return { authenticated: false, user: null };
      }
      const data = await res.json();
      if (data.authenticated && data.user?.role === 'admin') {
        setWriterToken('cookie-session');
      } else {
        clearWriterToken();
      }
      return data;
    } catch {
      return { authenticated: false, user: null };
    }
  },

  async authLogout(): Promise<{ success: boolean }> {
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      clearWriterToken();
      return res.json();
    } catch {
      clearWriterToken();
      return { success: true };
    }
  },

  // Backward compatibility alias for Writer login
  async adminLogin(passkey: string): Promise<{ success: boolean; token?: string; message: string }> {
    return { success: false, message: "Please use email and password on the unified Sign-In page." };
  },

  async adminVerifySession(token?: string): Promise<boolean> {
    try {
      const activeToken = token || getWriterToken();
      const headers: Record<string, string> = {};
      if (activeToken) {
        headers['x-admin-token'] = activeToken;
        headers['Authorization'] = `Bearer ${activeToken}`;
      }
      const res = await fetch('/api/admin/verify', {
        headers,
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        return Boolean(data?.valid);
      }
      return false;
    } catch {
      return false;
    }
  },

  async adminLogout(): Promise<void> {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // ignore
    }
    clearWriterToken();
  },

  async getDashboardStats(token?: string): Promise<DashboardStats> {
    const activeToken = token || getWriterToken();
    const headers: Record<string, string> = {};
    if (activeToken) headers['x-admin-token'] = activeToken;
    const res = await fetch('/api/admin/stats', {
      headers,
      credentials: 'include'
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) throw new Error('Failed to load dashboard metrics');
    return res.json();
  },

  async getAdminArticles(token?: string): Promise<Article[]> {
    const activeToken = token || getWriterToken();
    const res = await fetch('/api/admin/articles', {
      headers: getAdminHeaders(activeToken ? { 'x-admin-token': activeToken } : {}),
      credentials: 'include'
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) throw new Error('Failed to load pieces');
    return res.json();
  },

  async getAdminArticle(id: string, token?: string): Promise<Article> {
    const activeToken = token || getWriterToken();
    const res = await fetch(`/api/admin/articles/${id}`, {
      headers: getAdminHeaders(activeToken ? { 'x-admin-token': activeToken } : {}),
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to load piece');
    return res.json();
  },

  async createArticle(data: Partial<Article>, token?: string): Promise<{ success: boolean; article: Article }> {
    const activeToken = token || getWriterToken();
    const res = await fetch('/api/admin/articles', {
      method: 'POST',
      headers: getAdminHeaders({
        'Content-Type': 'application/json',
        ...(activeToken ? { 'x-admin-token': activeToken } : {})
      }),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create piece');
    }
    return res.json();
  },

  async updateArticle(id: string, data: Partial<Article>, token?: string): Promise<{ success: boolean; article: Article }> {
    const activeToken = token || getWriterToken();
    const res = await fetch(`/api/admin/articles/${id}`, {
      method: 'PUT',
      headers: getAdminHeaders({
        'Content-Type': 'application/json',
        ...(activeToken ? { 'x-admin-token': activeToken } : {})
      }),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update piece');
    }
    return res.json();
  },

  async togglePublish(id: string, token?: string): Promise<{ success: boolean; article: Article }> {
    const activeToken = token || getWriterToken();
    const res = await fetch(`/api/admin/articles/${id}/toggle-publish`, {
      method: 'POST',
      headers: getAdminHeaders(activeToken ? { 'x-admin-token': activeToken } : {}),
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to toggle publishing status');
    return res.json();
  },

  async deleteArticle(id: string, token?: string): Promise<boolean> {
    const activeToken = token || getWriterToken();
    const res = await fetch(`/api/admin/articles/${id}`, {
      method: 'DELETE',
      headers: getAdminHeaders(activeToken ? { 'x-admin-token': activeToken } : {}),
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to delete piece');
    return true;
  },

  async getAdminTransactions(token?: string, filter?: { type?: string; status?: string }): Promise<{ totalRevenueKes: number; count: number; transactions: PaymentTransaction[] }> {
    const activeToken = token || getWriterToken();
    let url = '/api/admin/transactions';
    const params = new URLSearchParams();
    if (filter?.type) params.append('type', filter.type);
    if (filter?.status) params.append('status', filter.status);
    if (params.toString()) url += `?${params.toString()}`;

    const res = await fetch(url, {
      headers: getAdminHeaders(activeToken ? { 'x-admin-token': activeToken } : {}),
      credentials: 'include'
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired.');
    }
    if (!res.ok) throw new Error('Failed to fetch transactions');
    return res.json();
  },

  async getAdminTips(token?: string): Promise<{ totalTipsKes: number; count: number; verifiedCount: number; tips: PaymentTransaction[] }> {
    const activeToken = token || getWriterToken();
    const res = await fetch('/api/admin/tips', {
      headers: getAdminHeaders(activeToken ? { 'x-admin-token': activeToken } : {}),
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to fetch tips');
    return res.json();
  },

  async updateAuthorProfile(data: Partial<AuthorProfile>, token?: string): Promise<AuthorProfile> {
    const activeToken = token || getWriterToken();
    const res = await fetch('/api/admin/author', {
      method: 'PUT',
      headers: getAdminHeaders({
        'Content-Type': 'application/json',
        ...(activeToken ? { 'x-admin-token': activeToken } : {})
      }),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update author profile');
    const json = await res.json();
    return json.author;
  },

  async uploadImage(
    dataUrl: string, 
    target?: 'author_avatar' | 'author_cover' | 'welcome_background' | 'favicon' | 'logo' | 'piece_cover', 
    articleId?: string,
    prefix?: string
  ): Promise<{ success: boolean; url: string; record?: any; message?: string }> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/upload-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ dataUrl, target, articleId, prefix })
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload image.');
    }
    return res.json();
  },

  async savePermanentImage(
    target: 'author_avatar' | 'author_cover' | 'welcome_background' | 'favicon' | 'logo' | 'piece_cover',
    imageUrl: string,
    articleId?: string,
    extraData?: {
      dataUrl?: string;
      cropSettings?: any;
      originalUrl?: string;
    }
  ): Promise<{ success: boolean; url: string; record?: any; message: string; savedPermanently: boolean; savedAt: string }> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/save-permanent-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({
        target,
        imageUrl,
        articleId,
        dataUrl: extraData?.dataUrl,
        cropSettings: extraData?.cropSettings,
        originalUrl: extraData?.originalUrl
      })
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save image permanently.');
    }
    return res.json();
  },

  async removeImage(
    target: 'author_avatar' | 'author_cover' | 'welcome_background' | 'favicon' | 'logo' | 'piece_cover', 
    articleId?: string
  ): Promise<{ success: boolean; record?: any; message?: string }> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/remove-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ target, articleId })
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to remove image.');
    }
    return res.json();
  },

  async getAdminMpesaConfig(): Promise<{ success: boolean; config: MpesaConfig }> {
    const activeToken = getWriterToken();
    return safeFetchJson<{ success: boolean; config: MpesaConfig }>(
      '/api/admin/mpesa/config',
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load M-Pesa settings.'
    );
  },

  async updateMpesaConfig(data: Partial<MpesaConfig>, token?: string): Promise<MpesaConfig> {
    const activeToken = token || getWriterToken();
    const json = await safeFetchJson<{ success: boolean; config: MpesaConfig }>(
      '/api/admin/mpesa/config',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify(data)
      },
      'Failed to update M-Pesa settings.'
    );
    return json.config;
  },

  async testMpesaConnection(data?: { consumerKey?: string; consumerSecret?: string; env?: 'sandbox' | 'production' }): Promise<{ success: boolean; message: string; env?: string }> {
    const activeToken = getWriterToken();
    return safeFetchJson<{ success: boolean; message: string; env?: string }>(
      '/api/admin/mpesa/test-connection',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify(data || {})
      },
      'Failed to test M-Pesa Daraja connection.'
    );
  },

  async aiAssist(prompt: string, currentDraft: string, mode: string, token?: string): Promise<string> {
    const activeToken = token || getWriterToken();
    const res = await fetch('/api/admin/ai-assist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ prompt, currentDraft, mode })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to get AI editorial assistance');
    }
    const json = await res.json();
    return json.result;
  },

  async checkMpesaStatus(checkoutRequestId: string): Promise<any> {
    const res = await fetch(`/api/mpesa/status/${encodeURIComponent(checkoutRequestId)}`);
    if (!res.ok) throw new Error('Status check failed');
    return res.json();
  },

  async testMpesaStk(phone: string, amount: number): Promise<any> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/mpesa/test-stk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ phone, amount })
    });
    if (!res.ok) throw new Error('Test STK failed');
    return res.json();
  },

  async uploadPiece(data: any): Promise<any> {
    return this.createArticle(data);
  },

  async resetDefaultArticles(): Promise<any> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/reset-defaults', {
      method: 'POST',
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) throw new Error('Reset failed');
    return res.json();
  },

  async clearAllArticles(): Promise<any> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/clear-all', {
      method: 'POST',
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) throw new Error('Clear failed');
    return res.json();
  },

  // Homepage Management APIs
  async getHomepageData(): Promise<{
    config: any;
    mostSellingPieces: Article[];
    pieceOfTheWeek?: Article;
  }> {
    const res = await fetch('/api/homepage');
    if (!res.ok) throw new Error('Failed to load homepage data');
    return res.json();
  },

  async getAdminHomepageData(): Promise<{
    config: any;
    mostSellingPieces: Article[];
    pieceOfTheWeek?: Article;
    allPublishedPieces: Article[];
  }> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/homepage', {
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) throw new Error('Failed to load admin homepage data');
    return res.json();
  },

  async saveAdminHomepageData(data: any): Promise<any> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/homepage', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save homepage settings');
    }
    return res.json();
  },

  // Revisions & Autosave
  async getArticleRevisions(articleId: string) {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/articles/${articleId}/revisions`, {
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) throw new Error('Failed to load revisions');
    return res.json();
  },

  async restoreArticleRevision(articleId: string, revisionId: string) {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/articles/${articleId}/revisions/restore/${revisionId}`, {
      method: 'POST',
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to restore revision');
    }
    return res.json();
  },

  async autosaveArticle(articleId: string, data: Partial<Article>) {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/articles/${articleId}/autosave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Autosave failed');
    return res.json();
  },

  // Reader Interaction Tracking
  async trackInteraction(
    eventType: 'view' | 'preview_read' | 'unlock_start' | 'unlock_complete' | 'tip_start' | 'tip_complete',
    articleId?: string,
    category?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const readerHash = getAnonymousReaderId();
      await fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          articleId,
          category,
          readerHash,
          metadata
        })
      });
    } catch {
      // Non-blocking telemetry
    }
  },

  // Detailed Analytics with Period Filtering
  async getDetailedAnalytics(
    period: 'today' | '7d' | '30d' | '90d' | 'this_year' | 'all_time' | 'custom' = '30d',
    startDate?: string,
    endDate?: string
  ): Promise<DetailedAnalytics> {
    const activeToken = getWriterToken();
    const params = new URLSearchParams();
    if (period) params.append('period', period);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const res = await fetch(`/api/admin/analytics?${params.toString()}`, {
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (res.status === 401 || res.status === 403) {
      clearWriterToken();
      throw new Error('Writer session expired. Please log in again.');
    }
    if (!res.ok) throw new Error('Failed to load detailed analytics');
    return res.json();
  },

  // Export Transactions CSV
  async exportTransactionsCsv(filter?: { type?: string; status?: string }) {
    const activeToken = getWriterToken();
    const params = new URLSearchParams();
    if (filter?.type) params.append('type', filter.type);
    if (filter?.status) params.append('status', filter.status);

    const url = `/api/admin/transactions/export?${params.toString()}`;
    const res = await fetch(url, {
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) throw new Error('Failed to export transactions CSV');
    
    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `ink-and-witness-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
    return true;
  },

  // Reader Licenses
  async getReaderLicenses(): Promise<{ count: number; licenses: ReaderLicense[] }> {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {};
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const res = await fetch('/api/admin/readers', {
      headers,
      credentials: 'include'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to load reader licenses');
    }
    return res.json();
  },

  async grantReaderLicense(data: { articleId: string; phone: string; receipt?: string; durationDays?: number }) {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const res = await fetch('/api/admin/readers/grant', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to grant reader license');
    }
    return res.json();
  },

  async revokeReaderLicense(token: string) {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {};
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const res = await fetch(`/api/admin/readers/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers,
      credentials: 'include'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to revoke reader license');
    }
    return res.json();
  },

  async getManualAccessGrants(articleId?: string) {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {};
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const url = articleId ? `/api/admin/manual-access?articleId=${encodeURIComponent(articleId)}` : '/api/admin/manual-access';
    const res = await fetch(url, { headers, credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch manual access grants');
    }
    return res.json();
  },

  async grantManualAccess(data: { articleId: string; phone: string; notes?: string; grantedBy?: string }) {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const res = await fetch('/api/admin/manual-access/grant', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to grant manual access');
    }
    return res.json();
  },

  async revokeManualAccess(grantId: string) {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const res = await fetch('/api/admin/manual-access/revoke', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ grantId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to revoke manual access grant');
    }
    return res.json();
  },

  async deleteManualAccess(grantId: string) {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const res = await fetch('/api/admin/manual-access/delete', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ grantId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete manual access grant');
    }
    return res.json();
  },

  async resetManualAccess(grantId: string) {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const res = await fetch('/api/admin/manual-access/reset', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ grantId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reset manual access');
    }
    return res.json();
  },

  // Export JSON Backup
  async downloadBackupJson() {
    const activeToken = getWriterToken();
    const headers: Record<string, string> = {};
    if (activeToken) {
      headers['x-admin-token'] = activeToken;
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    const res = await fetch('/api/admin/export', {
      headers,
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to export backup');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ink-and-witness-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  },

  // Snapshots & Rollback Recovery
  async getSnapshots(): Promise<{ success: boolean; snapshots: Array<{ filename: string; sizeBytes: number; createdAt: string; formattedDate: string }> }> {
    return safeFetchJson('/api/admin/backups', {
      headers: getAdminHeaders(),
      credentials: 'include'
    });
  },

  async createSnapshot(reason = 'manual_admin'): Promise<{ success: boolean; filename: string; timestamp: string; piecesCount: number }> {
    return safeFetchJson('/api/admin/backups/snapshot', {
      method: 'POST',
      headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reason }),
      credentials: 'include'
    });
  },

  async savePermanently(reason = 'author_portal_save_permanently'): Promise<{
    success: boolean;
    timestamp: string;
    piecesCount: number;
    snapshotFilename: string;
    message: string;
  }> {
    return safeFetchJson('/api/admin/save-permanently', {
      method: 'POST',
      headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reason }),
      credentials: 'include'
    });
  },

  async restoreSnapshot(payload: { filename?: string; archive?: any }): Promise<{ success: boolean; message: string; piecesCount: number }> {
    return safeFetchJson('/api/admin/backups/restore', {
      method: 'POST',
      headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      credentials: 'include'
    });
  },

  // Reader Engagement: Likes
  async getPieceLikes(articleId: string): Promise<{ articleId: string; likesCount: number; hasLiked: boolean }> {
    const readerHash = getAnonymousReaderId();
    const res = await fetch(`/api/articles/${encodeURIComponent(articleId)}/like?readerHash=${encodeURIComponent(readerHash)}`);
    if (!res.ok) throw new Error('Failed to get likes count');
    return res.json();
  },

  async togglePieceLike(articleId: string): Promise<{ success: boolean; articleId: string; liked: boolean; likesCount: number }> {
    const readerHash = getAnonymousReaderId();
    const res = await fetch(`/api/articles/${encodeURIComponent(articleId)}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readerHash })
    });
    if (!res.ok) throw new Error('Failed to toggle like');
    return res.json();
  },

  // Reader Engagement: Comments
  async getPieceComments(articleId: string): Promise<PieceComment[]> {
    const res = await fetch(`/api/articles/${encodeURIComponent(articleId)}/comments`);
    if (!res.ok) throw new Error('Failed to get comments');
    return res.json();
  },

  async submitPieceComment(articleId: string, content: string, readerName: string, readerEmail?: string): Promise<PieceComment> {
    const readerHash = getAnonymousReaderId();
    const res = await fetch(`/api/articles/${encodeURIComponent(articleId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, readerName, readerEmail, readerHash })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to submit comment');
    }
    const data = await res.json();
    return data.comment;
  },

  async reportComment(commentId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (!res.ok) throw new Error('Failed to report comment');
    return res.json();
  },

  async deleteOwnComment(commentId: string): Promise<{ success: boolean }> {
    const readerHash = getAnonymousReaderId();
    const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readerHash })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete comment');
    }
    return res.json();
  },

  // Writer Comments Moderation
  async getAdminComments(): Promise<{ count: number; comments: PieceComment[] }> {
    const activeToken = getWriterToken();
    const res = await fetch('/api/admin/comments', {
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) throw new Error('Failed to fetch comments');
    return res.json();
  },

  async updateAdminCommentStatus(commentId: string, status: 'approved' | 'hidden' | 'deleted'): Promise<PieceComment> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/comments/${encodeURIComponent(commentId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': activeToken || ''
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed to update comment status');
    const data = await res.json();
    return data.comment;
  },

  async deleteAdminComment(commentId: string): Promise<{ success: boolean }> {
    const activeToken = getWriterToken();
    const res = await fetch(`/api/admin/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': activeToken || '' }
    });
    if (!res.ok) throw new Error('Failed to delete comment');
    return res.json();
  },

  // ==========================================
  // AFFILIATE PORTAL CLIENT METHODS
  // ==========================================

  async affiliateRegister(data: {
    name: string;
    email: string;
    phone: string;
    password: string;
    payoutMethod: 'mpesa' | 'bank' | 'paypal';
    payoutDetails: {
      mpesaPhone?: string;
      mpesaName?: string;
      bankName?: string;
      bankAccountName?: string;
      bankAccountNumber?: string;
      bankBranch?: string;
      paypalEmail?: string;
    };
    preferredCode?: string;
    acceptedTerms: boolean;
    termsVersion?: string;
  }): Promise<{ success: boolean; affiliate: AffiliateAccount; message: string }> {
    const result = await safeFetchJson<{ success: boolean; affiliate: AffiliateAccount; message: string }>(
      '/api/affiliate/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      'Failed to register affiliate account. Please check your details and try again.'
    );
    if (result.success) {
      setAffiliateToken('cookie-session');
    }
    return result;
  },

  async acceptAffiliateTerms(data?: { termsVersion?: string }): Promise<{ success: boolean; message: string; affiliate: AffiliateAccount; dashboard: AffiliateDashboardData }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to accept the affiliate terms.');
    return safeFetchJson(
      '/api/affiliate/accept-terms',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-affiliate-token': token
        },
        body: JSON.stringify(data || { termsVersion: '2026.1' })
      },
      'Failed to accept Affiliate Programme Terms & Conditions.'
    );
  },

  async affiliateLogin(data: { emailOrCode: string; password: string }): Promise<{ success: boolean; affiliate: AffiliateAccount }> {
    const result = await safeFetchJson<{ success: boolean; affiliate: AffiliateAccount }>(
      '/api/affiliate/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      'Invalid affiliate credentials. Please check your email or affiliate code.'
    );
    if (result.success) {
      setAffiliateToken('cookie-session');
    }
    return result;
  },

  async affiliateLogout(): Promise<void> {
    const token = getAffiliateToken();
    if (token) {
      try {
        await safeFetchJson('/api/affiliate/logout', {
          method: 'POST',
          headers: { 'x-affiliate-token': token }
        });
      } catch {
        // ignore
      }
    }
    clearAffiliateToken();
  },

  async getAffiliateDashboard(): Promise<AffiliateDashboardData> {
    const token = getAffiliateToken();
    if (!token) {
      throw new Error('Please log in to access the affiliate dashboard.');
    }
    return safeFetchJson<AffiliateDashboardData>(
      '/api/affiliate/dashboard',
      {
        headers: { 'x-affiliate-token': token }
      },
      "We're temporarily unable to load your affiliate dashboard. Please refresh or try again shortly."
    );
  },

  async getAffiliatePayoutSettings(): Promise<{
    success: boolean;
    payoutSettings: any;
    availableBalance: number;
    minThreshold: number;
    payoutMethod: string;
    payoutDetails: any;
    affiliate: AffiliateAccount;
  }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to view payout settings.');
    return safeFetchJson(
      '/api/affiliate/payout-settings',
      {
        headers: { 'x-affiliate-token': token }
      },
      "We're temporarily unable to load your payout settings. Please refresh the page or try again shortly."
    );
  },

  async getAffiliateProfile(): Promise<{
    success: boolean;
    payoutSettings: any;
    availableBalance: number;
    minThreshold: number;
    payoutMethod: string;
    payoutDetails: any;
    affiliate: AffiliateAccount;
  }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to view your profile.');
    return safeFetchJson(
      '/api/affiliate/profile',
      {
        headers: { 'x-affiliate-token': token }
      },
      "We're temporarily unable to load your profile. Please refresh or try again shortly."
    );
  },

  async updateAffiliateProfile(data: {
    name?: string;
    phone?: string;
    payoutMethod?: 'mpesa' | 'bank' | 'paypal';
    payoutDetails?: {
      mpesaPhone?: string;
      mpesaName?: string;
      bankName?: string;
      bankAccountName?: string;
      bankAccountNumber?: string;
      bankBranch?: string;
      paypalEmail?: string;
    };
  }): Promise<{ success: boolean; affiliate: AffiliateAccount; message?: string }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to update your profile.');
    return safeFetchJson(
      '/api/affiliate/profile',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-affiliate-token': token
        },
        body: JSON.stringify(data)
      },
      'Failed to update affiliate profile and payout preferences.'
    );
  },

  async saveAffiliatePayoutSettings(data: {
    payoutMethod: 'mpesa' | 'bank' | 'paypal';
    payoutDetails: any;
  }): Promise<{ success: boolean; message?: string }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to update payout settings.');
    return safeFetchJson(
      '/api/affiliate/payout-settings',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-affiliate-token': token
        },
        body: JSON.stringify(data)
      },
      'Failed to update payout settings.'
    );
  },

  async changeAffiliatePassword(data: { currentPassword: string; newPassword: string }): Promise<{ success: boolean; message: string }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to change your password.');
    return safeFetchJson(
      '/api/affiliate/change-password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-affiliate-token': token
        },
        body: JSON.stringify(data)
      },
      'Failed to change password. Please verify your current password and try again.'
    );
  },

  async requestAffiliatePayout(data: {
    amount: number;
    payoutMethod: 'mpesa' | 'bank' | 'paypal';
    payoutDetails: any;
    notes?: string;
  }): Promise<{ success: boolean; payout: AffiliatePayoutRequest; message: string }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to request a payout.');
    return safeFetchJson(
      '/api/affiliate/request-payout',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-affiliate-token': token
        },
        body: JSON.stringify(data)
      },
      'Failed to request payout. Please ensure you meet the minimum threshold.'
    );
  },

  async getAffiliateSales(): Promise<{ success: boolean; sales: AffiliateSaleCommission[] }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to view sales.');
    return safeFetchJson(
      '/api/affiliate/sales',
      {
        headers: { 'x-affiliate-token': token }
      },
      'Failed to load sales ledger.'
    );
  },

  async getAffiliatePayouts(): Promise<{
    success: boolean;
    availableBalanceKes: number;
    pendingBalanceKes: number;
    paidBalanceKes: number;
    minThresholdKes: number;
    payouts: AffiliatePayoutRequest[];
  }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to view payouts.');
    return safeFetchJson(
      '/api/affiliate/payouts',
      {
        headers: { 'x-affiliate-token': token }
      },
      'Failed to load payout history.'
    );
  },

  async getAffiliateLinks(): Promise<{
    success: boolean;
    affiliateCode: string;
    linksDisabled: boolean;
    commissionRate: number;
    attributionDays: number;
    campaigns: AffiliateCampaign[];
  }> {
    const token = getAffiliateToken();
    if (!token) throw new Error('Please log in to view links.');
    return safeFetchJson(
      '/api/affiliate/links',
      {
        headers: { 'x-affiliate-token': token }
      },
      'Failed to load affiliate links.'
    );
  },

  async validateReferralCode(code: string): Promise<{ valid: boolean; code?: string; name?: string; affiliateName?: string; commissionRate?: number }> {
    try {
      return await safeFetchJson(`/api/affiliate/validate/${encodeURIComponent(code)}`);
    } catch {
      return { valid: false };
    }
  },

  async registerReferralClick(data: { ref: string; articleId?: string; campaign?: string }): Promise<{ success: boolean; affiliateName?: string }> {
    try {
      return await safeFetchJson(
        '/api/affiliate/click',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }
      );
    } catch {
      return { success: false };
    }
  },

  // ==========================================
  // WRITER ADMIN AFFILIATE MANAGEMENT METHODS
  // ==========================================

  async getAdminAffiliatesSummary(): Promise<AdminAffiliatesSummary> {
    const activeToken = getWriterToken();
    return safeFetchJson<AdminAffiliatesSummary>(
      '/api/admin/affiliates/summary',
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load affiliates summary.'
    );
  },

  async getAdminAffiliates(status?: string): Promise<{ affiliates: AffiliateAccount[] }> {
    const activeToken = getWriterToken();
    const url = status ? `/api/admin/affiliates?status=${encodeURIComponent(status)}` : '/api/admin/affiliates';
    const data = await safeFetchJson<any>(
      url,
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load affiliates list.'
    );
    if (Array.isArray(data)) {
      return { affiliates: data };
    }
    return data && data.affiliates ? data : { affiliates: [] };
  },

  async getAdminAffiliateDetails(id: string): Promise<{ affiliate: AffiliateAccount; sales: AffiliateSaleCommission[]; payouts: AffiliatePayoutRequest[] }> {
    const activeToken = getWriterToken();
    const data = await safeFetchJson<any>(
      `/api/admin/affiliates/${encodeURIComponent(id)}`,
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load affiliate details.'
    );
    return {
      affiliate: data.affiliate,
      sales: data.sales || data.commissions || [],
      payouts: data.payouts || []
    };
  },

  async createAdminAffiliate(data: Partial<AffiliateAccount> & { name: string; email: string; phone?: string; password?: string }): Promise<{ success: boolean; affiliate: AffiliateAccount }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      '/api/admin/affiliates',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify(data)
      },
      'Failed to create affiliate account.'
    );
  },

  async updateAdminAffiliate(id: string, data: Partial<AffiliateAccount>): Promise<{ success: boolean; affiliate: AffiliateAccount }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      `/api/admin/affiliates/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify(data)
      },
      'Failed to update affiliate.'
    );
  },

  async deleteAdminAffiliate(id: string): Promise<{ success: boolean; message: string }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      `/api/admin/affiliates/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to delete affiliate.'
    );
  },

  async setAdminAffiliateStatus(id: string, status: 'active' | 'suspended' | 'pending', reason?: string): Promise<{ success: boolean; affiliate: AffiliateAccount }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      `/api/admin/affiliates/${encodeURIComponent(id)}/status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify({ status, reason })
      },
      'Failed to update affiliate status.'
    );
  },

  async toggleAdminAffiliateLinks(id: string, disabled: boolean): Promise<{ success: boolean; affiliate: AffiliateAccount }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      `/api/admin/affiliates/${encodeURIComponent(id)}/links-toggle`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify({ disabled })
      },
      'Failed to toggle affiliate links.'
    );
  },

  async resetAdminAffiliatePassword(id: string, newPassword?: string): Promise<{ success: boolean; temporaryPassword?: string; message: string }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      `/api/admin/affiliates/${encodeURIComponent(id)}/reset-password`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify({ newPassword })
      },
      'Failed to reset affiliate password.'
    );
  },

  async getAdminAffiliateCommissions(filter?: { affiliateId?: string; status?: string }): Promise<{ commissions: AffiliateSaleCommission[] }> {
    const activeToken = getWriterToken();
    const params = new URLSearchParams();
    if (filter?.affiliateId) params.append('affiliateId', filter.affiliateId);
    if (filter?.status) params.append('status', filter.status);

    const data = await safeFetchJson<any>(
      `/api/admin/affiliates/commissions?${params.toString()}`,
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load commissions ledger.'
    );
    if (Array.isArray(data)) {
      return { commissions: data };
    }
    return data && data.commissions ? data : { commissions: [] };
  },

  async updateAdminAffiliateCommissionStatus(id: string, status: 'verified' | 'pending' | 'reversed' | 'paid', reason?: string): Promise<{ success: boolean; commission: AffiliateSaleCommission }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      `/api/admin/affiliates/commissions/${encodeURIComponent(id)}/status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify({ status, reason })
      },
      'Failed to update commission status.'
    );
  },

  async getAdminAffiliatePayouts(status?: string): Promise<{ payouts: AffiliatePayoutRequest[] }> {
    const activeToken = getWriterToken();
    const url = status ? `/api/admin/affiliates/payouts?status=${encodeURIComponent(status)}` : '/api/admin/affiliates/payouts';
    const data = await safeFetchJson<any>(
      url,
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load payouts.'
    );
    if (Array.isArray(data)) {
      return { payouts: data };
    }
    return data && data.payouts ? data : { payouts: [] };
  },

  async processAdminAffiliatePayout(id: string, action: 'approve' | 'pay' | 'reject', paymentReference?: string, notes?: string): Promise<{ success: boolean; payout: AffiliatePayoutRequest; message: string }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      `/api/admin/affiliates/payouts/${encodeURIComponent(id)}/process`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify({ action, paymentReference, notes })
      },
      'Failed to process payout.'
    );
  },

  async getAdminAffiliateCampaigns(): Promise<{ campaigns: AffiliateCampaign[] }> {
    const activeToken = getWriterToken();
    const data = await safeFetchJson<any>(
      '/api/admin/affiliates/campaigns',
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load affiliate campaigns.'
    );
    if (Array.isArray(data)) {
      return { campaigns: data };
    }
    return data && data.campaigns ? data : { campaigns: [] };
  },

  async saveAdminAffiliateCampaign(data: Partial<AffiliateCampaign> & { code: string; name: string }): Promise<{ success: boolean; campaign: AffiliateCampaign }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      '/api/admin/affiliates/campaigns',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify(data)
      },
      'Failed to save affiliate campaign.'
    );
  },

  async deleteAdminAffiliateCampaign(id: string): Promise<{ success: boolean; message: string }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      `/api/admin/affiliates/campaigns/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to delete campaign.'
    );
  },

  async getAdminAffiliateSettings(): Promise<AffiliateSettings> {
    const activeToken = getWriterToken();
    return safeFetchJson<AffiliateSettings>(
      '/api/admin/affiliates/settings',
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load affiliate settings.'
    );
  },

  async saveAdminAffiliateSettings(data: Partial<AffiliateSettings>): Promise<{ success: boolean; settings: AffiliateSettings }> {
    const activeToken = getWriterToken();
    return safeFetchJson(
      '/api/admin/affiliates/settings',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': activeToken || ''
        },
        body: JSON.stringify(data)
      },
      'Failed to save affiliate settings.'
    );
  },

  async getAdminAffiliateAuditLogs(limit = 100): Promise<{ logs: AffiliateAuditLogEntry[] }> {
    const activeToken = getWriterToken();
    const data = await safeFetchJson<any>(
      `/api/admin/affiliates/audit-logs?limit=${limit}`,
      {
        headers: { 'x-admin-token': activeToken || '' }
      },
      'Failed to load affiliate audit logs.'
    );
    if (Array.isArray(data)) {
      return { logs: data };
    }
    return data && data.logs ? data : { logs: [] };
  }
};
