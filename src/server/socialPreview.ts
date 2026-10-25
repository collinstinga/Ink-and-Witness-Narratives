import type { Firestore } from 'firebase-admin/firestore';
import { getDb } from './db.js';

export const SOCIAL_ORIGIN = 'https://www.inkandwitness-narratives.co.ke';
export const SOCIAL_SITE_NAME = 'Ink & Witness Narratives';
export const SOCIAL_DEFAULT_DESCRIPTION = 'Poetry, stories and personal reflections exploring love, desire, life and the human experience. Discover words that linger.';
export const SOCIAL_FALLBACK_IMAGE = `${SOCIAL_ORIGIN}/social-preview-image`;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const AUTHOR_FIELDS = ['name', 'bio', 'heroHeadline', 'coverPhotoUrl', 'logoUrl', 'avatarUrl', 'coverPhotoSavedAt', 'logoSavedAt', 'avatarSavedAt'];
const PIECE_FIELDS = ['title', 'slug', 'excerpt', 'subtitle', 'synopsis', 'coverImage', 'updatedAt', 'status', 'scheduledAt'];

type PublicRecord = Record<string, unknown>;
export interface SocialMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
  imageAlt: string;
  type: 'website' | 'article';
  robots: 'index, follow' | 'noindex, follow';
  status: 200 | 400 | 404 | 503;
}
export type SocialPieceQuery = { kind: 'home' } | { kind: 'invalid' } | { kind: 'piece'; identifier: string };

export function parseSocialPieceQuery(rawUrl: string): SocialPieceQuery {
  if (rawUrl.length > 16_000 || /%(?![a-fA-F0-9]{2})/.test(rawUrl)) return { kind: 'invalid' };
  let params: URLSearchParams;
  try { params = new URL(rawUrl, SOCIAL_ORIGIN).searchParams; } catch { return { kind: 'invalid' }; }
  const selectors = ['monograph', 'article', 'id'].flatMap(key => params.getAll(key));
  // Query arrays, duplicate selectors and ambiguous aliases must not select a
  // private record differently from the reader application.
  if ([...params.keys()].some(key => /^(?:monograph|article|id)\[/.test(key))) return { kind: 'invalid' };
  if (selectors.length === 0) return { kind: 'home' };
  if (selectors.length !== 1 || !IDENTIFIER.test(selectors[0])) return { kind: 'invalid' };
  return { kind: 'piece', identifier: selectors[0] };
}

function publicText(value: unknown, maximum: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // These fields are public prose, not HTML. Strip markup and control bytes;
  // escaping at the final HTML boundary is still mandatory.
  const clean = value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maximum) : fallback;
}

export function publicSocialImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_000 || /[\u0000-\u0020\\]/.test(value)) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) {
    const url = new URL(value, SOCIAL_ORIGIN);
    // Only existing public image delivery paths, never arbitrary internal APIs.
    if (!/^\/(?:uploads\/[^/]+|api\/assets\/[^/]+|assets\/.+)$/.test(url.pathname) || url.hash || /%2f|%5c/i.test(url.pathname)) return undefined;
    return url.toString();
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || !url.hostname.includes('.') || /^[0-9.]+$|[\[\]:]/.test(url.hostname)
      || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname)
      || /\.(?:localhost|local|internal)$/i.test(url.hostname)) return undefined;
    if (url.origin === SOCIAL_ORIGIN || url.hostname === 'inkandwitness-narratives.co.ke') {
      return publicSocialImageUrl(`${url.pathname}${url.search}`);
    }
    // An existing public HTTPS cover can be referenced, but is NEVER fetched or
    // proxied by this server. No request-supplied URL reaches this function.
    return url.toString();
  } catch { return undefined; }
}

export function authorSocialImageSource(author: PublicRecord | null): string | undefined {
  if (!author) return undefined;
  for (const field of ['coverPhotoUrl', 'logoUrl', 'avatarUrl']) {
    const value = author[field];
    if (typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(value)) return value;
    const publicUrl = publicSocialImageUrl(value);
    if (publicUrl) return publicUrl;
  }
  return undefined;
}

export function siteSocialMetadata(author: PublicRecord | null = null, status: SocialMetadata['status'] = 200): SocialMetadata {
  const source = authorSocialImageSource(author);
  const imageUrl = source?.startsWith('data:') ? `${SOCIAL_ORIGIN}/social-preview-image` : source || SOCIAL_FALLBACK_IMAGE;
  return {
    title: SOCIAL_SITE_NAME,
    description: publicText(author?.bio, 300, SOCIAL_DEFAULT_DESCRIPTION),
    canonicalUrl: `${SOCIAL_ORIGIN}/`, imageUrl, imageAlt: SOCIAL_SITE_NAME,
    type: 'website', robots: status === 200 ? 'index, follow' : 'noindex, follow', status,
  };
}

export function isSocialPiecePublished(piece: PublicRecord, now: number): boolean {
  if (piece.status === 'published') return true;
  return piece.status === 'scheduled' && typeof piece.scheduledAt === 'string'
    && Number.isFinite(Date.parse(piece.scheduledAt)) && Date.parse(piece.scheduledAt) <= now;
}

export async function readSocialAuthor(db: Firestore = getDb()): Promise<PublicRecord | null> {
  // Match the public website's authoritative canonical-then-legacy precedence.
  // Field masks never retrieve unrelated configuration, secrets or statistics.
  const [canonical] = await db.getAll(db.collection('site_configs').doc('author'), { fieldMask: AUTHOR_FIELDS });
  if (canonical.exists) return canonical.data() || {};
  const [legacy] = await db.getAll(db.collection('site_configs').doc('author_profile'), { fieldMask: AUTHOR_FIELDS });
  return legacy.exists ? legacy.data() || {} : null;
}

export async function readSocialPiece(identifier: string, db?: Firestore, now = Date.now()): Promise<{ id: string; piece: PublicRecord } | null> {
  if (!IDENTIFIER.test(identifier)) return null;
  db ||= getDb();
  const collection = db.collection('articles');
  const [direct] = await db.getAll(collection.doc(identifier), { fieldMask: PIECE_FIELDS });
  if (direct.exists) {
    const piece = direct.data() || {};
    return isSocialPiecePublished(piece, now) ? { id: direct.id, piece } : null;
  }
  const matches = await collection.where('slug', '==', identifier).select(...PIECE_FIELDS).limit(2).get();
  // Never pick a different record from an ambiguous legacy slug.
  if (matches.docs.length !== 1) return null;
  const match = matches.docs[0];
  const piece = match.data();
  return IDENTIFIER.test(match.id) && isSocialPiecePublished(piece, now) ? { id: match.id, piece } : null;
}

export function pieceSocialMetadata(id: string, piece: PublicRecord, site: SocialMetadata): SocialMetadata {
  const title = publicText(piece.title, 180, SOCIAL_SITE_NAME);
  const embeddedCover = typeof piece.coverImage === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(piece.coverImage);
  const version = typeof piece.updatedAt === 'string' ? piece.updatedAt.slice(0, 100) : id;
  const imageUrl = embeddedCover
    ? `${SOCIAL_ORIGIN}/api/articles/${encodeURIComponent(id)}/cover?v=${encodeURIComponent(version)}`
    : publicSocialImageUrl(piece.coverImage) || site.imageUrl;
  return {
    title: `${title} | ${SOCIAL_SITE_NAME}`,
    description: publicText(piece.excerpt || piece.synopsis || piece.subtitle, 300, SOCIAL_DEFAULT_DESCRIPTION),
    canonicalUrl: `${SOCIAL_ORIGIN}/?monograph=${encodeURIComponent(id)}`,
    imageUrl, imageAlt: title, type: 'article', robots: 'index, follow', status: 200,
  };
}

export async function loadSocialMetadata(query: SocialPieceQuery, db?: Firestore, now = Date.now()): Promise<SocialMetadata> {
  if (query.kind === 'invalid') return siteSocialMetadata(null, 400);
  // Ordinary homepage loads must not add Firestore reads or SDK cold-start
  // latency merely for social tags. The image endpoint resolves current public
  // branding only when a crawler actually requests that image.
  if (query.kind === 'home') return siteSocialMetadata();
  db ||= getDb();
  const match = await readSocialPiece(query.identifier, db, now);
  const site = siteSocialMetadata();
  return match ? pieceSocialMetadata(match.id, match.piece, site) : { ...site, status: 404, robots: 'noindex, follow' };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function injectSocialMetadata(template: string, metadata: SocialMetadata): string {
  if (!/<head(?:\s[^>]*)?>/i.test(template) || !/<\/head\s*>/i.test(template)) throw new Error('HTML template unavailable');
  const head = template.match(/<head(?:\s[^>]*)?>[\s\S]*?<\/head\s*>/i)![0];
  const cleaned = head
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '')
    .replace(/<meta\b[^>]*(?:name|property)\s*=\s*["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/gi, '')
    // Existing structured data describes the old .com domain. Do not leave
    // stale or contradictory metadata; dynamic paid text is never serialized.
    .replace(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const meta = (key: string, value: string, property = false) => `<meta ${property ? 'property' : 'name'}="${key}" content="${escapeHtml(value)}" />`;
  const tags = [
    `<title>${escapeHtml(metadata.title)}</title>`,
    meta('description', metadata.description), meta('robots', metadata.robots),
    `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />`,
    meta('og:type', metadata.type, true), meta('og:site_name', SOCIAL_SITE_NAME, true),
    meta('og:title', metadata.title, true), meta('og:description', metadata.description, true),
    meta('og:url', metadata.canonicalUrl, true), meta('og:image', metadata.imageUrl, true),
    meta('og:image:alt', metadata.imageAlt, true), meta('twitter:card', 'summary_large_image'),
    meta('twitter:site', '@bigboyjake_'), meta('twitter:creator', '@bigboyjake_'),
    meta('twitter:title', metadata.title), meta('twitter:description', metadata.description),
    meta('twitter:image', metadata.imageUrl), meta('twitter:image:alt', metadata.imageAlt),
  ].join('\n    ');
  // Function replacements also prevent literal "$&", "$`" or "$'" in prose
  // from being interpreted as JavaScript replacement-string instructions.
  return template.replace(head, () => cleaned.replace(/<\/head\s*>/i, () => `    ${tags}\n  </head>`));
}
