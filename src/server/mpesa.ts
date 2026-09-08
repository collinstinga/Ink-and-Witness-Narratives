import crypto from 'crypto';
import { getMpesaRequestLockId, store, type MpesaCallbackIntent } from './store.js';
import { MpesaConfig, PaymentTransaction } from '../types.js';
import {
  attachCallbackCapability,
  generatePaymentAttemptId,
  generatePaymentCapability,
  hashPaymentCapability,
  verifyPaymentCapability
} from './paymentSecurity.js';

/**
 * Safaricom Daraja Production M-Pesa Service
 * Clean, Authoritative, Server-Side Controlled Implementation
 */

const DARAJA_PRODUCTION_URL = 'https://api.safaricom.co.ke';
const VALID_TRANSACTION_TYPES = new Set(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']);

type MpesaRailSettings = Partial<MpesaConfig> & { transactionType?: string };

export interface ResolvedMpesaPaymentRail {
  paymentType: 'till' | 'paybill';
  transactionType: 'CustomerBuyGoodsOnline' | 'CustomerPayBillOnline';
  businessShortCode: string;
  partyB: string;
}

function normalizePaymentType(value: unknown): 'till' | 'paybill' | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'till' || normalized === 'customerbuygoodsonline') return 'till';
  if (normalized === 'paybill' || normalized === 'customerpaybillonline') return 'paybill';
  return undefined;
}

export function resolveMpesaPaymentRail(
  settings: MpesaRailSettings,
  environment: Record<string, string | undefined> = process.env
): ResolvedMpesaPaymentRail {
  const envTransactionType = String(environment.MPESA_TRANSACTION_TYPE || '').trim();
  const storedTransactionType = String(settings.transactionType || '').trim();
  const envPaymentType = normalizePaymentType(environment.MPESA_PAYMENT_TYPE);
  const storedPaymentType = normalizePaymentType(settings.paymentType);

  if (environment.MPESA_PAYMENT_TYPE && !envPaymentType) {
    throw new Error('MPESA_PAYMENT_TYPE must be till or paybill.');
  }
  if (envTransactionType && !VALID_TRANSACTION_TYPES.has(envTransactionType)) {
    throw new Error('MPESA_TRANSACTION_TYPE must be CustomerBuyGoodsOnline or CustomerPayBillOnline.');
  }
  if (!envTransactionType && storedTransactionType && !VALID_TRANSACTION_TYPES.has(storedTransactionType)) {
    throw new Error('The saved M-Pesa transaction type is unsupported.');
  }

  const transactionType = (
    envTransactionType ||
    (envPaymentType === 'paybill' ? 'CustomerPayBillOnline' : envPaymentType === 'till' ? 'CustomerBuyGoodsOnline' : '') ||
    storedTransactionType ||
    (storedPaymentType === 'paybill' ? 'CustomerPayBillOnline' : 'CustomerBuyGoodsOnline')
  ) as ResolvedMpesaPaymentRail['transactionType'];
  const paymentType: ResolvedMpesaPaymentRail['paymentType'] = transactionType === 'CustomerPayBillOnline'
    ? 'paybill'
    : 'till';

  if (envTransactionType && envPaymentType && envPaymentType !== paymentType) {
    throw new Error('MPESA_PAYMENT_TYPE conflicts with MPESA_TRANSACTION_TYPE.');
  }
  if (!envTransactionType && !envPaymentType && storedTransactionType && storedPaymentType && storedPaymentType !== paymentType) {
    throw new Error('The saved M-Pesa payment type conflicts with its transaction type. Save the intended rail again.');
  }

  const shortcode = String(environment.MPESA_SHORTCODE || settings.shortcode || '').trim();
  const storeNumber = String(environment.MPESA_STORE_NUMBER || settings.storeNumber || shortcode).trim();
  const tillNumber = String(environment.MPESA_TILL_NUMBER || settings.tillNumber || '').trim();
  const paybillNumber = String(environment.MPESA_PAYBILL_NUMBER || settings.paybillNumber || shortcode).trim();
  const businessShortCode = paymentType === 'till' ? storeNumber : paybillNumber;
  const partyB = paymentType === 'till' ? tillNumber : businessShortCode;

  if (!/^\d{5,10}$/.test(businessShortCode)) {
    throw new Error(paymentType === 'till'
      ? 'M-Pesa Buy Goods requires a valid numeric Store/Head Office number.'
      : 'M-Pesa PayBill requires a valid numeric business number.');
  }
  if (!/^\d{5,10}$/.test(partyB)) {
    throw new Error('M-Pesa Buy Goods requires a valid numeric Till number.');
  }

  return { paymentType, transactionType, businessShortCode, partyB };
}

export function createDarajaTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

export function resolveDarajaCallbackUrl(value: string): string {
  const raw = (value || '').trim();
  if (!raw) {
    throw new Error('MPESA_CALLBACK_URL or APP_URL must be configured for live M-Pesa payments.');
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const callback = new URL(candidate);
  if (callback.protocol !== 'https:') {
    throw new Error('The M-Pesa callback URL must use HTTPS.');
  }
  if (callback.username || callback.password) {
    throw new Error('The M-Pesa callback URL must not contain credentials.');
  }
  // The apex site redirects to www. Daraja callbacks must target the final
  // application host directly because a redirect can discard the callback.
  if (callback.hostname.toLowerCase() === 'inkandwitness-narratives.co.ke') {
    callback.hostname = 'www.inkandwitness-narratives.co.ke';
  }
  if (!callback.pathname || callback.pathname === '/') {
    callback.pathname = '/api/mpesa/callback';
  }
  if (callback.pathname !== '/api/mpesa/callback') {
    throw new Error('The M-Pesa callback URL must use the /api/mpesa/callback endpoint.');
  }
  if (callback.search) {
    throw new Error('The configured M-Pesa callback URL must not contain query parameters.');
  }
  callback.hash = '';
  return callback.toString();
}

// In-Memory Token & Query Caches
interface TokenCache {
  token: string;
  expiresAt: number;
}
const tokenCache: Record<string, TokenCache> = {};
const inFlightTokenPromises = new Map<string, Promise<string | null>>();
const queryCooldownMap = new Map<string, { lastQueryTime: number; lastResult: any }>();

// Phone Number Normalization
export function formatKenyanPhone(phone: string): string {
  const cleaned = (phone || '').replace(/\D/g, '');
  if (cleaned.startsWith('2540')) {
    return '254' + cleaned.substring(4);
  }
  if (cleaned.startsWith('0')) {
    return '254' + cleaned.substring(1);
  }
  if ((cleaned.startsWith('7') || cleaned.startsWith('1')) && cleaned.length === 9) {
    return '254' + cleaned;
  }
  if (cleaned.startsWith('254') && cleaned.length >= 12) {
    return cleaned;
  }
  return cleaned.length === 9 ? '254' + cleaned : cleaned;
}

export function isValidKenyanMpesaPhone(phone: string): boolean {
  return /^254(?:7\d{8}|1\d{8})$/.test(formatKenyanPhone(phone));
}

export function maskPhone(phone: string): string {
  const formatted = formatKenyanPhone(phone);
  if (formatted.length >= 10) {
    return `${formatted.substring(0, 6)}***${formatted.substring(formatted.length - 3)}`;
  }
  return '2547******';
}

export function isDarajaMerchantConfigurationError(message: unknown): boolean {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('merchant does not exist') ||
    normalized.includes('invalid shortcode') ||
    normalized.includes('invalid business');
}

export function isDefinitiveDarajaStkRejection(status: number, payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || status === 429 || status >= 500) return false;
  const data = payload as Record<string, unknown>;
  const responseCode = data.ResponseCode;
  if ((typeof responseCode === 'string' || typeof responseCode === 'number') && String(responseCode) !== '0') {
    return status >= 200 && status < 500;
  }
  return status >= 400 && status < 500 && (
    typeof data.errorCode === 'string' ||
    typeof data.errorMessage === 'string' ||
    typeof (data.fault as Record<string, unknown> | undefined)?.faultstring === 'string'
  );
}

/**
 * 1. Safaricom Daraja OAuth Token Generator
 * Secure server-side basic authentication with token caching
 */
export async function getDarajaAccessToken(): Promise<{ token: string | null; error?: string }> {
  const mpesaSettings = store.getMpesaSettings();
  const consumerKey = (process.env.MPESA_CONSUMER_KEY || process.env.MPESA_TILL_CONSUMER_KEY || mpesaSettings.consumerKey || '').trim();
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || process.env.MPESA_TILL_SECRET_KEY || mpesaSettings.consumerSecret || '').trim();

  if (!consumerKey || !consumerSecret) {
    const err = 'MPESA_CONSUMER_KEY or MPESA_CONSUMER_SECRET not configured on server.';
    console.error(`[M-PESA OAUTH ERROR] ${err}`);
    return { token: null, error: err };
  }

  // Keep provider tokens in process memory only. Vercel's filesystem is
  // ephemeral/read-only at runtime, and credential fragments must never become
  // filenames or persisted cache keys.
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${consumerKey}\u0000${consumerSecret}`)
    .digest('hex');
  const now = Date.now();

  // Return valid cached token if fresh (with 120s buffer)
  const cached = tokenCache[cacheKey];
  if (cached && cached.expiresAt > now + 120000) {
    return { token: cached.token };
  }

  // Deduplicate concurrent in-flight token requests
  if (inFlightTokenPromises.has(cacheKey)) {
    const existing = await inFlightTokenPromises.get(cacheKey)!;
    return { token: existing };
  }

  const tokenPromise = (async () => {
    console.log('[M-PESA OAUTH] Generating new OAuth access token from Safaricom Daraja...');
    const authHeader = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${DARAJA_PRODUCTION_URL}/oauth/v1/generate?grant_type=client_credentials`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(12000)
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.access_token) {
            const expiresInSec = Number(data.expires_in) || 3599;
            tokenCache[cacheKey] = {
              token: data.access_token,
              expiresAt: now + expiresInSec * 1000
            };
            console.log(`[M-PESA OAUTH SUCCESS] Token acquired, expires in ${expiresInSec}s.`);
            return data.access_token;
          }
        }

        const errText = await res.text().catch(() => '');
        console.error(`[M-PESA OAUTH ATTEMPT ${attempt} FAILED] HTTP ${res.status}:`, errText);

        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      } catch (fetchErr: any) {
        console.error(`[M-PESA OAUTH ATTEMPT ${attempt} NETWORK ERROR]:`, fetchErr?.message || fetchErr);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
    }

    // Fallback: If fresh fetch failed but we have a recently cached token, use it as fallback
    if (cached && cached.expiresAt > now - 3600000) {
      console.log('[M-PESA OAUTH FALLBACK] Using existing cached token.');
      return cached.token;
    }

    return null;
  })();

  inFlightTokenPromises.set(cacheKey, tokenPromise);
  try {
    const token = await tokenPromise;
    return { token, error: token ? undefined : 'Failed to authenticate with Safaricom Daraja API' };
  } finally {
    inFlightTokenPromises.delete(cacheKey);
  }
}

export interface InitiateStkPushParams {
  phoneNumber: string;
  amount: number;
  accountReference?: string;
  articleId?: string;
  articleTitle?: string;
  isTip?: boolean;
  type?: 'PURCHASE' | 'TIP';
  currency?: string;
  originalAmount?: number;
  exchangeRate?: number;
  exchangeRateTimestamp?: string;
  affiliateCode?: string;
  campaignCode?: string;
  affiliateAttributionAt?: string;
  affiliateAttributionExpiresAt?: string;
  userId?: string;
  userEmail?: string;
  originUrl?: string;
}

export interface StkPushResult {
  success: boolean;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  customerMessage?: string;
  message?: string;
  amount?: number;
  phoneNumber?: string;
  articleTitle?: string;
  paymentCapability?: string;
  reconciliationPending?: boolean;
  error?: string;
}

/**
 * 2. Send Real Production STK Push
 * Directly calls Safaricom Daraja production endpoint
 */
export async function initiateStkPush(params: InitiateStkPushParams): Promise<StkPushResult> {
  const {
    phoneNumber,
    amount,
    articleId,
    articleTitle = 'Ink & Witness Monograph Unlock',
    isTip = false,
    type: requestedType,
    currency = 'KES',
    originalAmount,
    exchangeRate,
    exchangeRateTimestamp,
    affiliateCode,
    campaignCode,
    affiliateAttributionAt,
    affiliateAttributionExpiresAt,
    userId,
    userEmail,
    originUrl
  } = params;

  const formattedPhone = formatKenyanPhone(phoneNumber);
  const cleanAmount = Math.max(1, Math.round(Number(amount) || 1));
  const masked = maskPhone(formattedPhone);
  const paymentType: 'PURCHASE' | 'TIP' = requestedType === 'TIP' || isTip ? 'TIP' : 'PURCHASE';

  if (!isValidKenyanMpesaPhone(formattedPhone)) {
    return {
      success: false,
      error: 'Enter a valid Safaricom number in the format 07XXXXXXXX, 01XXXXXXXX, or 254XXXXXXXXX.'
    };
  }

  console.log(`[M-PESA PAYMENT START] Phone: ${masked}, Amount: KES ${cleanAmount}, Piece ID: ${articleId || 'N/A'}`);

  // Load Credentials
  const mpesaSettings = store.getMpesaSettings();
  const passkey = (process.env.MPESA_PASSKEY || process.env.MPESA_PASSKEY_ || mpesaSettings.passkey || '').trim();

  if (!passkey) {
    const err = 'M-Pesa production configuration missing: MPESA_PASSKEY. Please configure in settings.';
    console.error(`[M-PESA CONFIG ERROR] ${err}`);
    return { success: false, error: err };
  }

  let paymentRail: ResolvedMpesaPaymentRail;
  try {
    paymentRail = resolveMpesaPaymentRail(mpesaSettings);
  } catch (error: any) {
    const err = error?.message || 'The M-Pesa payment rail configuration is invalid.';
    console.error(`[M-PESA CONFIG ERROR] ${err}`);
    return { success: false, error: err };
  }
  const { businessShortCode, partyB, transactionType } = paymentRail;

  // Generate OAuth Token
  const { token: accessToken, error: tokenError } = await getDarajaAccessToken();
  if (!accessToken) {
    console.error('[M-PESA STK ERROR] OAuth token acquisition failed:', tokenError);
    return {
      success: false,
      error: tokenError || 'Failed to authenticate with Safaricom Daraja. Please retry in a moment.'
    };
  }

  // Build Timestamp: YYYYMMDDHHmmss
  const timestamp = createDarajaTimestamp();

  // Password = Base64(BusinessShortCode + Passkey + Timestamp)
  const rawPassword = `${businessShortCode}${passkey}${timestamp}`;
  const password = Buffer.from(rawPassword).toString('base64');

  // Resolve Public HTTPS Callback URL
  let callbackUrl: string;
  const callbackCapability = generatePaymentCapability();
  const callbackCapabilityHash = hashPaymentCapability(callbackCapability);
  const paymentCapability = generatePaymentCapability();
  const paymentAttemptId = generatePaymentAttemptId();
  try {
    callbackUrl = attachCallbackCapability(
      resolveDarajaCallbackUrl(
        process.env.MPESA_CALLBACK_URL || process.env.APP_URL || originUrl || mpesaSettings.callbackUrl || ''
      ),
      callbackCapability
    );
  } catch (error: any) {
    console.error(`[M-PESA CONFIG ERROR] ${error.message}`);
    return { success: false, error: error.message };
  }

  const accountReference = (process.env.MPESA_ACCOUNT_REF || params.accountReference || articleTitle || 'INKWITNESS')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 12) || 'INKWITNESS';

  const preparedAt = new Date();
  const normalizedCurrency = /^[A-Z]{3,8}$/.test(String(currency || '').trim().toUpperCase())
    ? String(currency).trim().toUpperCase()
    : 'KES';
  const normalizedOriginalAmount = Number(originalAmount);
  const normalizedExchangeRate = Number(exchangeRate);
  const normalizedExchangeRateTimestamp = exchangeRateTimestamp && Number.isFinite(Date.parse(exchangeRateTimestamp))
    ? exchangeRateTimestamp
    : preparedAt.toISOString();
  const intent: MpesaCallbackIntent = {
    version: 1,
    callbackCapabilityHash,
    paymentCapabilityHash: hashPaymentCapability(paymentCapability),
    paymentAttemptId,
    requestLockId: getMpesaRequestLockId(
      articleId || (paymentType === 'TIP' ? 'general_tip' : 'custom'),
      formattedPhone
    ),
    articleId: articleId || (paymentType === 'TIP' ? 'general_tip' : 'custom'),
    articleTitle,
    phoneNumber: formattedPhone,
    amount: cleanAmount,
    currency: normalizedCurrency,
    originalAmount: Number.isFinite(normalizedOriginalAmount) && normalizedOriginalAmount > 0
      ? normalizedOriginalAmount
      : cleanAmount,
    exchangeRate: Number.isFinite(normalizedExchangeRate) && normalizedExchangeRate > 0
      ? normalizedExchangeRate
      : 1,
    exchangeRateTimestamp: normalizedExchangeRateTimestamp,
    type: paymentType,
    affiliateCode: affiliateCode || undefined,
    campaignCode: campaignCode || undefined,
    affiliateAttributionAt: affiliateAttributionAt || undefined,
    affiliateAttributionExpiresAt: affiliateAttributionExpiresAt || undefined,
    userId: userId || undefined,
    userEmail: userEmail || undefined,
    shortcodeUsed: businessShortCode,
    createdAt: preparedAt.toISOString(),
    expiresAt: new Date(preparedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    status: 'PREPARED'
  };

  try {
    // Persist the complete, capability-bound intent before contacting Daraja.
    // If the provider accepts while the response-side transaction write fails,
    // the authenticated callback can reconstruct the pending transaction.
    await store.saveMpesaCallbackIntent(intent);
  } catch (error: any) {
    console.error('[M-PESA INTENT ERROR] Secure payment intent could not be persisted.');
    if (error?.code === 'ACTIVE_MPESA_INTENT') {
      return {
        success: false,
        error: 'Safaricom is already processing an M-Pesa request for this phone and piece. Wait briefly before trying again.'
      };
    }
    return { success: false, error: 'Payment could not be prepared safely. Please retry in a moment.' };
  }

  const stkPayload = {
    BusinessShortCode: businessShortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: transactionType,
    Amount: cleanAmount,
    PartyA: formattedPhone,
    PartyB: partyB,
    PhoneNumber: formattedPhone,
    CallBackURL: callbackUrl,
    AccountReference: accountReference,
    TransactionDesc: 'Ink and Witness'
  };

  console.log(`[STK REQUEST SENT] Phone: ${masked}, Amount: KES ${cleanAmount}, ShortCode: ${businessShortCode}, PartyB: ${partyB}, AccountRef: ${accountReference}`);

  try {
    const stkRes = await fetch(`${DARAJA_PRODUCTION_URL}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(stkPayload),
      signal: AbortSignal.timeout(18000)
    });

    const stkData = await stkRes.json().catch(() => ({}));
    console.log(`[Daraja HTTP STATUS] ${stkRes.status}`);
    console.log(`[Daraja RESPONSE] HTTP ${stkRes.status}, ResponseCode: ${String(stkData?.ResponseCode || 'none')}, ErrorCode: ${String(stkData?.errorCode || 'none')}`);

    // Handle SpikeArrest or rate limiting
    if (stkRes.status === 429 || JSON.stringify(stkData).includes('SpikeArrestViolation')) {
      console.warn('[M-PESA STK RATE LIMIT] Safaricom rate limit hit, backing off 2000ms...');
      await new Promise(r => setTimeout(r, 2000));
      const freshTokenResult = await getDarajaAccessToken();
      if (freshTokenResult.token) {
        const retryRes = await fetch(`${DARAJA_PRODUCTION_URL}/mpesa/stkpush/v1/processrequest`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${freshTokenResult.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(stkPayload),
          signal: AbortSignal.timeout(18000)
        });
        const retryData = await retryRes.json().catch(() => ({}));
        console.log(`[Daraja RETRY HTTP STATUS] ${retryRes.status}`);
        console.log(`[Daraja RETRY RESPONSE] HTTP ${retryRes.status}, ResponseCode: ${String(retryData?.ResponseCode || 'none')}, ErrorCode: ${String(retryData?.errorCode || 'none')}`);
        if (retryData?.ResponseCode === '0' && retryData?.CheckoutRequestID) {
          return handleSuccessfulStkResponse(
            retryData,
            masked,
            intent,
            paymentCapability
          );
        }
      }
    }

    if (stkData?.ResponseCode === '0' && stkData?.CheckoutRequestID) {
      return handleSuccessfulStkResponse(
        stkData,
        masked,
        intent,
        paymentCapability
      );
    } else {
      const errorMsg = stkData?.errorMessage || stkData?.ResponseDescription || (stkData?.fault?.faultstring ? `Safaricom Notice: ${stkData.fault.faultstring}` : `Safaricom rejected STK Push (HTTP ${stkRes.status})`);
      console.error(`[M-PESA STK REJECTED] ${errorMsg}`);
      const definitiveRejection = isDefinitiveDarajaStkRejection(stkRes.status, stkData);
      if (definitiveRejection) {
        await store.discardMpesaCallbackIntent(
          callbackCapabilityHash,
          intent.paymentCapabilityHash,
          intent.requestLockId
        ).catch(() => {
          console.warn('[M-PESA INTENT CLEANUP] Rejected payment intent remains available for reconciliation.');
        });
      } else {
        console.warn('[M-PESA STK AMBIGUOUS] Recovery intent retained because provider acceptance could not be ruled out.');
      }
      if (!definitiveRejection) {
        return ambiguousStkResponse(intent, paymentCapability);
      }
      return { success: false, error: errorMsg };
    }
  } catch (error: any) {
    console.error('[M-PESA STK NETWORK ERROR]:', error);
    return ambiguousStkResponse(intent, paymentCapability);
  }
}

function ambiguousStkResponse(
  intent: MpesaCallbackIntent,
  paymentCapability: string,
  providerAccepted = false
): StkPushResult {
  if (!intent.paymentAttemptId) {
    return {
      success: false,
      error: 'Safaricom returned an uncertain response. Wait two minutes before trying again.'
    };
  }
  return {
    success: true,
    checkoutRequestId: intent.paymentAttemptId,
    customerMessage: providerAccepted
      ? 'Safaricom accepted the request and payment confirmation is being reconciled.'
      : 'Safaricom is still confirming whether the request was accepted.',
    message: providerAccepted
      ? 'Safaricom accepted the request, but its payment record is still being reconciled. Do not retry yet.'
      : 'The immediate Safaricom response was interrupted. Payment status will be reconciled automatically; do not retry yet.',
    amount: intent.amount,
    phoneNumber: intent.phoneNumber,
    articleTitle: intent.articleTitle,
    paymentCapability,
    reconciliationPending: true
  };
}

async function handleSuccessfulStkResponse(
  stkData: any,
  maskedPhone: string,
  intent: MpesaCallbackIntent,
  paymentCapability: string
): Promise<StkPushResult> {
  const checkoutRequestId = stkData.CheckoutRequestID;
  const merchantRequestId = stkData.MerchantRequestID;
  if (typeof merchantRequestId !== 'string' || !merchantRequestId.trim()) {
    console.error('[M-PESA TRANSACTION ATTACHMENT] Provider accepted without returning a merchant correlation ID; callback recovery is pending.');
    return ambiguousStkResponse(intent, paymentCapability, true);
  }
  console.log(`[STK PUSH SUCCESSFUL] Provider correlation IDs received. CustomerPhone: ${maskedPhone}, Amount: KES ${intent.amount}`);

  let transaction: PaymentTransaction | undefined;
  try {
    transaction = await store.attachMpesaCallbackIntent(
      intent.callbackCapabilityHash,
      checkoutRequestId,
      merchantRequestId
    );
  } catch {
    // Daraja has already accepted the request. Return the provider IDs and the
    // client polling capability; the durable pre-request intent lets the
    // authenticated callback finish attachment and settlement safely.
    console.error('[M-PESA TRANSACTION ATTACHMENT] Provider accepted; callback recovery is pending.');
  }
  if (transaction) {
    console.log('[M-PESA TRANSACTION CREATED] Pending transaction attached to its durable payment intent.');
  } else {
    return ambiguousStkResponse(intent, paymentCapability, true);
  }

  return {
    success: true,
    checkoutRequestId,
    merchantRequestId,
    customerMessage: stkData.CustomerMessage || 'M-Pesa request accepted by Safaricom for processing.',
    message: 'M-Pesa request accepted by Safaricom. Waiting for handset delivery confirmation.',
    amount: transaction?.amount || intent.amount,
    phoneNumber: transaction?.phoneNumber || intent.phoneNumber,
    articleTitle: transaction?.articleTitle || intent.articleTitle,
    paymentCapability
  };
}

type DarajaCallbackMetadata = {
  amount: number;
  receiptNumber: string;
  transactionDate: string;
  phoneNumber: string;
};

export type ParsedDarajaCallback = {
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: number;
  resultDesc: string;
  metadata?: DarajaCallbackMetadata;
};

export type DarajaCallbackResult = {
  success: boolean;
  outcome: 'committed' | 'duplicate' | 'rejected' | 'retryable_error';
  message: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readCallbackIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= 3 && normalized.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
    ? normalized
    : null;
}

export function parseDarajaCallback(callbackBody: unknown): ParsedDarajaCallback | null {
  if (!isPlainRecord(callbackBody) || !isPlainRecord(callbackBody.Body)) return null;
  const stkCallback = callbackBody.Body.stkCallback;
  if (!isPlainRecord(stkCallback)) return null;

  const checkoutRequestId = readCallbackIdentifier(stkCallback.CheckoutRequestID);
  const merchantRequestId = readCallbackIdentifier(stkCallback.MerchantRequestID);
  const resultCode = stkCallback.ResultCode;
  const resultDesc = typeof stkCallback.ResultDesc === 'string' ? stkCallback.ResultDesc.trim() : '';
  if (
    !checkoutRequestId ||
    !merchantRequestId ||
    typeof resultCode !== 'number' ||
    !Number.isFinite(resultCode) ||
    !Number.isInteger(resultCode) ||
    !resultDesc ||
    resultDesc.length > 512
  ) {
    return null;
  }

  if (resultCode !== 0) {
    return { checkoutRequestId, merchantRequestId, resultCode, resultDesc };
  }

  if (!isPlainRecord(stkCallback.CallbackMetadata) || !Array.isArray(stkCallback.CallbackMetadata.Item)) {
    return null;
  }
  const items = stkCallback.CallbackMetadata.Item;
  if (items.length < 4 || items.length > 20) return null;

  const metadata = new Map<string, unknown>();
  for (const item of items) {
    if (!isPlainRecord(item) || typeof item.Name !== 'string' || item.Name.length > 64) return null;
    if (metadata.has(item.Name)) return null;
    if (item.Value !== undefined && !['string', 'number', 'boolean'].includes(typeof item.Value)) return null;
    metadata.set(item.Name, item.Value);
  }

  const rawAmount = metadata.get('Amount');
  const rawReceipt = metadata.get('MpesaReceiptNumber');
  const rawDate = metadata.get('TransactionDate');
  const rawPhone = metadata.get('PhoneNumber');
  if (
    typeof rawAmount !== 'number' ||
    !Number.isFinite(rawAmount) ||
    rawAmount <= 0 ||
    rawAmount > 1_000_000 ||
    (typeof rawReceipt !== 'string' && typeof rawReceipt !== 'number') ||
    (typeof rawDate !== 'string' && typeof rawDate !== 'number') ||
    (typeof rawPhone !== 'string' && typeof rawPhone !== 'number')
  ) {
    return null;
  }

  const receiptNumber = String(rawReceipt).trim().toUpperCase();
  const transactionDate = String(rawDate).trim();
  const phoneNumber = formatKenyanPhone(String(rawPhone));
  if (
    !/^[A-Z0-9]{8,32}$/.test(receiptNumber) ||
    !/^\d{8,20}$/.test(transactionDate) ||
    !isValidKenyanMpesaPhone(phoneNumber)
  ) {
    return null;
  }

  return {
    checkoutRequestId,
    merchantRequestId,
    resultCode,
    resultDesc,
    metadata: { amount: rawAmount, receiptNumber, transactionDate, phoneNumber }
  };
}

/**
 * 3. Safaricom Webhook Callback Processor
 * Authenticated by a per-request callback URL capability, then correlated and
 * committed atomically. Standard Daraja callbacks do not contain a signature.
 */
export async function handleDarajaCallback(
  callbackBody: unknown,
  callbackCapability: unknown
): Promise<DarajaCallbackResult> {
  const parsed = parseDarajaCallback(callbackBody);
  if (!parsed) {
    console.warn('[M-PESA CALLBACK REJECTED] Malformed callback payload.');
    return { success: false, outcome: 'rejected', message: 'Callback rejected.' };
  }
  if (typeof callbackCapability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(callbackCapability)) {
    console.warn('[M-PESA CALLBACK REJECTED] Missing callback authentication.');
    return { success: false, outcome: 'rejected', message: 'Callback rejected.' };
  }

  try {
    const callbackCapabilityHash = hashPaymentCapability(callbackCapability);
    let tx = await store.loadTransaction(parsed.checkoutRequestId);
    if (!tx) {
      // The provider can beat the response-side transaction attachment. The
      // pre-Daraja, hash-bound intent is sufficient to reconstruct the pending
      // transaction without trusting callback-supplied purchase details.
      tx = await store.attachMpesaCallbackIntent(
        callbackCapabilityHash,
        parsed.checkoutRequestId,
        parsed.merchantRequestId
      );
      if (!tx) {
        console.warn('[M-PESA CALLBACK REJECTED] No correlated payment intent exists.');
        return { success: false, outcome: 'rejected', message: 'Callback rejected.' };
      }
    }
    if (
      tx.paymentMethod !== 'mpesa' ||
      (tx.type !== 'PURCHASE' && tx.type !== 'TIP') ||
      !tx.merchantRequestId ||
      tx.merchantRequestId !== parsed.merchantRequestId ||
      !tx.callbackCapabilityHash ||
      !verifyPaymentCapability(callbackCapability, tx.callbackCapabilityHash)
    ) {
      console.warn('[M-PESA CALLBACK REJECTED] Authentication or transaction correlation failed.');
      return { success: false, outcome: 'rejected', message: 'Callback rejected.' };
    }

    if (parsed.resultCode === 0) {
      const metadata = parsed.metadata;
      if (
        !metadata ||
        metadata.amount !== tx.amount ||
        metadata.phoneNumber !== tx.phoneNumber
      ) {
        console.warn('[M-PESA CALLBACK REJECTED] Paid amount or phone did not match the initiated transaction.');
        return { success: false, outcome: 'rejected', message: 'Callback rejected.' };
      }

      const settlement = await store.settleMpesaTransaction(parsed.checkoutRequestId, {
        merchantRequestId: parsed.merchantRequestId,
        receiptNumber: metadata.receiptNumber,
        amount: metadata.amount,
        phoneNumber: metadata.phoneNumber,
        resultDesc: parsed.resultDesc,
        transactionTimestamp: metadata.transactionDate,
          expectedCallbackCapabilityHash: callbackCapabilityHash
      });
      if (settlement.outcome === 'rejected') {
        console.warn('[M-PESA CALLBACK REJECTED] Atomic settlement validation failed.');
        return { success: false, outcome: 'rejected', message: 'Callback rejected.' };
      }

      console.log(`[M-PESA CALLBACK ${settlement.outcome === 'committed' ? 'COMMITTED' : 'DUPLICATE'}] Valid provider success callback handled.`);
      return {
        success: true,
        outcome: settlement.outcome,
        message: settlement.outcome === 'committed' ? 'Callback processed.' : 'Callback already processed.'
      };
    }

    const terminalStatus = parsed.resultCode === 1032
      ? 'CANCELLED' as const
      : parsed.resultCode === 1037
        ? 'TIMEOUT' as const
        : 'FAILED' as const;
    const failure = await store.recordMpesaTerminalFailure(parsed.checkoutRequestId, {
      merchantRequestId: parsed.merchantRequestId,
      callbackCapabilityHash: tx.callbackCapabilityHash,
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
      status: terminalStatus
    });
    if (failure.outcome === 'rejected') {
      console.warn('[M-PESA CALLBACK REJECTED] Conflicting terminal callback.');
      return { success: false, outcome: 'rejected', message: 'Callback rejected.' };
    }

    console.log(`[M-PESA CALLBACK ${failure.outcome === 'committed' ? 'COMMITTED' : 'DUPLICATE'}] Valid provider terminal callback handled.`);
    return {
      success: true,
      outcome: failure.outcome,
      message: failure.outcome === 'committed' ? 'Callback processed.' : 'Callback already processed.'
    };
  } catch (error) {
    console.error('[M-PESA CALLBACK RETRYABLE ERROR] Persistence failed:', error);
    return { success: false, outcome: 'retryable_error', message: 'Callback could not be persisted.' };
  }
}

// Global query pacing timestamp to avoid triggering Safaricom Apigee SpikeArrest
let lastGlobalDarajaQueryTime = 0;

/**
 * 4. Query Payment Status
 * Checks stored database state and performs safe polling against Safaricom
 */
export async function queryPaymentStatus(checkoutRequestId: string): Promise<{
  status: 'PENDING' | 'SUCCESS' | 'PAID' | 'CONFIRMED' | 'STK_SENT' | 'INITIATED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT' | 'TIMED_OUT';
  resultCode?: number;
  resultDesc?: string;
  mpesaReceiptNumber?: string;
  downloadToken?: string;
  articleId?: string;
  articleTitle?: string;
  amount?: number;
  isUnlocked?: boolean;
}> {
  let tx = await store.loadTransaction(checkoutRequestId);
  if (!tx) {
    return {
      status: 'FAILED',
      resultDesc: 'Transaction not found'
    };
  }

  // If already SUCCESS or CONFIRMED
  if (tx.status === 'SUCCESS' || tx.status === 'CONFIRMED' || tx.status === 'PAID') {
    return {
      status: 'SUCCESS',
      resultCode: 0,
      resultDesc: 'Payment confirmed.',
      mpesaReceiptNumber: tx.mpesaReceiptNumber || tx.receiptNumber,
      downloadToken: tx.downloadToken,
      articleId: tx.articleId,
      articleTitle: tx.articleTitle,
      amount: tx.amount,
      isUnlocked: true
    };
  }

  if (tx.status === 'CANCELLED') {
    return {
      status: 'CANCELLED',
      resultCode: tx.resultCode || 1032,
      resultDesc: tx.resultDesc || 'Payment was cancelled on phone.'
    };
  }

  if (tx.status === 'TIMEOUT' || tx.status === 'TIMED_OUT') {
    return {
      status: 'TIMEOUT',
      resultCode: tx.resultCode || 1037,
      resultDesc: tx.resultDesc || 'Payment prompt timed out on phone.'
    };
  }

  if (tx.status === 'FAILED') {
    return {
      status: 'FAILED',
      resultCode: tx.resultCode || -1,
      resultDesc: tx.resultDesc || 'Payment failed on phone.'
    };
  }

  if (tx.paymentMethod === 'bank') {
    return {
      status: 'PENDING',
      resultDesc: tx.bankReference
        ? 'Bank reference submitted and awaiting reconciliation.'
        : 'Bank order created and awaiting transfer details.'
    };
  }

  const recordQueryTerminalResult = async (
    status: 'FAILED' | 'CANCELLED' | 'TIMEOUT',
    resultCode: number,
    resultDesc: string
  ) => {
    if (!tx.merchantRequestId || !tx.callbackCapabilityHash) {
      return {
        status: 'PENDING' as const,
        resultDesc: 'Payment status requires manual reconciliation.'
      };
    }

    const result = await store.recordMpesaTerminalFailure(checkoutRequestId, {
      merchantRequestId: tx.merchantRequestId,
      callbackCapabilityHash: tx.callbackCapabilityHash,
      resultCode,
      resultDesc,
      status
    });
    if (result.outcome === 'rejected') {
      return {
        status: 'PENDING' as const,
        resultDesc: 'Payment status requires manual reconciliation.'
      };
    }
    if (result.transaction) tx = result.transaction;
    return { status, resultCode, resultDesc };
  };

  // If still PENDING: Perform on-demand Daraja STK Push Query with cooldown
  const nowMs = Date.now();
  const txAgeMs = tx.createdAt ? nowMs - new Date(tx.createdAt).getTime() : 0;

  // Don't hammer Daraja query endpoint within first 10 seconds while prompt is waking up on phone
  if (txAgeMs < 10000) {
    return {
      status: 'PENDING',
      resultDesc: 'Safaricom accepted the request. Waiting for the phone prompt.'
    };
  }

  const cachedQuery = queryCooldownMap.get(checkoutRequestId);
  if (cachedQuery && nowMs - cachedQuery.lastQueryTime < 8000) {
    return cachedQuery.lastResult || { status: 'PENDING', resultDesc: 'Waiting for the Safaricom phone prompt…' };
  }

  // Respect global Daraja rate limit to prevent SpikeArrestViolation across concurrent sessions
  if (nowMs - lastGlobalDarajaQueryTime < 2500) {
    return cachedQuery?.lastResult || { status: 'PENDING', resultDesc: 'Processing payment on Safaricom network…' };
  }

  // Safe STK Query with Safaricom Daraja
  try {
    lastGlobalDarajaQueryTime = Date.now();
    const { token: accessToken } = await getDarajaAccessToken();
    if (!accessToken) {
      return { status: 'PENDING', resultDesc: 'Awaiting M-Pesa confirmation…' };
    }

    const mpesaSettings = store.getMpesaSettings();
    const passkey = (process.env.MPESA_PASSKEY || process.env.MPESA_PASSKEY_ || mpesaSettings.passkey || '').trim();
    let shortcode = String(tx.shortcodeUsed || '').trim();
    if (!shortcode) {
      try {
        shortcode = resolveMpesaPaymentRail(mpesaSettings).businessShortCode;
      } catch (error: any) {
        return { status: 'FAILED', resultDesc: error?.message || 'The M-Pesa status-query merchant configuration is invalid.' };
      }
    }

    if (!passkey || !/^\d{5,10}$/.test(shortcode)) {
      return {
        status: 'FAILED',
        resultDesc: 'The M-Pesa status-query credentials are incomplete. Verify the passkey and business shortcode.'
      };
    }

    const timestamp = createDarajaTimestamp();

    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    const queryPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    };

    const queryRes = await fetch(`${DARAJA_PRODUCTION_URL}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(queryPayload),
      signal: AbortSignal.timeout(10000)
    });

    const queryData = await queryRes.json().catch(() => ({}));

    // Handle Safaricom Rate Limit / SpikeArrest smoothly
    const isSpikeArrest = queryRes.status === 429 || JSON.stringify(queryData).includes('SpikeArrestViolation') || JSON.stringify(queryData).includes('ratelimit');
    if (isSpikeArrest) {
      console.log(`[M-PESA QUERY PACING] Safaricom SpikeArrest rate limit active. Pacing queries and maintaining PENDING status.`);
      const pendingPacedResult = { status: 'PENDING' as const, resultDesc: 'Waiting for the Safaricom phone prompt…' };
      queryCooldownMap.set(checkoutRequestId, { lastQueryTime: nowMs + 4000, lastResult: pendingPacedResult });
      return pendingPacedResult;
    }

    console.log(`[M-PESA QUERY RESPONSE] HTTP ${queryRes.status}, ResponseCode: ${String(queryData?.ResponseCode || 'none')}, ResultCode: ${String(queryData?.ResultCode ?? 'none')}`);

    let resolvedResult: any = { status: 'PENDING', resultDesc: 'Waiting for the Safaricom phone prompt…' };

    if (queryData?.ResponseCode === '0') {
      const qResultCode = Number(queryData.ResultCode);
      const qResultDesc = queryData.ResultDesc || '';

      if (qResultCode === 0) {
        const returnedCheckoutId = queryData.CheckoutRequestID;
        const returnedMerchantId = queryData.MerchantRequestID;
        const receipt = typeof queryData.MpesaReceiptNumber === 'string'
          ? queryData.MpesaReceiptNumber.trim().toUpperCase()
          : '';
        const correlationMismatch =
          (returnedCheckoutId && returnedCheckoutId !== checkoutRequestId) ||
          (returnedMerchantId && returnedMerchantId !== tx.merchantRequestId);

        if (correlationMismatch || !tx.merchantRequestId) {
          console.warn('[M-PESA QUERY REJECTED] Provider correlation fields did not match the initiated transaction.');
          resolvedResult = {
            status: 'PENDING',
            resultDesc: 'Payment confirmation requires manual reconciliation.'
          };
        } else if (!/^[A-Z0-9]{8,32}$/.test(receipt)) {
          // The authenticated query can report success without returning the
          // receipt needed for unique settlement. Wait for the callback rather
          // than manufacturing payment evidence.
          resolvedResult = {
            status: 'PENDING',
            resultDesc: 'Safaricom reports completion; awaiting the final receipt callback.'
          };
        } else {
          const settlement = await store.settleMpesaTransaction(checkoutRequestId, {
            merchantRequestId: tx.merchantRequestId,
            receiptNumber: receipt,
            amount: tx.amount,
            phoneNumber: tx.phoneNumber || '',
            resultDesc: qResultDesc || 'Payment confirmed via authenticated provider query.'
          });
          resolvedResult = settlement.outcome === 'rejected'
            ? {
                status: 'PENDING',
                resultDesc: 'Payment confirmation requires manual reconciliation.'
              }
            : {
                status: 'SUCCESS',
                resultCode: 0,
                resultDesc: 'Payment confirmed.',
                mpesaReceiptNumber: receipt,
                downloadToken: settlement.downloadToken,
                articleId: tx.articleId,
                isUnlocked: true
              };
        }
      } else if (qResultCode === 1032) {
        resolvedResult = await recordQueryTerminalResult(
          'CANCELLED',
          1032,
          'Payment was cancelled on phone handset.'
        );
      } else if (qResultCode === 1037) {
        resolvedResult = await recordQueryTerminalResult(
          'TIMEOUT',
          1037,
          'Payment prompt timed out on phone.'
        );
      } else if (isDarajaMerchantConfigurationError(qResultDesc)) {
        resolvedResult = await recordQueryTerminalResult(
          'FAILED',
          qResultCode,
          'Safaricom rejected the configured merchant number. Verify the transaction type, store/shortcode and till mapping.'
        );
      } else if (
        qResultDesc.toLowerCase().includes('duplicated msisdn') ||
        qResultDesc.toLowerCase().includes('existing ussd') ||
        qResultDesc.toLowerCase().includes('active session')
      ) {
        resolvedResult = await recordQueryTerminalResult(
          'FAILED',
          qResultCode,
          'Another M-Pesa prompt or USSD session is active on this phone. Close it, wait briefly, then retry.'
        );
      } else if (
        qResultDesc.toLowerCase().includes('in progress') ||
        qResultDesc.toLowerCase().includes('processing')
      ) {
        console.log(`[M-PESA QUERY IN-FLIGHT] Safaricom returned in-progress code ${qResultCode}.`);
        resolvedResult = {
          status: 'PENDING',
          resultDesc: 'Safaricom is still processing the request. Keep this window open and do not retry while payment remains unconfirmed.'
        };
      } else if (qResultCode === 1) {
        // Insufficient funds
        resolvedResult = await recordQueryTerminalResult(
          'FAILED',
          1,
          'Insufficient funds in your M-Pesa account.'
        );
      } else if (qResultCode === 2001) {
        // Wrong PIN
        resolvedResult = await recordQueryTerminalResult(
          'FAILED',
          2001,
          'Incorrect M-Pesa PIN entered on your phone.'
        );
      } else {
        // Unclassified provider codes are not proof of terminal failure. A
        // later authenticated callback may still carry the final receipt.
        resolvedResult = {
          status: 'PENDING',
          resultDesc: qResultDesc || 'Payment status is awaiting final Safaricom confirmation.'
        };
      }
    } else {
      const errCode = String(queryData?.errorCode || '');
      const errMsg = String(queryData?.errorMessage || queryData?.ResponseDescription || '');
      const normalizedError = errMsg.toLowerCase();
      const merchantConfigurationError = isDarajaMerchantConfigurationError(normalizedError);
      if (merchantConfigurationError) {
        resolvedResult = await recordQueryTerminalResult(
          'FAILED',
          Number(queryData?.errorCode) || -1,
          'Safaricom rejected the configured merchant identity. Confirm that M-Pesa Express is active and that the live app, passkey, Store/Shortcode and Till belong to the same merchant account.'
        );
      } else if (
        errCode === '500.001.1001' ||
        normalizedError.includes('processing') ||
        normalizedError.includes('in progress') ||
        normalizedError.includes('transaction does not exist')
      ) {
        resolvedResult = { status: 'PENDING', resultDesc: 'Transaction is being processed on Safaricom network…' };
      } else {
        resolvedResult = { status: 'PENDING', resultDesc: errMsg || 'Awaiting customer PIN entry on phone…' };
      }
    }

    queryCooldownMap.set(checkoutRequestId, { lastQueryTime: nowMs, lastResult: resolvedResult });
    return resolvedResult;
  } catch (err) {
    console.warn('[M-PESA QUERY EXCEPTION]:', err);
    return { status: 'PENDING', resultDesc: 'Waiting for M-Pesa confirmation…' };
  }
}

/**
 * 5. Verify Manual M-Pesa Receipt
 * Validates manual receipt input against confirmed transactions in database
 */
export async function verifyManualReceipt(
  articleId: string,
  receiptNumber: string,
  phoneNumber?: string
): Promise<{
  success: boolean;
  token?: string;
  receipt?: string;
  articleId?: string;
  error?: string;
}> {
  const cleanReceipt = (receiptNumber || '').trim().toUpperCase();
  if (!cleanReceipt || cleanReceipt.length < 8) {
    return {
      success: false,
      error: 'Please enter a valid M-Pesa transaction code (e.g. SIK49D8Z1X).'
    };
  }

  const formattedPhone = phoneNumber ? formatKenyanPhone(phoneNumber) : '';
  if (!formattedPhone || !isValidKenyanMpesaPhone(formattedPhone)) {
    return { success: false, error: 'The paying Safaricom phone number is required.' };
  }

  const matchedTx = await store.findTransactionByReceipt(cleanReceipt);

  if (
    matchedTx &&
    matchedTx.paymentMethod === 'mpesa' &&
    matchedTx.type === 'PURCHASE' &&
    matchedTx.articleId === articleId &&
    matchedTx.phoneNumber === formattedPhone &&
    (matchedTx.status === 'SUCCESS' || matchedTx.status === 'CONFIRMED' || matchedTx.status === 'PAID')
  ) {
    // If matched and confirmed, ensure download token exists for this piece
    let token = matchedTx.downloadToken;
    if (!token) {
      const conf = await store.confirmTransaction(matchedTx.checkoutRequestId || matchedTx.id, cleanReceipt);
      token = conf.downloadToken;
    }
    return {
      success: true,
      token,
      receipt: cleanReceipt,
      articleId: matchedTx.articleId
    };
  }

  // Check if reader license token already exists with this receipt
  return {
    success: false,
    error: 'M-Pesa receipt could not be verified. Please ensure payment has completed or try initiating an STK Push.'
  };
}
