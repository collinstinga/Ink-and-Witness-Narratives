import { getDb } from './db.js';

const MAX_LICENSE_ROWS_PER_QUERY = 1_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type ReaderIdentity = { id: string; email: string };
type LicenseRow = { id: string; value: Record<string, unknown> };

/** Pure, conservative ownership filter. It deliberately does not use library/access caches. */
export function purchasedChapterIdsFromLicenses(
  user: ReaderIdentity,
  pieceIds: readonly string[],
  licenses: readonly LicenseRow[],
  now = Date.now()
): string[] {
  const email = user.email.trim().toLowerCase();
  const requested = new Set(pieceIds);
  const owned = new Set<string>();
  for (const { id: token, value } of licenses) {
    if (!/^ink_(?:[0-9]{10,16}_[a-f0-9]{64}|mpesa_[A-Za-z0-9._:-]{8,128}|seed_token_[0-9]{2})$/.test(token)) continue;
    if (value.token !== undefined && value.token !== token) continue;
    if (value.phone !== undefined && typeof value.phone !== 'string') continue;
    if (value.userId !== undefined && (typeof value.userId !== 'string' || !value.userId)) continue;
    const articleId = value.articleId;
    if (typeof articleId !== 'string' || !requested.has(articleId)) continue;
    const boundUserId = typeof value.userId === 'string' ? value.userId : '';
    const boundEmail = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
    if (boundUserId ? boundUserId !== user.id : !email || boundEmail !== email) continue;
    if (value.revoked === true || value.revokedAt) continue;
    if (value.status !== undefined && value.status !== 'active' && value.status !== 'ACTIVE') continue;
    if (value.state !== undefined && value.state !== 'active') continue;
    if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) continue;
    // Legacy paid licences predate accessSource. Require an actual provider receipt
    // for those rows, not the UI's synthetic CONFIRMED/COMPLIMENTARY labels.
    const receipt = typeof value.receipt === 'string' ? value.receipt.trim().toUpperCase() : '';
    if (value.accessSource === undefined) {
      if (!/^[A-Z0-9]{10}$/.test(receipt)) continue;
    } else if (value.accessSource !== 'MPESA_PURCHASE') {
      continue;
    }
    owned.add(articleId);
  }
  return pieceIds.filter(id => owned.has(id));
}

/**
 * Fresh exact-reader purchase lookup. A database error/overflow fails closed;
 * never substitute active subscription, affiliate access or an old client flag.
 */
export async function getPurchasedChapterIdsForUser(
  user: ReaderIdentity,
  pieceIds: readonly string[],
  now = Date.now()
): Promise<string[]> {
  if (!user || typeof user.id !== 'string' || !SAFE_ID.test(user.id) || typeof user.email !== 'string') {
    throw new Error('A valid signed-in reader is required for chapter credits.');
  }
  if (!Number.isFinite(now) || pieceIds.length < 2 || pieceIds.length > 30 || new Set(pieceIds).size !== pieceIds.length || pieceIds.some(id => !SAFE_ID.test(id))) {
    throw new Error('A valid chapter list is required for purchase credits.');
  }
  const email = user.email.trim().toLowerCase();
  const emailValues = [...new Set([email, user.email.trim()].filter(Boolean))];
  const collection = getDb().collection('reader_licenses');
  const snapshots = await Promise.all([
    collection.where('userId', '==', user.id).limit(MAX_LICENSE_ROWS_PER_QUERY + 1).get(),
    ...emailValues.map(value => collection.where('email', '==', value).limit(MAX_LICENSE_ROWS_PER_QUERY + 1).get())
  ]);
  if (snapshots.some(snapshot => snapshot.docs.length > MAX_LICENSE_ROWS_PER_QUERY)) {
    throw new Error('Your purchase history needs a secure review before this book price can be calculated.');
  }
  const licenses = new Map<string, LicenseRow>();
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) licenses.set(document.id, { id: document.id, value: document.data() });
  }
  return purchasedChapterIdsFromLicenses(user, pieceIds, [...licenses.values()], now);
}
