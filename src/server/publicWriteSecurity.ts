import type { NextFunction, Request, RequestHandler, Response } from 'express';

type FieldKind = 'string' | 'number' | 'boolean' | 'object';

interface FieldRule {
  kind: FieldKind;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  allowed?: readonly string[];
  min?: number;
  max?: number;
  maxBytes?: number;
  normalize?: 'trim' | 'lower' | 'upper';
}

interface BodySchemaOptions {
  maxBytes: number;
  atLeastOneOf?: readonly string[];
  custom?: (body: Record<string, unknown>) => string | null;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_READER_HASH = /^[A-Za-z0-9:_-]+$/;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_PHONE = /^[0-9+()\-\s]{7,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const TELEMETRY_EVENTS = [
  'view', 'preview_read', 'unlock_start', 'unlock_complete', 'tip_start', 'tip_complete',
  'piece_view', 'preview_view', 'synopsis_view', 'unlock_select', 'payment_init'
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasUnsafeObjectKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasUnsafeObjectKey);
  }
  if (!isPlainObject(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return true;
    if (hasUnsafeObjectKey(child)) return true;
  }
  return false;
}

function isSafeTelemetryMetadata(value: unknown): boolean {
  if (!isPlainObject(value) || Object.keys(value).length > 10) return false;
  return Object.entries(value).every(([key, child]) => {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key)) return false;
    if (child === null || typeof child === 'boolean') return true;
    if (typeof child === 'number') return Number.isFinite(child);
    return typeof child === 'string' && child.length <= 200;
  });
}

function validateJsonBody(
  fields: Record<string, FieldRule>,
  options: BodySchemaOptions
): RequestHandler {
  const allowedFields = new Set(Object.keys(fields));

  return (req: Request, res: Response, next: NextFunction) => {
    const body = req.body === undefined ? {} : req.body;
    if (!isPlainObject(body) || hasUnsafeObjectKey(body)) {
      return res.status(400).json({ success: false, error: 'Request body must be a safe JSON object.' });
    }

    let bodyBytes = 0;
    try {
      bodyBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    } catch {
      return res.status(400).json({ success: false, error: 'Request body is not valid JSON.' });
    }
    if (bodyBytes > options.maxBytes) {
      return res.status(413).json({ success: false, error: 'Request body is too large.' });
    }

    const unexpected = Object.keys(body).filter(key => !allowedFields.has(key));
    if (unexpected.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Unexpected request field: ${unexpected[0]}.`
      });
    }

    for (const [field, rule] of Object.entries(fields)) {
      const raw = body[field];
      const missing = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
      if (missing) {
        if (rule.required) {
          return res.status(400).json({ success: false, error: `${field} is required.` });
        }
        continue;
      }

      if (rule.kind === 'string') {
        if (typeof raw !== 'string') {
          return res.status(400).json({ success: false, error: `${field} must be text.` });
        }
        let value = raw;
        if (rule.normalize === 'trim' || rule.normalize === 'lower' || rule.normalize === 'upper') {
          value = value.trim();
        }
        if (rule.normalize === 'lower') value = value.toLowerCase();
        if (rule.normalize === 'upper') value = value.toUpperCase();
        if (rule.minLength !== undefined && value.length < rule.minLength) {
          return res.status(400).json({ success: false, error: `${field} is too short.` });
        }
        if (rule.maxLength !== undefined && value.length > rule.maxLength) {
          return res.status(400).json({ success: false, error: `${field} is too long.` });
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          return res.status(400).json({ success: false, error: `${field} has an invalid format.` });
        }
        if (rule.allowed && !rule.allowed.includes(value)) {
          return res.status(400).json({ success: false, error: `${field} is not an allowed value.` });
        }
        body[field] = value;
        continue;
      }

      if (rule.kind === 'number') {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          return res.status(400).json({ success: false, error: `${field} must be a finite number.` });
        }
        if (rule.min !== undefined && raw < rule.min) {
          return res.status(400).json({ success: false, error: `${field} is below the allowed minimum.` });
        }
        if (rule.max !== undefined && raw > rule.max) {
          return res.status(400).json({ success: false, error: `${field} exceeds the allowed maximum.` });
        }
        continue;
      }

      if (rule.kind === 'boolean') {
        if (typeof raw !== 'boolean') {
          return res.status(400).json({ success: false, error: `${field} must be true or false.` });
        }
        continue;
      }

      if (!isPlainObject(raw) || hasUnsafeObjectKey(raw)) {
        return res.status(400).json({ success: false, error: `${field} must be a safe JSON object.` });
      }
      if (rule.maxBytes !== undefined && Buffer.byteLength(JSON.stringify(raw), 'utf8') > rule.maxBytes) {
        return res.status(413).json({ success: false, error: `${field} is too large.` });
      }
    }

    if (options.atLeastOneOf && !options.atLeastOneOf.some(field => {
      const value = body[field];
      return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
    })) {
      return res.status(400).json({
        success: false,
        error: `One of ${options.atLeastOneOf.join(', ')} is required.`
      });
    }

    const customError = options.custom?.(body);
    if (customError) {
      return res.status(400).json({ success: false, error: customError });
    }

    return next();
  };
}

const optionalId: FieldRule = { kind: 'string', maxLength: 128, pattern: SAFE_IDENTIFIER, normalize: 'trim' };
const optionalCode: FieldRule = { kind: 'string', maxLength: 64, pattern: SAFE_CODE, normalize: 'trim' };
const optionalPhone: FieldRule = { kind: 'string', maxLength: 32, pattern: SAFE_PHONE, normalize: 'trim' };

export const publicWriteValidators = {
  restorePurchase: validateJsonBody({
    transactionCode: { kind: 'string', required: true, maxLength: 64, pattern: SAFE_CODE, normalize: 'upper' },
    phoneNumber: optionalPhone
  }, { maxBytes: 2_048 }),

  manualAccess: validateJsonBody({
    articleId: { ...optionalId, required: true },
    phone: { ...optionalPhone, required: true }
  }, { maxBytes: 2_048 }),

  stkPush: validateJsonBody({
    articleId: optionalId,
    phoneNumber: optionalPhone,
    phone: optionalPhone,
    tel: optionalPhone,
    msisdn: optionalPhone,
    phone_number: optionalPhone,
    senderPhone: optionalPhone,
    amount: { kind: 'number', min: 1, max: 1_000_000 },
    isTip: { kind: 'boolean' },
    currency: { kind: 'string', maxLength: 3, pattern: CURRENCY, normalize: 'upper' },
    originalAmount: { kind: 'number', min: 0, max: 1_000_000 },
    exchangeRate: { kind: 'number', min: 0, max: 1_000_000 },
    exchangeRateTimestamp: { kind: 'string', maxLength: 64, normalize: 'trim' },
    affiliateCode: optionalCode,
    campaignCode: optionalCode
  }, {
    maxBytes: 8_192,
    atLeastOneOf: ['phoneNumber', 'phone', 'tel', 'msisdn', 'phone_number', 'senderPhone']
  }),

  bankOrder: validateJsonBody({
    articleId: optionalId,
    customerName: { kind: 'string', maxLength: 120, normalize: 'trim' },
    email: { kind: 'string', maxLength: 254, pattern: EMAIL, normalize: 'lower' },
    phoneNumber: optionalPhone,
    currency: { kind: 'string', maxLength: 3, pattern: CURRENCY, normalize: 'upper' },
    amount: { kind: 'number', min: 1, max: 1_000_000 },
    affiliateCode: optionalCode,
    campaignCode: optionalCode
  }, { maxBytes: 8_192 }),

  bankReference: validateJsonBody({
    checkoutRequestId: { kind: 'string', required: true, maxLength: 160, pattern: SAFE_IDENTIFIER, normalize: 'trim' },
    customerRef: { kind: 'string', required: true, maxLength: 80, pattern: SAFE_CODE, normalize: 'upper' },
    senderPhone: optionalPhone
  }, { maxBytes: 4_096 }),

  analytics: validateJsonBody({
    eventType: { kind: 'string', required: true, maxLength: 32, allowed: TELEMETRY_EVENTS, normalize: 'trim' },
    articleId: optionalId,
    category: { kind: 'string', maxLength: 100, normalize: 'trim' },
    readerHash: { kind: 'string', required: true, maxLength: 128, pattern: SAFE_READER_HASH, normalize: 'trim' },
    metadata: { kind: 'object', maxBytes: 2_048 }
  }, {
    maxBytes: 4_096,
    custom: body => body.metadata !== undefined && !isSafeTelemetryMetadata(body.metadata)
      ? 'metadata must contain at most 10 short primitive fields.'
      : null
  }),

  like: validateJsonBody({
    readerHash: { kind: 'string', required: true, maxLength: 128, pattern: SAFE_READER_HASH, normalize: 'trim' }
  }, { maxBytes: 1_024 }),

  comment: validateJsonBody({
    content: { kind: 'string', required: true, minLength: 1, maxLength: 3_000, normalize: 'trim' },
    readerName: { kind: 'string', maxLength: 80, normalize: 'trim' },
    readerEmail: { kind: 'string', maxLength: 254, pattern: EMAIL, normalize: 'lower' },
    readerHash: { kind: 'string', required: true, maxLength: 128, pattern: SAFE_READER_HASH, normalize: 'trim' }
  }, { maxBytes: 8_192 }),

  commentReport: validateJsonBody({
    reason: { kind: 'string', maxLength: 500, normalize: 'trim' }
  }, { maxBytes: 2_048 }),

  commentDelete: validateJsonBody({
    readerHash: { kind: 'string', maxLength: 128, pattern: SAFE_READER_HASH, normalize: 'trim' }
  }, { maxBytes: 1_024 }),

  authLogin: validateJsonBody({
    email: { kind: 'string', required: true, maxLength: 254, pattern: EMAIL, normalize: 'lower' },
    password: { kind: 'string', required: true, maxLength: 256 }
  }, { maxBytes: 2_048 }),

  authRegister: validateJsonBody({
    email: { kind: 'string', required: true, maxLength: 254, pattern: EMAIL, normalize: 'lower' },
    password: { kind: 'string', required: true, maxLength: 256 },
    name: { kind: 'string', maxLength: 120, normalize: 'trim' }
  }, { maxBytes: 4_096 }),

  linkPurchase: validateJsonBody({
    query: { kind: 'string', required: true, maxLength: 160, normalize: 'trim' }
  }, { maxBytes: 2_048 }),

  affiliateClick: validateJsonBody({
    ref: { kind: 'string', required: true, maxLength: 64, pattern: SAFE_CODE, normalize: 'trim' },
    articleId: optionalId,
    campaign: optionalCode
  }, { maxBytes: 2_048 }),

  affiliateRegister: validateJsonBody({
    name: { kind: 'string', required: true, maxLength: 120, normalize: 'trim' },
    email: { kind: 'string', required: true, maxLength: 254, pattern: EMAIL, normalize: 'lower' },
    phone: { ...optionalPhone, required: true },
    password: { kind: 'string', required: true, maxLength: 256 },
    payoutMethod: { kind: 'string', allowed: ['mpesa', 'bank', 'paypal'], normalize: 'lower' },
    payoutDetails: { kind: 'object', maxBytes: 4_096 },
    affiliateCode: optionalCode,
    preferredCode: optionalCode,
    acceptedTerms: { kind: 'boolean', required: true },
    termsVersion: { kind: 'string', maxLength: 32, normalize: 'trim' }
  }, { maxBytes: 12_288 }),

  affiliateLogin: validateJsonBody({
    login: { kind: 'string', maxLength: 254, normalize: 'trim' },
    emailOrCode: { kind: 'string', maxLength: 254, normalize: 'trim' },
    email: { kind: 'string', maxLength: 254, normalize: 'trim' },
    code: optionalCode,
    password: { kind: 'string', required: true, maxLength: 256 }
  }, {
    maxBytes: 2_048,
    atLeastOneOf: ['login', 'emailOrCode', 'email', 'code']
  })
};
