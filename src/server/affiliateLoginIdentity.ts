import crypto from 'crypto';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import type { AffiliateAccount } from '../types.js';

const SAFE_ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;

export class AffiliateLoginIdentityUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Affiliate sign-in is temporarily unavailable. Please retry.');
    this.name = 'AffiliateLoginIdentityUnavailableError';
  }
}

/** Resolve credentials from shared state, never the startup directory cache.
 * Reservation and account reads share one read-only transaction. A missing
 * legacy reservation permits only a bounded exact query, not a directory scan
 * or a cached credential fallback. This function never creates reservations.
 */
export async function readAffiliateLoginIdentity(
  db: Firestore,
  input: unknown,
  legacyCandidateId?: string,
): Promise<AffiliateAccount | undefined> {
  if (typeof input !== 'string') return undefined;
  const value = input.trim();
  if (!value || value.length > 254 || /[\s\x00-\x1f\x7f/\\]/.test(value)) return undefined;
  const field = value.includes('@') ? 'email' : 'affiliateCode';
  if (field === 'email' ? !/^[^@]+@[^@]+\.[^@]+$/.test(value) : !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return undefined;
  const normalized = field === 'email' ? value.toLowerCase() : value.toUpperCase();
  const reservationId = field === 'email'
    ? crypto.createHash('sha256').update(normalized).digest('hex') : normalized;

  const readAccount = (snapshot: DocumentSnapshot): AffiliateAccount | undefined => {
    if (!snapshot.exists) return undefined;
    const account = snapshot.data() as AffiliateAccount;
    if (!SAFE_ACCOUNT_ID.test(snapshot.id) || (account.id && account.id !== snapshot.id)
      || typeof account[field] !== 'string'
      || (field === 'email' ? account[field].trim().toLowerCase() : account[field].trim().toUpperCase()) !== normalized) {
      throw new AffiliateLoginIdentityUnavailableError();
    }
    return { ...account, id: snapshot.id };
  };

  try {
    return await db.runTransaction(async transaction => {
      const reservation = await transaction.get(db.collection(field === 'email' ? 'affiliate_emails' : 'affiliate_codes').doc(reservationId));
      if (reservation.exists) {
        const owner = reservation.data()?.affiliateId;
        if (typeof owner !== 'string' || !SAFE_ACCOUNT_ID.test(owner)) throw new AffiliateLoginIdentityUnavailableError();
        const account = await transaction.get(db.collection('affiliates').doc(owner));
        if (!account.exists) throw new AffiliateLoginIdentityUnavailableError();
        return readAccount(account);
      }
      const legacy = await transaction.get(db.collection('affiliates').where(field, '==', normalized).limit(2));
      if (legacy.docs.length > 1) throw new AffiliateLoginIdentityUnavailableError();
      if (legacy.docs.length) return readAccount(legacy.docs[0]);
      // Pre-index legacy records may have mixed-case stored identities. A
      // startup-cache ID is only a lookup hint, never credential evidence: the
      // transaction must re-read and match the current identity. No hint can
      // override a conflicting reservation or an exact-query result.
      if (legacyCandidateId && SAFE_ACCOUNT_ID.test(legacyCandidateId)) {
        const candidate = await transaction.get(db.collection('affiliates').doc(legacyCandidateId));
        const data = candidate.exists ? candidate.data() : undefined;
        const identity = data?.[field];
        if (typeof identity === 'string'
          && (field === 'email' ? identity.trim().toLowerCase() : identity.trim().toUpperCase()) === normalized) {
          return readAccount(candidate);
        }
      }
      return undefined;
    }, { readOnly: true });
  } catch {
    // Provider errors can contain resource paths/credentials. Expose only this
    // controlled retryable error and never mislabel an outage as bad credentials.
    throw new AffiliateLoginIdentityUnavailableError();
  }
}
