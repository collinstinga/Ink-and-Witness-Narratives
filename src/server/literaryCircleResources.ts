import crypto from 'crypto';
import type {
  AffiliateAuditLogEntry,
  LiteraryCirclePromotionalResource,
  LiteraryCircleResourceDestination,
  LiteraryCircleResourceKind,
  LiteraryCircleResourceLibrary,
  SavedAssetRecord
} from '../types.js';
import { getDb, getFirestoreDoc, sanitizeForFirestore } from './db.js';
import { sanitizeImageDataUrl } from './imageSecurity.js';

export const LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID = 'literary_circle_resources';
export const LITERARY_CIRCLE_RESOURCES_SCHEMA_VERSION = 1 as const;
export const MAX_LITERARY_CIRCLE_RESOURCES = 24;
export const LITERARY_CIRCLE_PRIVATE_ASSET_SCOPE = 'literary_circle_private' as const;

const RESOURCE_COLLECTION = 'site_configs';
const ASSET_COLLECTION = 'uploaded_assets';
const AUDIT_COLLECTION = 'affiliate_audit';
const SAFE_RESOURCE_ID = /^[a-z0-9](?:[a-z0-9_-]{0,94}[a-z0-9])?$/;
const SAFE_DESTINATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const SAFE_ASSET_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,198}[A-Za-z0-9])?$/;
const SAFE_CAMPAIGN_CODE = /^[A-Z0-9](?:[A-Z0-9_]{0,62}[A-Z0-9])?$/;
const RESOURCE_KINDS = new Set<LiteraryCircleResourceKind>([
  'campaign_kit',
  'social_copy',
  'piece_cover',
  'excerpt',
  'guidance',
  'subscription_campaign'
]);
const DESTINATION_KINDS = new Set(['piece', 'collection', 'bundle', 'subscription']);

export const DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY: LiteraryCircleResourceLibrary = {
  schemaVersion: LITERARY_CIRCLE_RESOURCES_SCHEMA_VERSION,
  revision: 0,
  enabled: false,
  title: 'Promotional resources',
  description: 'Writer-approved campaign copy, covers and promotional guidance for Literary Circle affiliates.',
  items: []
};

export class LiteraryCircleResourcesValidationError extends Error {
  readonly code = 'LITERARY_CIRCLE_RESOURCES_INVALID';
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'LiteraryCircleResourcesValidationError';
  }
}

export class LiteraryCircleResourcesConflictError extends Error {
  readonly code = 'LITERARY_CIRCLE_RESOURCES_CONFLICT';
  readonly statusCode = 409;

  constructor() {
    super('Promotional resources changed since this editor was opened. Reload the latest library before saving again.');
    this.name = 'LiteraryCircleResourcesConflictError';
  }
}

export interface LiteraryCircleResourceAssetRecord extends SavedAssetRecord {
  target: 'affiliate_resource';
  accessScope: 'public' | typeof LITERARY_CIRCLE_PRIVATE_ASSET_SCOPE;
  resourceId: string;
  shareable: boolean;
  width: number;
  height: number;
  sanitized: true;
}

export interface LiteraryCircleResourceAssetAssociationResult {
  library: LiteraryCircleResourceLibrary;
  asset: Omit<LiteraryCircleResourceAssetRecord, 'dataUrl'>;
  audit: AffiliateAuditLogEntry;
}

export interface LiteraryCircleResourceMutationResult {
  library: LiteraryCircleResourceLibrary;
  audit: AffiliateAuditLogEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find(key => !allowedKeys.has(key));
  if (unknown) {
    throw new LiteraryCircleResourcesValidationError(`${label} contains an unsupported “${unknown}” field.`);
  }
}

function safeRequiredText(value: unknown, fallback: string, maximum: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || fallback).slice(0, maximum);
}

function safeOptionalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maximum);
  return normalized || undefined;
}

function safeIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function safeInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function normalizeDestination(value: unknown): LiteraryCircleResourceDestination {
  if (!isRecord(value)) return { kind: 'home' };
  if (value.kind === 'home') return { kind: 'home' };
  const kind = typeof value.kind === 'string' && DESTINATION_KINDS.has(value.kind)
    ? value.kind as Exclude<LiteraryCircleResourceDestination['kind'], 'home'>
    : null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  return kind && SAFE_DESTINATION_ID.test(id)
    ? { kind, id }
    : { kind: 'home' };
}

function normalizeResource(value: unknown, index: number): LiteraryCirclePromotionalResource | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : '';
  const title = safeOptionalText(value.title, 120);
  const createdAt = safeIso(value.createdAt);
  const updatedAt = safeIso(value.updatedAt);
  if (!SAFE_RESOURCE_ID.test(id) || !title || !createdAt || !updatedAt) return null;

  const kind = RESOURCE_KINDS.has(value.kind as LiteraryCircleResourceKind)
    ? value.kind as LiteraryCircleResourceKind
    : 'guidance';
  const campaignCodeValue = typeof value.campaignCode === 'string'
    ? value.campaignCode.trim().toUpperCase()
    : '';
  const campaignCode = SAFE_CAMPAIGN_CODE.test(campaignCodeValue) ? campaignCodeValue : undefined;
  const assetIdValue = typeof value.assetId === 'string' ? value.assetId.trim() : '';
  const assetId = SAFE_ASSET_ID.test(assetIdValue) ? assetIdValue : undefined;
  const publishedAt = safeIso(value.publishedAt);
  const expiresAt = safeIso(value.expiresAt);
  if (
    (value.publishedAt !== undefined && value.publishedAt !== '' && !publishedAt)
    || (value.expiresAt !== undefined && value.expiresAt !== '' && !expiresAt)
  ) return null;

  return {
    id,
    kind,
    title,
    ...(safeOptionalText(value.description, 500) ? { description: safeOptionalText(value.description, 500) } : {}),
    ...(safeOptionalText(value.body, 4_000) ? { body: safeOptionalText(value.body, 4_000) } : {}),
    destination: normalizeDestination(value.destination),
    ...(campaignCode ? { campaignCode } : {}),
    ...(assetId ? { assetId } : {}),
    ...(safeOptionalText(value.assetAlt, 300) ? { assetAlt: safeOptionalText(value.assetAlt, 300) } : {}),
    isPublished: value.isPublished === true,
    order: safeInteger(value.order, index, 0, 10_000),
    ...(publishedAt ? { publishedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    createdAt,
    updatedAt
  };
}

function sortResources(items: LiteraryCirclePromotionalResource[]): LiteraryCirclePromotionalResource[] {
  return [...items].sort((left, right) => (
    left.order - right.order
    || (Date.parse(right.publishedAt || '') || 0) - (Date.parse(left.publishedAt || '') || 0)
    || left.id.localeCompare(right.id)
  ));
}

export function normalizeLiteraryCircleResourceLibrary(value: unknown): LiteraryCircleResourceLibrary {
  if (!isRecord(value) || value.schemaVersion !== LITERARY_CIRCLE_RESOURCES_SCHEMA_VERSION) {
    return {
      ...DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY,
      items: []
    };
  }

  const byId = new Map<string, LiteraryCirclePromotionalResource>();
  const sourceItems = Array.isArray(value.items) ? value.items.slice(0, MAX_LITERARY_CIRCLE_RESOURCES) : [];
  sourceItems.forEach((raw, index) => {
    const item = normalizeResource(raw, index);
    if (item) byId.set(item.id, item);
  });

  return {
    schemaVersion: LITERARY_CIRCLE_RESOURCES_SCHEMA_VERSION,
    revision: safeInteger(value.revision, 0, 0, Number.MAX_SAFE_INTEGER),
    enabled: value.enabled === true,
    title: safeRequiredText(value.title, DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY.title, 120),
    description: safeRequiredText(value.description, DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY.description, 600),
    items: sortResources([...byId.values()]),
    ...(safeIso(value.updatedAt) ? { updatedAt: safeIso(value.updatedAt) } : {}),
    ...(safeOptionalText(value.updatedBy, 120) ? { updatedBy: safeOptionalText(value.updatedBy, 120) } : {})
  };
}

function validateDestination(value: unknown, label: string): void {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new LiteraryCircleResourcesValidationError(`${label} requires a destination.`);
  }
  if (value.kind === 'home') {
    if (value.id !== undefined && value.id !== '') {
      throw new LiteraryCircleResourcesValidationError(`${label} homepage destination cannot include an identifier.`);
    }
    return;
  }
  if (!DESTINATION_KINDS.has(value.kind)) {
    throw new LiteraryCircleResourcesValidationError(`${label} has an unsupported destination type.`);
  }
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!SAFE_DESTINATION_ID.test(id)) {
    throw new LiteraryCircleResourcesValidationError(`${label} requires a safe destination identifier.`);
  }
}

function validateOptionalText(value: unknown, maximum: number, message: string): void {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || value.trim().length > maximum) {
    throw new LiteraryCircleResourcesValidationError(message);
  }
}

export function validateLiteraryCircleResourceLibrary(value: unknown): LiteraryCircleResourceLibrary {
  if (!isRecord(value)) {
    throw new LiteraryCircleResourcesValidationError('Promotional resources must be provided as an object.');
  }
  if (value.schemaVersion !== LITERARY_CIRCLE_RESOURCES_SCHEMA_VERSION) {
    throw new LiteraryCircleResourcesValidationError('Promotional resources use an unsupported schema version.');
  }
  rejectUnknownKeys(
    value,
    ['schemaVersion', 'revision', 'enabled', 'title', 'description', 'items', 'updatedAt', 'updatedBy'],
    'Promotional resources'
  );
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw new LiteraryCircleResourcesValidationError('Promotional resources require a non-negative revision.');
  }
  if (typeof value.enabled !== 'boolean') {
    throw new LiteraryCircleResourcesValidationError('Promotional resources enabled state must be true or false.');
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 120) {
    throw new LiteraryCircleResourcesValidationError('Promotional resources require a title of at most 120 characters.');
  }
  if (typeof value.description !== 'string' || !value.description.trim() || value.description.trim().length > 600) {
    throw new LiteraryCircleResourcesValidationError('Promotional resources require a description of at most 600 characters.');
  }
  if (!Array.isArray(value.items) || value.items.length > MAX_LITERARY_CIRCLE_RESOURCES) {
    throw new LiteraryCircleResourcesValidationError(`Configure at most ${MAX_LITERARY_CIRCLE_RESOURCES} promotional resources.`);
  }

  const ids = new Set<string>();
  const assetIds = new Set<string>();
  for (const [index, raw] of value.items.entries()) {
    const label = `Promotional resource ${index + 1}`;
    if (!isRecord(raw)) throw new LiteraryCircleResourcesValidationError(`${label} is invalid.`);
    rejectUnknownKeys(
      raw,
      [
        'id', 'kind', 'title', 'description', 'body', 'destination', 'campaignCode',
        'assetId', 'assetAlt', 'isPublished', 'order', 'publishedAt', 'expiresAt',
        'createdAt', 'updatedAt'
      ],
      label
    );
    const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
    if (!SAFE_RESOURCE_ID.test(id)) {
      throw new LiteraryCircleResourcesValidationError(`${label} requires a stable identifier.`);
    }
    if (ids.has(id)) {
      throw new LiteraryCircleResourcesValidationError(`Promotional resource identifier “${id}” is duplicated.`);
    }
    ids.add(id);
    if (!RESOURCE_KINDS.has(raw.kind as LiteraryCircleResourceKind)) {
      throw new LiteraryCircleResourcesValidationError(`${label} has an unsupported kind.`);
    }
    if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.trim().length > 120) {
      throw new LiteraryCircleResourcesValidationError(`${label} requires a title of at most 120 characters.`);
    }
    validateOptionalText(raw.description, 500, `${label} description is too long.`);
    validateOptionalText(raw.body, 4_000, `${label} body is too long.`);
    validateDestination(raw.destination, label);
    if (isRecord(raw.destination)) {
      rejectUnknownKeys(raw.destination, ['kind', 'id'], `${label} destination`);
    }
    if (raw.campaignCode !== undefined && raw.campaignCode !== '') {
      const campaignCode = typeof raw.campaignCode === 'string' ? raw.campaignCode.trim().toUpperCase() : '';
      if (!SAFE_CAMPAIGN_CODE.test(campaignCode)) {
        throw new LiteraryCircleResourcesValidationError(`${label} has an invalid campaign code.`);
      }
    }
    if (raw.assetId !== undefined && raw.assetId !== '') {
      const assetId = typeof raw.assetId === 'string' ? raw.assetId.trim() : '';
      if (!SAFE_ASSET_ID.test(assetId)) {
        throw new LiteraryCircleResourcesValidationError(`${label} has an invalid asset identifier.`);
      }
      if (assetIds.has(assetId)) {
        throw new LiteraryCircleResourcesValidationError(`Asset identifier “${assetId}” is assigned more than once.`);
      }
      assetIds.add(assetId);
      const alt = safeOptionalText(raw.assetAlt, 300);
      if (!alt || alt.length < 5 || /^(?:an?\s+)?(?:image|photo|photograph|picture|graphic|cover|art|artwork|asset)[.!]?$/i.test(alt)) {
        throw new LiteraryCircleResourcesValidationError(`${label} requires meaningful alternative text for its artwork.`);
      }
    }
    validateOptionalText(raw.assetAlt, 300, `${label} image description is too long.`);
    if (typeof raw.isPublished !== 'boolean') {
      throw new LiteraryCircleResourcesValidationError(`${label} published state must be true or false.`);
    }
    if (!Number.isSafeInteger(raw.order) || Number(raw.order) < 0 || Number(raw.order) > 10_000) {
      throw new LiteraryCircleResourcesValidationError(`${label} order must be a whole number from 0 to 10000.`);
    }
    const createdAt = safeIso(raw.createdAt);
    const updatedAt = safeIso(raw.updatedAt);
    if (!createdAt || !updatedAt) {
      throw new LiteraryCircleResourcesValidationError(`${label} requires valid creation and update timestamps.`);
    }
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      throw new LiteraryCircleResourcesValidationError(`${label} update time cannot precede its creation time.`);
    }
    const publishedAt = raw.publishedAt === undefined || raw.publishedAt === '' ? undefined : safeIso(raw.publishedAt);
    const expiresAt = raw.expiresAt === undefined || raw.expiresAt === '' ? undefined : safeIso(raw.expiresAt);
    if (raw.publishedAt !== undefined && raw.publishedAt !== '' && !publishedAt) {
      throw new LiteraryCircleResourcesValidationError(`${label} has an invalid publish time.`);
    }
    if (raw.expiresAt !== undefined && raw.expiresAt !== '' && !expiresAt) {
      throw new LiteraryCircleResourcesValidationError(`${label} has an invalid expiry time.`);
    }
    if (publishedAt && expiresAt && Date.parse(expiresAt) <= Date.parse(publishedAt)) {
      throw new LiteraryCircleResourcesValidationError(`${label} expiry time must be after its publish time.`);
    }
    if (
      raw.isPublished === true
      && !safeOptionalText(raw.description, 500)
      && !safeOptionalText(raw.body, 4_000)
      && !safeOptionalText(raw.assetId, 200)
    ) {
      throw new LiteraryCircleResourcesValidationError(`${label} needs approved copy, a description, or artwork before publishing.`);
    }
  }

  return normalizeLiteraryCircleResourceLibrary(value);
}

export function projectLiteraryCircleResourcesForAffiliate(
  value: unknown,
  now = new Date().toISOString()
): LiteraryCircleResourceLibrary {
  const library = normalizeLiteraryCircleResourceLibrary(value);
  if (!library.enabled) return { ...library, items: [] };
  const parsedNow = Date.parse(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  return {
    ...library,
    items: sortResources(library.items
      .filter(item => item.isPublished)
      .filter(item => !item.publishedAt || Date.parse(item.publishedAt) <= nowMs)
      .filter(item => !item.expiresAt || Date.parse(item.expiresAt) > nowMs))
  };
}

export async function getLiteraryCircleResourceLibraryFresh(): Promise<LiteraryCircleResourceLibrary> {
  const persisted = await getFirestoreDoc<LiteraryCircleResourceLibrary>(
    RESOURCE_COLLECTION,
    LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID
  );
  return persisted
    ? normalizeLiteraryCircleResourceLibrary(persisted)
    : { ...DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY, items: [] };
}

function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|secret|token|sessionVersion|dataUrl)/i.test(key))
    .map(([key, nested]) => [key, redactAuditValue(nested)]));
}

function createAuditEntry(options: {
  actor: string;
  action: string;
  summary: string;
  targetId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  now: string;
}): AffiliateAuditLogEntry {
  return {
    id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    timestamp: options.now,
    actor: safeRequiredText(options.actor, 'Admin', 120),
    action: safeRequiredText(options.action, 'resource_updated', 120),
    targetType: 'resource',
    ...(options.targetId ? { targetId: options.targetId } : {}),
    summary: safeRequiredText(options.summary, 'Updated Literary Circle promotional resources.', 500),
    ...(options.previousValue !== undefined ? { previousValue: redactAuditValue(options.previousValue) } : {}),
    ...(options.newValue !== undefined ? { newValue: redactAuditValue(options.newValue) } : {})
  };
}

function auditTextDigest(value: string | undefined): { length: number; sha256: string } {
  const text = value || '';
  return {
    length: text.length,
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex')
  };
}

function auditLibrarySnapshot(library: LiteraryCircleResourceLibrary): Record<string, unknown> {
  return {
    schemaVersion: library.schemaVersion,
    revision: library.revision,
    enabled: library.enabled,
    title: library.title,
    descriptionDigest: auditTextDigest(library.description),
    itemCount: library.items.length,
    items: library.items.map(item => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      destination: item.destination,
      campaignCode: item.campaignCode,
      assetId: item.assetId,
      descriptionDigest: auditTextDigest(item.description),
      bodyDigest: auditTextDigest(item.body),
      assetAltDigest: auditTextDigest(item.assetAlt),
      isPublished: item.isPublished,
      order: item.order,
      publishedAt: item.publishedAt,
      expiresAt: item.expiresAt,
      updatedAt: item.updatedAt
    }))
  };
}

function resourceChanged(
  previous: LiteraryCirclePromotionalResource | undefined,
  next: LiteraryCirclePromotionalResource
): boolean {
  if (!previous) return true;
  const withoutTimestamps = (item: LiteraryCirclePromotionalResource) => {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = item;
    return rest;
  };
  return JSON.stringify(withoutTimestamps(previous)) !== JSON.stringify(withoutTimestamps(next));
}

function isOwnedResourceAsset(value: unknown, resourceId: string): value is LiteraryCircleResourceAssetRecord {
  if (!isRecord(value)) return false;
  return value.target === 'affiliate_resource'
    && value.resourceId === resourceId
    && (value.accessScope === LITERARY_CIRCLE_PRIVATE_ASSET_SCOPE || value.accessScope === 'public');
}

export async function saveLiteraryCircleResourceLibrary(
  value: unknown,
  actor = 'Admin',
  expectedRevision?: number
): Promise<LiteraryCircleResourceMutationResult> {
  const validated = validateLiteraryCircleResourceLibrary(value);
  const requestedRevision = expectedRevision === undefined ? validated.revision : expectedRevision;
  if (!Number.isSafeInteger(requestedRevision) || Number(requestedRevision) < 0) {
    throw new LiteraryCircleResourcesValidationError('Promotional resources require a valid expected revision.');
  }

  const db = getDb();
  const libraryReference = db.collection(RESOURCE_COLLECTION).doc(LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(libraryReference);
    const previous = snapshot.exists
      ? normalizeLiteraryCircleResourceLibrary(snapshot.data())
      : { ...DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY, items: [] };
    if (previous.revision !== requestedRevision) throw new LiteraryCircleResourcesConflictError();

    const now = new Date().toISOString();
    const previousById = new Map(previous.items.map(item => [item.id, item]));
    const nextItems = validated.items.map(item => {
      const prior = previousById.get(item.id);
      return {
        ...item,
        createdAt: prior?.createdAt || now,
        updatedAt: resourceChanged(prior, item) ? now : (prior?.updatedAt || now)
      };
    });
    const next: LiteraryCircleResourceLibrary = {
      ...validated,
      revision: previous.revision + 1,
      items: sortResources(nextItems),
      updatedAt: now,
      updatedBy: safeRequiredText(actor, 'Admin', 120)
    };
    const nextById = new Map(next.items.map(item => [item.id, item]));

    const changedAssociations = next.items.filter(item => {
      if (!item.assetId) return false;
      return previousById.get(item.id)?.assetId !== item.assetId;
    });
    const publishingAssociations = next.items.filter(item => {
      if (!item.assetId || !item.isPublished) return false;
      return previousById.get(item.id)?.isPublished !== true;
    });
    const removedAssociations = previous.items.filter(item => (
      item.assetId && nextById.get(item.id)?.assetId !== item.assetId
    ));
    const assetsById = new Map<string, { reference: FirebaseFirestore.DocumentReference; value: unknown }>();
    for (const item of [...changedAssociations, ...publishingAssociations, ...removedAssociations]) {
      if (!item.assetId || assetsById.has(item.assetId)) continue;
      const reference = db.collection(ASSET_COLLECTION).doc(item.assetId);
      const assetSnapshot = await transaction.get(reference);
      assetsById.set(item.assetId, {
        reference,
        value: assetSnapshot.exists ? assetSnapshot.data() : null
      });
    }

    for (const item of changedAssociations) {
      const asset = item.assetId ? assetsById.get(item.assetId) : undefined;
      if (!asset || !isOwnedResourceAsset(asset.value, item.id)) {
        throw new LiteraryCircleResourcesValidationError(`The image assigned to “${item.title}” is unavailable or belongs to another resource.`);
      }
    }

    transaction.set(libraryReference, sanitizeForFirestore(next), { merge: false });

    for (const item of next.items) {
      const prior = previousById.get(item.id);
      const shouldPromote = Boolean(
        item.isPublished
        && item.assetId
        && (!prior?.isPublished || prior.assetId !== item.assetId)
      );
      if (!shouldPromote || !item.assetId) continue;
      const asset = assetsById.get(item.assetId);
      if (!asset || !isOwnedResourceAsset(asset.value, item.id)) {
        throw new LiteraryCircleResourcesValidationError(`The image assigned to “${item.title}” cannot be published.`);
      }
      transaction.set(asset.reference, {
        accessScope: 'public',
        shareable: true,
        url: `/api/assets/${item.assetId}`,
        updatedAt: now
      }, { merge: true });
    }

    for (const item of removedAssociations) {
      if (!item.assetId) continue;
      const asset = assetsById.get(item.assetId);
      if (
        asset
        && isOwnedResourceAsset(asset.value, item.id)
        && asset.value.accessScope === LITERARY_CIRCLE_PRIVATE_ASSET_SCOPE
      ) {
        transaction.delete(asset.reference);
      }
    }

    const audit = createAuditEntry({
      actor,
      action: 'literary_circle_resources_saved',
      summary: `Saved ${next.items.length} Literary Circle promotional resource${next.items.length === 1 ? '' : 's'}.`,
      targetId: LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID,
      previousValue: auditLibrarySnapshot(previous),
      newValue: auditLibrarySnapshot(next),
      now
    });
    transaction.set(db.collection(AUDIT_COLLECTION).doc(audit.id), sanitizeForFirestore(audit), { merge: false });
    return { library: next, audit };
  });
}

function safeResourceId(value: unknown): string {
  const resourceId = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SAFE_RESOURCE_ID.test(resourceId)) {
    throw new LiteraryCircleResourcesValidationError('A valid promotional resource identifier is required.');
  }
  return resourceId;
}

function publicAssetRecord(record: LiteraryCircleResourceAssetRecord): Omit<LiteraryCircleResourceAssetRecord, 'dataUrl'> {
  const { dataUrl: _dataUrl, ...safeRecord } = record;
  return safeRecord;
}

export async function associateLiteraryCircleResourceImage(options: {
  resourceId: string;
  dataUrl: string;
  expectedRevision: number;
  actor?: string;
  assetAlt?: string;
}): Promise<LiteraryCircleResourceAssetAssociationResult> {
  const resourceId = safeResourceId(options.resourceId);
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw new LiteraryCircleResourcesValidationError('A valid expected revision is required before uploading an image.');
  }
  validateOptionalText(options.assetAlt, 300, 'The image description is too long.');
  const assetAlt = safeOptionalText(options.assetAlt, 300);
  if (!assetAlt || assetAlt.length < 5 || /^(?:an?\s+)?(?:image|photo|photograph|picture|graphic|cover|art|artwork|asset)[.!]?$/i.test(assetAlt)) {
    throw new LiteraryCircleResourcesValidationError('Add meaningful alternative text before uploading promotional artwork.');
  }
  const image = await sanitizeImageDataUrl(options.dataUrl);
  const now = new Date().toISOString();
  const actor = safeRequiredText(options.actor, 'Admin', 120);
  const filename = `literary-circle-${resourceId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${image.extension}`;
  const assetId = filename.replace(/[^A-Za-z0-9_-]/g, '_');
  const db = getDb();
  const libraryReference = db.collection(RESOURCE_COLLECTION).doc(LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID);
  const assetReference = db.collection(ASSET_COLLECTION).doc(assetId);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(libraryReference);
    const previous = snapshot.exists
      ? normalizeLiteraryCircleResourceLibrary(snapshot.data())
      : { ...DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY, items: [] };
    if (previous.revision !== options.expectedRevision) throw new LiteraryCircleResourcesConflictError();
    const resource = previous.items.find(item => item.id === resourceId);
    if (!resource) throw new LiteraryCircleResourcesValidationError('The promotional resource no longer exists.');

    let previousAssetReference: FirebaseFirestore.DocumentReference | undefined;
    let previousAsset: unknown;
    if (resource.assetId) {
      previousAssetReference = db.collection(ASSET_COLLECTION).doc(resource.assetId);
      const previousAssetSnapshot = await transaction.get(previousAssetReference);
      previousAsset = previousAssetSnapshot.exists ? previousAssetSnapshot.data() : null;
    }

    const isShareable = resource.isPublished;
    const asset: LiteraryCircleResourceAssetRecord = {
      id: assetId,
      target: 'affiliate_resource',
      filename,
      url: isShareable
        ? `/api/assets/${assetId}`
        : `/api/admin/affiliates/literary-circle/resource-assets/${assetId}`,
      dataUrl: image.dataUrl,
      mimeType: image.mimeType,
      size: image.buffer.length,
      resourceId,
      accessScope: isShareable ? 'public' : LITERARY_CIRCLE_PRIVATE_ASSET_SCOPE,
      shareable: isShareable,
      savedPermanently: true,
      savedAt: now,
      updatedAt: now,
      width: image.width,
      height: image.height,
      sanitized: true
    };
    const updatedResource: LiteraryCirclePromotionalResource = {
      ...resource,
      assetId,
      assetAlt,
      updatedAt: now
    };
    const next: LiteraryCircleResourceLibrary = {
      ...previous,
      revision: previous.revision + 1,
      items: previous.items.map(item => item.id === resourceId ? updatedResource : item),
      updatedAt: now,
      updatedBy: actor
    };
    const audit = createAuditEntry({
      actor,
      action: 'literary_circle_resource_image_saved',
      summary: `Saved a promotional image for “${resource.title}”.`,
      targetId: resourceId,
      previousValue: { resourceId, assetId: resource.assetId },
      newValue: { resourceId, assetId, accessScope: asset.accessScope, mimeType: asset.mimeType, size: asset.size },
      now
    });

    transaction.set(assetReference, sanitizeForFirestore(asset), { merge: false });
    transaction.set(libraryReference, sanitizeForFirestore(next), { merge: false });
    transaction.set(db.collection(AUDIT_COLLECTION).doc(audit.id), sanitizeForFirestore(audit), { merge: false });
    if (
      previousAssetReference
      && isOwnedResourceAsset(previousAsset, resourceId)
      && previousAsset.accessScope === LITERARY_CIRCLE_PRIVATE_ASSET_SCOPE
    ) {
      transaction.delete(previousAssetReference);
    }
    return { library: next, asset: publicAssetRecord(asset), audit };
  });
}

export async function removeLiteraryCircleResourceImage(options: {
  resourceId: string;
  expectedRevision: number;
  actor?: string;
}): Promise<{ library: LiteraryCircleResourceLibrary; retainedShareableAsset: boolean; audit?: AffiliateAuditLogEntry }> {
  const resourceId = safeResourceId(options.resourceId);
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw new LiteraryCircleResourcesValidationError('A valid expected revision is required before removing an image.');
  }
  const actor = safeRequiredText(options.actor, 'Admin', 120);
  const db = getDb();
  const libraryReference = db.collection(RESOURCE_COLLECTION).doc(LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(libraryReference);
    const previous = snapshot.exists
      ? normalizeLiteraryCircleResourceLibrary(snapshot.data())
      : { ...DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY, items: [] };
    if (previous.revision !== options.expectedRevision) throw new LiteraryCircleResourcesConflictError();
    const resource = previous.items.find(item => item.id === resourceId);
    if (!resource) throw new LiteraryCircleResourcesValidationError('The promotional resource no longer exists.');
    if (!resource.assetId) return { library: previous, retainedShareableAsset: false };

    const assetReference = db.collection(ASSET_COLLECTION).doc(resource.assetId);
    const assetSnapshot = await transaction.get(assetReference);
    const asset = assetSnapshot.exists ? assetSnapshot.data() : null;
    if (asset && !isOwnedResourceAsset(asset, resourceId)) {
      throw new LiteraryCircleResourcesValidationError('The promotional image belongs to another resource.');
    }

    const now = new Date().toISOString();
    const updatedResource = { ...resource } as LiteraryCirclePromotionalResource;
    delete updatedResource.assetId;
    delete updatedResource.assetAlt;
    updatedResource.updatedAt = now;
    const next: LiteraryCircleResourceLibrary = {
      ...previous,
      revision: previous.revision + 1,
      items: previous.items.map(item => item.id === resourceId ? updatedResource : item),
      updatedAt: now,
      updatedBy: actor
    };
    const retainedShareableAsset = Boolean(
      isOwnedResourceAsset(asset, resourceId) && asset.accessScope === 'public'
    );
    const audit = createAuditEntry({
      actor,
      action: 'literary_circle_resource_image_removed',
      summary: `Removed the promotional image association from “${resource.title}”.`,
      targetId: resourceId,
      previousValue: { resourceId, assetId: resource.assetId },
      newValue: { resourceId, retainedShareableAsset },
      now
    });

    transaction.set(libraryReference, sanitizeForFirestore(next), { merge: false });
    transaction.set(db.collection(AUDIT_COLLECTION).doc(audit.id), sanitizeForFirestore(audit), { merge: false });
    if (assetSnapshot.exists && !retainedShareableAsset) transaction.delete(assetReference);
    return { library: next, retainedShareableAsset, audit };
  });
}
