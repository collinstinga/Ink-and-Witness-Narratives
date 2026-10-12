import crypto from 'crypto';

export const SUBSCRIPTION_PLAN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;
export const READER_SUBSCRIPTION_ID_PATTERN = /^sub_[a-f0-9]{64}$/;
export const SUBSCRIPTION_PURCHASE_SNAPSHOT_VERSION = 1 as const;

const MAX_SUBSCRIPTION_PLANS = 24;
const MAX_PLAN_NAME_LENGTH = 80;
const MAX_PLAN_DESCRIPTION_LENGTH = 500;
const MAX_PLAN_BADGE_LENGTH = 40;
const MAX_IMAGE_URL_LENGTH = 2_048;
const MAX_IMAGE_ALT_LENGTH = 160;
const MAX_PRICE_KES = 1_000_000;
const MAX_DURATION_MONTHS = 120;
const MAX_READER_ID_BYTES = 1_024;

const PLAN_KEYS = new Set([
  'id',
  'name',
  'description',
  'priceKes',
  'durationMonths',
  'renewable',
  'isPublished',
  'order',
  'badge',
  'coverImage',
  'coverImageAlt',
  'coverPosition',
  'createdAt',
  'updatedAt'
]);

const SNAPSHOT_KEYS = new Set([
  'version',
  'planId',
  'planName',
  'priceKes',
  'durationMonths',
  'renewable'
]);

export interface SubscriptionCoverPosition {
  x: number;
  y: number;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  priceKes: number;
  durationMonths: number;
  renewable: boolean;
  isPublished: boolean;
  order: number;
  badge?: string;
  coverImage?: string;
  coverImageAlt?: string;
  coverPosition?: SubscriptionCoverPosition;
  createdAt?: string;
  updatedAt?: string;
}

export type PublicSubscriptionPlan = Pick<
  SubscriptionPlan,
  | 'id'
  | 'name'
  | 'description'
  | 'priceKes'
  | 'durationMonths'
  | 'renewable'
  | 'order'
  | 'badge'
  | 'coverImage'
  | 'coverImageAlt'
  | 'coverPosition'
>;

export interface SubscriptionPurchaseSnapshot {
  version: typeof SUBSCRIPTION_PURCHASE_SNAPSHOT_VERSION;
  planId: string;
  planName: string;
  priceKes: number;
  durationMonths: number;
  renewable: boolean;
}

export interface SubscriptionRenewalWindow {
  /** The later of the existing expiry and the payment settlement time. */
  renewalBaseAt: string;
  /** The exact UTC calendar-month expiry calculated from renewalBaseAt. */
  expiresAt: string;
}

export class SubscriptionValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SubscriptionValidationError';
  }
}

function freezePlan(plan: SubscriptionPlan): Readonly<SubscriptionPlan> {
  if (plan.coverPosition) Object.freeze(plan.coverPosition);
  return Object.freeze(plan);
}

/**
 * Stable seed plans. IDs are deliberately immutable because payment snapshots
 * and historical subscription records refer to them. All display fields can
 * be copied into durable configuration and edited from the Writer Portal.
 */
export const DEFAULT_SUBSCRIPTION_PLANS: readonly Readonly<SubscriptionPlan>[] = Object.freeze([
  freezePlan({
    id: 'first-chapter-3-months',
    name: 'The First Chapter',
    description: 'Three months of full-catalogue reading.',
    priceKes: 500,
    durationMonths: 3,
    renewable: true,
    isPublished: true,
    order: 0,
    coverImage: '/assets/subscriptions/the-first-chapter.png',
    coverImageAlt: 'An open book beginning a new chapter',
    coverPosition: { x: 50, y: 50 }
  }),
  freezePlan({
    id: 'long-read-6-months',
    name: 'The Long Read',
    description: 'Six renewable months to stay with every story.',
    priceKes: 1_000,
    durationMonths: 6,
    renewable: true,
    isPublished: true,
    order: 1,
    badge: 'Reader favourite',
    coverImage: '/assets/subscriptions/the-long-read.png',
    coverImageAlt: 'A quiet reading lamp beside a long-form manuscript',
    coverPosition: { x: 50, y: 50 }
  }),
  freezePlan({
    id: 'deep-archive-9-months',
    name: 'The Deep Archive',
    description: 'Nine months for readers who want to go deeper.',
    priceKes: 1_500,
    durationMonths: 9,
    renewable: true,
    isPublished: true,
    order: 2,
    coverImage: '/assets/subscriptions/the-deep-archive.png',
    coverImageAlt: 'Shelves of literary archives glowing in deep blue light',
    coverPosition: { x: 50, y: 50 }
  }),
  freezePlan({
    id: 'full-witness-12-months',
    name: 'The Full Witness',
    description: 'A full year of access to the published catalogue.',
    priceKes: 2_000,
    durationMonths: 12,
    renewable: true,
    isPublished: true,
    order: 3,
    badge: 'Best value',
    coverImage: '/assets/subscriptions/the-full-witness.png',
    coverImageAlt: 'A complete year of stories represented by a luminous library',
    coverPosition: { x: 50, y: 50 }
  })
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  code: string,
  subject: string
): void {
  const unexpected = Object.keys(value).find(key => !allowed.has(key));
  if (unexpected) {
    throw new SubscriptionValidationError(code, `${subject} contains an unsupported field: ${unexpected}.`);
  }
}

function normalizeText(
  value: unknown,
  field: string,
  maximumLength: number,
  options: { required?: boolean } = {}
): string | undefined {
  if (value === undefined && !options.required) return undefined;
  if (typeof value !== 'string') {
    throw new SubscriptionValidationError('SUBSCRIPTION_INVALID_TEXT', `${field} must be text.`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (
    (options.required && !normalized)
    || normalized.length > maximumLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new SubscriptionValidationError('SUBSCRIPTION_INVALID_TEXT', `${field} is invalid.`);
  }
  return normalized || undefined;
}

function normalizePlanId(value: unknown, field = 'Plan ID'): string {
  if (typeof value !== 'string' || value !== value.trim() || !SUBSCRIPTION_PLAN_ID_PATTERN.test(value)) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_PLAN_ID',
      `${field} must be a lowercase, hyphenated identifier.`
    );
  }
  return value;
}

function normalizePositiveInteger(
  value: unknown,
  field: string,
  maximum: number,
  code: string
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new SubscriptionValidationError(code, `${field} must be a whole number between 1 and ${maximum}.`);
  }
  return value;
}

function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new SubscriptionValidationError('SUBSCRIPTION_INVALID_BOOLEAN', `${field} must be true or false.`);
  }
  return value;
}

function normalizeOrder(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_ORDER',
      'Plan order must be a whole number between 0 and 10000.'
    );
  }
  return value;
}

function normalizeCoverImage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new SubscriptionValidationError('SUBSCRIPTION_INVALID_IMAGE', 'Plan cover image is invalid.');
  }
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > MAX_IMAGE_URL_LENGTH
    || /[\\\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new SubscriptionValidationError('SUBSCRIPTION_INVALID_IMAGE', 'Plan cover image is invalid.');
  }

  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized;

  try {
    const parsed = new URL(normalized);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.hash
    ) {
      throw new Error('unsafe image URL');
    }
    return parsed.toString();
  } catch {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_IMAGE',
      'Plan cover image must be a local path or an HTTPS URL.'
    );
  }
}

function normalizeCoverPosition(value: unknown): SubscriptionCoverPosition | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'x' && key !== 'y')) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_COVER_POSITION',
      'Plan cover position is invalid.'
    );
  }
  const { x, y } = value;
  if (
    typeof x !== 'number'
    || typeof y !== 'number'
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || x < 0
    || x > 100
    || y < 0
    || y > 100
  ) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_COVER_POSITION',
      'Plan cover position must use percentages between 0 and 100.'
    );
  }
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10
  };
}

function normalizeIsoTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new SubscriptionValidationError('SUBSCRIPTION_INVALID_TIMESTAMP', `${field} is invalid.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_TIMESTAMP',
      `${field} must be a canonical UTC timestamp.`
    );
  }
  return value;
}

/** Strictly validates and returns a fresh canonical plan object. */
export function normalizeSubscriptionPlan(value: unknown): SubscriptionPlan {
  if (!isRecord(value)) {
    throw new SubscriptionValidationError('SUBSCRIPTION_INVALID_PLAN', 'Subscription plan is invalid.');
  }
  requireOnlyKeys(value, PLAN_KEYS, 'SUBSCRIPTION_INVALID_PLAN', 'Subscription plan');

  const name = normalizeText(value.name, 'Plan name', MAX_PLAN_NAME_LENGTH, { required: true }) as string;
  const description = normalizeText(
    value.description,
    'Plan description',
    MAX_PLAN_DESCRIPTION_LENGTH,
    { required: true }
  ) as string;
  const badge = normalizeText(value.badge, 'Plan badge', MAX_PLAN_BADGE_LENGTH);
  const coverImageAlt = normalizeText(value.coverImageAlt, 'Plan image description', MAX_IMAGE_ALT_LENGTH);
  const coverImage = normalizeCoverImage(value.coverImage);
  const coverPosition = normalizeCoverPosition(value.coverPosition);
  const createdAt = normalizeIsoTimestamp(value.createdAt, 'Plan creation time');
  const updatedAt = normalizeIsoTimestamp(value.updatedAt, 'Plan update time');

  return {
    id: normalizePlanId(value.id),
    name,
    description,
    priceKes: normalizePositiveInteger(
      value.priceKes,
      'Plan price',
      MAX_PRICE_KES,
      'SUBSCRIPTION_INVALID_PRICE'
    ),
    durationMonths: normalizePositiveInteger(
      value.durationMonths,
      'Plan duration',
      MAX_DURATION_MONTHS,
      'SUBSCRIPTION_INVALID_DURATION'
    ),
    renewable: normalizeBoolean(value.renewable, 'Plan renewable setting'),
    isPublished: normalizeBoolean(value.isPublished, 'Plan published setting'),
    order: normalizeOrder(value.order),
    ...(badge ? { badge } : {}),
    ...(coverImage ? { coverImage } : {}),
    ...(coverImageAlt ? { coverImageAlt } : {}),
    ...(coverPosition ? { coverPosition } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {})
  };
}

/** Validates a bounded list, rejects duplicate stable IDs, and returns display order. */
export function normalizeSubscriptionPlans(value: unknown): SubscriptionPlan[] {
  if (!Array.isArray(value) || value.length > MAX_SUBSCRIPTION_PLANS) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_PLAN_LIST',
      `Subscription plans must be a list of at most ${MAX_SUBSCRIPTION_PLANS} plans.`
    );
  }
  const seen = new Set<string>();
  const plans = value.map(candidate => {
    const plan = normalizeSubscriptionPlan(candidate);
    if (seen.has(plan.id)) {
      throw new SubscriptionValidationError(
        'SUBSCRIPTION_DUPLICATE_PLAN_ID',
        `Subscription plan ID ${plan.id} is duplicated.`
      );
    }
    seen.add(plan.id);
    return plan;
  });
  return plans.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
}

/** Removes administrative state and timestamps before a plan reaches readers. */
export function toPublicSubscriptionPlan(value: unknown): PublicSubscriptionPlan {
  const plan = normalizeSubscriptionPlan(value);
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceKes: plan.priceKes,
    durationMonths: plan.durationMonths,
    renewable: plan.renewable,
    order: plan.order,
    ...(plan.badge ? { badge: plan.badge } : {}),
    ...(plan.coverImage ? { coverImage: plan.coverImage } : {}),
    ...(plan.coverImageAlt ? { coverImageAlt: plan.coverImageAlt } : {}),
    ...(plan.coverPosition ? { coverPosition: { ...plan.coverPosition } } : {})
  };
}

/** Projects only explicitly published plans for a public response. */
export function projectPublicSubscriptionPlans(value: unknown): PublicSubscriptionPlan[] {
  return normalizeSubscriptionPlans(value)
    .filter(plan => plan.isPublished)
    .map(toPublicSubscriptionPlan);
}

/**
 * Accepts only the public WhatsApp Channel origin and path. Query strings,
 * fragments, credentials, lookalike hosts, and insecure URLs are rejected.
 */
export function normalizeWhatsAppChannelUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256 || value !== value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:'
      || (parsed.hostname !== 'whatsapp.com' && parsed.hostname !== 'www.whatsapp.com')
      || parsed.port
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
    const match = /^\/channel\/([A-Za-z0-9]{20,64})\/?$/.exec(parsed.pathname);
    if (!match) return null;
    return `https://whatsapp.com/channel/${match[1]}`;
  } catch {
    return null;
  }
}

export function isSafeWhatsAppChannelUrl(value: unknown): value is string {
  return normalizeWhatsAppChannelUrl(value) !== null;
}

function normalizeUtcInstant(value: unknown, field: string): Date {
  let timestamp: number;
  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    timestamp = value;
  } else if (typeof value === 'string') {
    timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
      throw new SubscriptionValidationError(
        'SUBSCRIPTION_INVALID_TIMESTAMP',
        `${field} must be a valid UTC timestamp.`
      );
    }
  } else {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_TIMESTAMP',
      `${field} must be a valid UTC timestamp.`
    );
  }
  if (!Number.isFinite(timestamp)) {
    throw new SubscriptionValidationError('SUBSCRIPTION_INVALID_TIMESTAMP', `${field} is invalid.`);
  }
  return new Date(timestamp);
}

/**
 * Adds whole UTC calendar months and clamps an end-of-month date to the last
 * valid day in the destination month (for example, Jan 31 + 1 = Feb 28/29).
 */
export function addUtcCalendarMonths(value: unknown, durationMonths: unknown): string {
  const source = normalizeUtcInstant(value, 'Subscription date');
  const months = normalizePositiveInteger(
    durationMonths,
    'Subscription duration',
    MAX_DURATION_MONTHS,
    'SUBSCRIPTION_INVALID_DURATION'
  );
  const sourceYear = source.getUTCFullYear();
  const sourceMonth = source.getUTCMonth();
  const targetMonthIndex = sourceMonth + months;
  const targetYear = sourceYear + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(source.getUTCDate(), lastDayInTargetMonth);
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds()
  )).toISOString();
}

/**
 * Starts a renewal at max(currentExpiry, settledAt), so an active reader never
 * loses remaining time while an expired reader starts from confirmed payment.
 */
export function calculateSubscriptionRenewalWindow(input: {
  currentExpiry?: unknown;
  settledAt: unknown;
  durationMonths: unknown;
}): SubscriptionRenewalWindow {
  const settledAt = normalizeUtcInstant(input.settledAt, 'Payment settlement time');
  const currentExpiry = input.currentExpiry === undefined || input.currentExpiry === null
    ? null
    : normalizeUtcInstant(input.currentExpiry, 'Current subscription expiry');
  const renewalBase = currentExpiry && currentExpiry.getTime() > settledAt.getTime()
    ? currentExpiry
    : settledAt;
  const renewalBaseAt = renewalBase.toISOString();
  return {
    renewalBaseAt,
    expiresAt: addUtcCalendarMonths(renewalBaseAt, input.durationMonths)
  };
}

/** A non-reversible, stable document ID for one authenticated reader account. */
export function getReaderSubscriptionId(userId: unknown): string {
  if (
    typeof userId !== 'string'
    || userId.length === 0
    || userId !== userId.trim()
    || Buffer.byteLength(userId, 'utf8') > MAX_READER_ID_BYTES
    || /[\u0000-\u001f\u007f]/.test(userId)
  ) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_READER_ID',
      'A valid reader account is required.'
    );
  }
  const digest = crypto.createHash('sha256').update(userId, 'utf8').digest('hex');
  return `sub_${digest}`;
}

export function createSubscriptionPurchaseSnapshot(value: unknown): SubscriptionPurchaseSnapshot {
  const plan = normalizeSubscriptionPlan(value);
  if (!plan.isPublished) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_PLAN_UNAVAILABLE',
      'This subscription plan is not currently available.'
    );
  }
  return {
    version: SUBSCRIPTION_PURCHASE_SNAPSHOT_VERSION,
    planId: plan.id,
    planName: plan.name,
    priceKes: plan.priceKes,
    durationMonths: plan.durationMonths,
    renewable: plan.renewable
  };
}

/** Validates the immutable commercial fields captured before payment starts. */
export function validateSubscriptionPurchaseSnapshot(value: unknown): SubscriptionPurchaseSnapshot {
  if (!isRecord(value)) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_PURCHASE_SNAPSHOT',
      'Subscription purchase details are invalid.'
    );
  }
  requireOnlyKeys(
    value,
    SNAPSHOT_KEYS,
    'SUBSCRIPTION_INVALID_PURCHASE_SNAPSHOT',
    'Subscription purchase details'
  );
  if (value.version !== SUBSCRIPTION_PURCHASE_SNAPSHOT_VERSION) {
    throw new SubscriptionValidationError(
      'SUBSCRIPTION_INVALID_PURCHASE_SNAPSHOT',
      'Subscription purchase details use an unsupported version.'
    );
  }
  return {
    version: SUBSCRIPTION_PURCHASE_SNAPSHOT_VERSION,
    planId: normalizePlanId(value.planId, 'Snapshot plan ID'),
    planName: normalizeText(
      value.planName,
      'Snapshot plan name',
      MAX_PLAN_NAME_LENGTH,
      { required: true }
    ) as string,
    priceKes: normalizePositiveInteger(
      value.priceKes,
      'Snapshot price',
      MAX_PRICE_KES,
      'SUBSCRIPTION_INVALID_PRICE'
    ),
    durationMonths: normalizePositiveInteger(
      value.durationMonths,
      'Snapshot duration',
      MAX_DURATION_MONTHS,
      'SUBSCRIPTION_INVALID_DURATION'
    ),
    renewable: normalizeBoolean(value.renewable, 'Snapshot renewable setting')
  };
}

export function isSubscriptionPurchaseSnapshot(value: unknown): value is SubscriptionPurchaseSnapshot {
  try {
    validateSubscriptionPurchaseSnapshot(value);
    return true;
  } catch {
    return false;
  }
}
