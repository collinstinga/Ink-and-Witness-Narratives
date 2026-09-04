import crypto from 'crypto';
import { store } from './store.js';
import { PaymentTransaction } from '../types.js';

/**
 * Safaricom Daraja Production M-Pesa Service
 * Clean, Authoritative, Server-Side Controlled Implementation
 */

const DARAJA_PRODUCTION_URL = 'https://api.safaricom.co.ke';
const VALID_TRANSACTION_TYPES = new Set(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']);

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
  if (!callback.pathname || callback.pathname === '/') {
    callback.pathname = '/api/mpesa/callback';
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

/**
 * 1. Safaricom Daraja OAuth Token Generator
 * Secure server-side basic authentication with token caching
 */
export async function getDarajaAccessToken(customKey?: string, customSecret?: string): Promise<{ token: string | null; error?: string }> {
  const mpesaSettings = store.getMpesaSettings();
  const consumerKey = (customKey || process.env.MPESA_CONSUMER_KEY || process.env.MPESA_TILL_CONSUMER_KEY || mpesaSettings.consumerKey || '').trim();
  const consumerSecret = (customSecret || process.env.MPESA_CONSUMER_SECRET || process.env.MPESA_TILL_SECRET_KEY || mpesaSettings.consumerSecret || '').trim();

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
    currency = 'KES',
    originalAmount,
    exchangeRate,
    exchangeRateTimestamp,
    affiliateCode,
    campaignCode,
    userId,
    userEmail,
    originUrl
  } = params;

  const formattedPhone = formatKenyanPhone(phoneNumber);
  const cleanAmount = Math.max(1, Math.round(Number(amount) || 1));
  const masked = maskPhone(formattedPhone);

  if (!isValidKenyanMpesaPhone(formattedPhone)) {
    return {
      success: false,
      error: 'Enter a valid Safaricom number in the format 07XXXXXXXX, 01XXXXXXXX, or 254XXXXXXXXX.'
    };
  }

  console.log(`[M-PESA PAYMENT START] Phone: ${masked}, Amount: KES ${cleanAmount}, Piece ID: ${articleId || 'N/A'}`);

  // Idempotency & Duplicate Protection:
  // If an active STK Push is already pending for the same (articleId, phoneNumber) in the last 45 seconds, return active request
  if (articleId && articleId !== 'test_stk') {
    const duplicate = await store.findRecentPendingTransaction(articleId, formattedPhone, 45000);

    if (duplicate && duplicate.checkoutRequestId) {
      console.log(`[M-PESA DUPLICATE PROTECTION] Reusing active pending transaction: ${duplicate.checkoutRequestId}`);
      return {
        success: true,
        checkoutRequestId: duplicate.checkoutRequestId,
        merchantRequestId: duplicate.merchantRequestId,
        customerMessage: "Safaricom is already processing this M-Pesa request.",
        message: "Safaricom is already processing this M-Pesa request.",
        amount: duplicate.amount,
        phoneNumber: duplicate.phoneNumber,
        articleTitle: duplicate.articleTitle
      };
    }
  }

  // Load Credentials
  const mpesaSettings = store.getMpesaSettings();
  const passkey = (process.env.MPESA_PASSKEY || process.env.MPESA_PASSKEY_ || mpesaSettings.passkey || '').trim();
  const shortcode = (process.env.MPESA_SHORTCODE || mpesaSettings.shortcode || '').trim();
  const storeNumber = (process.env.MPESA_STORE_NUMBER || mpesaSettings.storeNumber || '').trim();
  const tillNumber = (process.env.MPESA_TILL_NUMBER || mpesaSettings.tillNumber || '').trim();
  const transactionType = (process.env.MPESA_TRANSACTION_TYPE || mpesaSettings.transactionType || 'CustomerBuyGoodsOnline').trim();

  if (!passkey) {
    const err = 'M-Pesa production configuration missing: MPESA_PASSKEY. Please configure in settings.';
    console.error(`[M-PESA CONFIG ERROR] ${err}`);
    return { success: false, error: err };
  }

  if (!VALID_TRANSACTION_TYPES.has(transactionType)) {
    const err = 'M-Pesa transaction type must be CustomerPayBillOnline or CustomerBuyGoodsOnline.';
    console.error(`[M-PESA CONFIG ERROR] ${err}`);
    return { success: false, error: err };
  }

  const isBuyGoods = transactionType === 'CustomerBuyGoodsOnline';
  const businessShortCode = isBuyGoods ? (storeNumber || shortcode) : shortcode;
  const partyB = isBuyGoods ? (tillNumber || shortcode) : shortcode;
  if (!/^\d{5,10}$/.test(businessShortCode) || !/^\d{5,10}$/.test(partyB)) {
    const err = isBuyGoods
      ? 'M-Pesa Buy Goods requires valid numeric store/shortcode and till numbers.'
      : 'M-Pesa PayBill requires a valid numeric business shortcode.';
    console.error(`[M-PESA CONFIG ERROR] ${err}`);
    return { success: false, error: err };
  }

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
  try {
    callbackUrl = resolveDarajaCallbackUrl(
      process.env.MPESA_CALLBACK_URL || process.env.APP_URL || originUrl || mpesaSettings.callbackUrl || ''
    );
  } catch (error: any) {
    console.error(`[M-PESA CONFIG ERROR] ${error.message}`);
    return { success: false, error: error.message };
  }

  const accountReference = (process.env.MPESA_ACCOUNT_REF || params.accountReference || articleTitle || 'INKWITNESS')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 12) || 'INKWITNESS';

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
    console.log(`[Daraja RESPONSE] ${JSON.stringify(stkData)}`);

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
        console.log(`[Daraja RETRY RESPONSE] ${JSON.stringify(retryData)}`);
        if (retryData?.ResponseCode === '0' && retryData?.CheckoutRequestID) {
          return handleSuccessfulStkResponse(retryData, params, formattedPhone, cleanAmount, businessShortCode, masked);
        }
      }
    }

    if (stkData?.ResponseCode === '0' && stkData?.CheckoutRequestID) {
      return handleSuccessfulStkResponse(stkData, params, formattedPhone, cleanAmount, businessShortCode, masked);
    } else {
      const errorMsg = stkData?.errorMessage || stkData?.ResponseDescription || (stkData?.fault?.faultstring ? `Safaricom Notice: ${stkData.fault.faultstring}` : `Safaricom rejected STK Push (HTTP ${stkRes.status})`);
      console.error(`[M-PESA STK REJECTED] ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        checkoutRequestId: undefined
      };
    }
  } catch (error: any) {
    console.error('[M-PESA STK NETWORK ERROR]:', error);
    const isTimeout = error?.name === 'AbortError' || error?.message?.includes('timeout') || error?.message?.includes('fetch failed');
    return {
      success: false,
      error: isTimeout
        ? 'Safaricom M-Pesa gateway connection timed out. Please try again in a few seconds.'
        : `Network error connecting to Safaricom Daraja: ${error.message}`
    };
  }
}

async function handleSuccessfulStkResponse(
  stkData: any,
  params: InitiateStkPushParams,
  formattedPhone: string,
  amount: number,
  shortcodeUsed: string,
  maskedPhone: string
): Promise<StkPushResult> {
  const checkoutRequestId = stkData.CheckoutRequestID;
  const merchantRequestId = stkData.MerchantRequestID || `MR_${Date.now()}`;

  console.log(`[STK PUSH SUCCESSFUL] CheckoutRequestID: ${checkoutRequestId}, MerchantRequestID: ${merchantRequestId}, CustomerPhone: ${maskedPhone}, Amount: KES ${amount}`);

  const transaction: PaymentTransaction = {
    id: `tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    checkoutRequestId,
    merchantRequestId,
    articleId: params.articleId || (params.isTip ? 'general_tip' : 'custom'),
    articleTitle: params.articleTitle || 'Ink & Witness Reader Access',
    phoneNumber: formattedPhone,
    amount,
    currency: params.currency || 'KES',
    originalAmount: params.originalAmount ? Number(params.originalAmount) : amount,
    exchangeRate: params.exchangeRate ? Number(params.exchangeRate) : 1,
    exchangeRateTimestamp: params.exchangeRateTimestamp || new Date().toISOString(),
    paymentMethod: 'mpesa',
    type: params.isTip ? 'TIP' : 'PURCHASE',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    affiliateCode: params.affiliateCode || undefined,
    campaignCode: params.campaignCode || undefined,
    shortcodeUsed,
    userId: params.userId,
    userEmail: params.userEmail,
  };

  await store.saveTransaction(transaction);
  console.log(`[M-PESA TRANSACTION CREATED] Stored in database -> ID: ${transaction.id}, CheckoutRequestID: ${checkoutRequestId}, Status: PENDING`);

  return {
    success: true,
    checkoutRequestId,
    merchantRequestId,
    customerMessage: stkData.CustomerMessage || 'M-Pesa request accepted by Safaricom for processing.',
    message: 'M-Pesa request accepted by Safaricom. Waiting for handset delivery confirmation.',
    amount,
    phoneNumber: formattedPhone,
    articleTitle: transaction.articleTitle
  };
}

/**
 * 3. Safaricom Webhook Callback Processor
 * Authoritative Source of Truth for M-Pesa Payments
 */
export async function handleDarajaCallback(callbackBody: any): Promise<{ success: boolean; message: string }> {
  try {
    const stkCallback = callbackBody?.Body?.stkCallback;
    if (!stkCallback) {
      console.warn('[M-PESA CALLBACK WARNING] Empty or malformed callback payload received.');
      return { success: false, message: 'Invalid payload structure' };
    }

    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const merchantRequestId = stkCallback.MerchantRequestID || '';
    const resultCode = Number(stkCallback.ResultCode);
    const resultDesc = stkCallback.ResultDesc || '';
    console.log(`[M-PESA CALLBACK RECEIVED] CheckoutRequestID: ${checkoutRequestId || 'missing'}, ResultCode: ${Number.isFinite(resultCode) ? resultCode : 'invalid'}`);

    const tx = await store.loadTransaction(checkoutRequestId);
    if (!tx) {
      console.warn(`[M-PESA CALLBACK UNKNOWN] No matching transaction found for CheckoutRequestID: ${checkoutRequestId}`);
      return { success: true, message: 'Transaction not found in database' };
    }

    tx.merchantRequestId = tx.merchantRequestId || merchantRequestId;
    tx.resultCode = resultCode;
    tx.resultDesc = resultDesc;
    tx.updatedAt = new Date().toISOString();

    if (resultCode === 0) {
      // Payment Successful
      const metadata = stkCallback.CallbackMetadata?.Item || [];
      const receiptItem = metadata.find((i: any) => i.Name === 'MpesaReceiptNumber');
      const amountItem = metadata.find((i: any) => i.Name === 'Amount');
      const phoneItem = metadata.find((i: any) => i.Name === 'PhoneNumber');
      const dateItem = metadata.find((i: any) => i.Name === 'TransactionDate');

      const receipt = receiptItem?.Value ? String(receiptItem.Value).trim() : `REC_${Date.now()}`;
      const paidAmount = amountItem?.Value ? Number(amountItem.Value) : tx.amount;
      const paidPhone = phoneItem?.Value ? String(phoneItem.Value) : tx.phoneNumber;
      const transDate = dateItem?.Value ? String(dateItem.Value) : new Date().toISOString();

      tx.mpesaReceiptNumber = receipt;
      tx.receiptNumber = receipt;
      tx.amount = paidAmount;
      if (paidPhone) tx.phoneNumber = formatKenyanPhone(paidPhone);
      tx.transactionTimestamp = transDate;
      tx.status = 'SUCCESS';
      tx.completedAt = new Date().toISOString();
      tx.confirmedAt = new Date().toISOString();

      // Issue Reader License Download Token
      const confirmationResult = await store.confirmTransaction(checkoutRequestId, receipt);
      console.log(`[M-PESA CALLBACK SUCCESS] Confirmed! Piece: ${tx.articleId}, Receipt: ${receipt}, Token: ${confirmationResult.downloadToken ? 'ISSUED' : 'EXISTING'}`);
    } else if (resultCode === 1032) {
      tx.status = 'CANCELLED';
      tx.resultDesc = 'The transaction was cancelled on the mobile handset.';
      tx.completedAt = new Date().toISOString();
      await store.saveTransaction(tx);
      console.log(`[M-PESA CALLBACK CANCELLED] User cancelled on phone: ${checkoutRequestId}`);
    } else if (resultCode === 1037) {
      tx.status = 'TIMEOUT';
      tx.resultDesc = 'Payment prompt timed out without PIN entry.';
      tx.completedAt = new Date().toISOString();
      await store.saveTransaction(tx);
      console.log(`[M-PESA CALLBACK TIMEOUT] Prompt timed out on phone: ${checkoutRequestId}`);
    } else {
      tx.status = 'FAILED';
      tx.resultDesc = resultDesc || `Payment rejected by Safaricom (Code ${resultCode}).`;
      tx.completedAt = new Date().toISOString();
      await store.saveTransaction(tx);
      console.log(`[M-PESA CALLBACK FAILED] Code: ${resultCode}, Desc: ${resultDesc}`);
    }

    return { success: true, message: 'Callback processed successfully' };
  } catch (err: any) {
    console.error('[M-PESA CALLBACK EXCEPTION]:', err);
    return { success: false, message: err.message || 'Callback exception' };
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
    const transactionType = (process.env.MPESA_TRANSACTION_TYPE || mpesaSettings.transactionType || 'CustomerBuyGoodsOnline').trim();
    const configuredShortcode = (process.env.MPESA_SHORTCODE || mpesaSettings.shortcode || '').trim();
    const configuredStoreNumber = (process.env.MPESA_STORE_NUMBER || mpesaSettings.storeNumber || '').trim();
    const shortcode = (
      tx.shortcodeUsed ||
      (transactionType === 'CustomerBuyGoodsOnline' ? configuredStoreNumber : configuredShortcode)
    ).trim();

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

    console.log(`[M-PESA QUERY RESPONSE] Status: ${queryRes.status}, Body:`, JSON.stringify(queryData));

    let resolvedResult: any = { status: 'PENDING', resultDesc: 'Waiting for the Safaricom phone prompt…' };

    if (queryData?.ResponseCode === '0') {
      const qResultCode = Number(queryData.ResultCode);
      const qResultDesc = queryData.ResultDesc || '';

      if (qResultCode === 0) {
        // Query confirms success!
        const receipt = queryData.MpesaReceiptNumber || `REC_${Date.now()}`;
        tx.status = 'SUCCESS';
        tx.resultCode = 0;
        tx.resultDesc = qResultDesc || 'Payment confirmed via query.';
        tx.mpesaReceiptNumber = receipt;
        tx.completedAt = new Date().toISOString();
        const conf = await store.confirmTransaction(checkoutRequestId, receipt);
        resolvedResult = {
          status: 'SUCCESS',
          resultCode: 0,
          resultDesc: 'Payment confirmed.',
          mpesaReceiptNumber: receipt,
          downloadToken: conf.downloadToken,
          articleId: tx.articleId,
          isUnlocked: true
        };
      } else if (qResultCode === 1032) {
        tx.status = 'CANCELLED';
        tx.resultCode = 1032;
        tx.resultDesc = 'Payment was cancelled on phone handset.';
        tx.completedAt = new Date().toISOString();
        await store.saveTransaction(tx);
        resolvedResult = { status: 'CANCELLED', resultCode: 1032, resultDesc: tx.resultDesc };
      } else if (qResultCode === 1037) {
        tx.status = 'TIMEOUT';
        tx.resultCode = 1037;
        tx.resultDesc = 'Payment prompt timed out on phone.';
        tx.completedAt = new Date().toISOString();
        await store.saveTransaction(tx);
        resolvedResult = { status: 'TIMEOUT', resultCode: 1037, resultDesc: tx.resultDesc };
      } else if (isDarajaMerchantConfigurationError(qResultDesc)) {
        tx.status = 'FAILED';
        tx.resultCode = qResultCode;
        tx.resultDesc = 'Safaricom rejected the configured merchant number. Verify the transaction type, store/shortcode and till mapping.';
        tx.completedAt = new Date().toISOString();
        await store.saveTransaction(tx);
        resolvedResult = { status: 'FAILED', resultCode: qResultCode, resultDesc: tx.resultDesc };
      } else if (
        qResultDesc.toLowerCase().includes('duplicated msisdn') ||
        qResultDesc.toLowerCase().includes('existing ussd') ||
        qResultDesc.toLowerCase().includes('active session')
      ) {
        tx.status = 'FAILED';
        tx.resultCode = qResultCode;
        tx.resultDesc = 'Another M-Pesa prompt or USSD session is active on this phone. Close it, wait briefly, then retry.';
        tx.completedAt = new Date().toISOString();
        await store.saveTransaction(tx);
        resolvedResult = { status: 'FAILED', resultCode: qResultCode, resultDesc: tx.resultDesc };
      } else if (
        qResultDesc.toLowerCase().includes('in progress') ||
        qResultDesc.toLowerCase().includes('processing')
      ) {
        console.log(`[M-PESA QUERY IN-FLIGHT] Safaricom code ${qResultCode} ("${qResultDesc}") for ${checkoutRequestId}.`);
        if (txAgeMs > 120000) {
          tx.status = 'TIMEOUT';
          tx.resultCode = 1037;
          tx.resultDesc = 'Payment prompt timed out on phone.';
          tx.completedAt = new Date().toISOString();
          await store.saveTransaction(tx);
          resolvedResult = { status: 'TIMEOUT', resultCode: 1037, resultDesc: tx.resultDesc };
        } else {
          resolvedResult = {
            status: 'PENDING',
            resultDesc: 'Safaricom is processing the request. Check your handset for the M-Pesa prompt.'
          };
        }
      } else if (qResultCode === 1) {
        // Insufficient funds
        tx.status = 'FAILED';
        tx.resultCode = 1;
        tx.resultDesc = 'Insufficient funds in your M-Pesa account.';
        tx.completedAt = new Date().toISOString();
        await store.saveTransaction(tx);
        resolvedResult = { status: 'FAILED', resultCode: 1, resultDesc: tx.resultDesc };
      } else if (qResultCode === 2001) {
        // Wrong PIN
        tx.status = 'FAILED';
        tx.resultCode = 2001;
        tx.resultDesc = 'Incorrect M-Pesa PIN entered on your phone.';
        tx.completedAt = new Date().toISOString();
        await store.saveTransaction(tx);
        resolvedResult = { status: 'FAILED', resultCode: 2001, resultDesc: tx.resultDesc };
      } else {
        // Only fail for actual terminal non-zero codes after grace period
        if (txAgeMs > 30000) {
          tx.status = 'FAILED';
          tx.resultCode = qResultCode;
          tx.resultDesc = qResultDesc || 'Payment failed.';
          tx.completedAt = new Date().toISOString();
          await store.saveTransaction(tx);
          resolvedResult = { status: 'FAILED', resultCode: qResultCode, resultDesc: tx.resultDesc };
        } else {
          resolvedResult = { status: 'PENDING', resultDesc: 'Waiting for PIN on phone…' };
        }
      }
    } else {
      const errCode = String(queryData?.errorCode || '');
      const errMsg = String(queryData?.errorMessage || queryData?.ResponseDescription || '');
      const normalizedError = errMsg.toLowerCase();
      const merchantConfigurationError = isDarajaMerchantConfigurationError(normalizedError);
      if (merchantConfigurationError) {
        tx.status = 'FAILED';
        tx.resultCode = Number(queryData?.errorCode) || -1;
        tx.resultDesc = 'Safaricom rejected the configured merchant identity. Confirm that M-Pesa Express is active and that the live app, passkey, Store/Shortcode and Till belong to the same merchant account.';
        tx.completedAt = new Date().toISOString();
        await store.saveTransaction(tx);
        resolvedResult = { status: 'FAILED', resultCode: tx.resultCode, resultDesc: tx.resultDesc };
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

  await store.ensureTransactionsHydrated();

  // Look for confirmed transaction with this receipt
  const allTransactions = store.getTransactions();
  const matchedTx = allTransactions.find(tx => 
    (tx.mpesaReceiptNumber && tx.mpesaReceiptNumber.toUpperCase() === cleanReceipt) ||
    (tx.receiptNumber && tx.receiptNumber.toUpperCase() === cleanReceipt) ||
    (tx.bankReference && tx.bankReference.toUpperCase() === cleanReceipt)
  );

  if (matchedTx && (matchedTx.status === 'SUCCESS' || matchedTx.status === 'CONFIRMED' || matchedTx.status === 'PAID')) {
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
