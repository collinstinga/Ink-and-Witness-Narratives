import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SOCIAL_ORIGIN, SOCIAL_SITE_NAME, authorSocialImageSource, injectSocialMetadata,
  isSocialPiecePublished, loadSocialMetadata, parseSocialPieceQuery, pieceSocialMetadata,
  publicSocialImageUrl, readSocialAuthor, readSocialPiece, siteSocialMetadata,
} from './socialPreview.js';

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn(() => { throw new Error('Unexpected database initialization'); }) }));
vi.mock('./db.js', () => ({ getDb }));
afterEach(() => vi.clearAllMocks());

function fakeDb(records: Record<string, Record<string, unknown>>) {
  const reads: { path: string; fields: string[] }[] = [];
  const queries: { field: string; value: unknown; fields: string[]; limit: number }[] = [];
  const snapshot = (recordPath: string, fields: string[]) => {
    const record = records[recordPath];
    return { id: recordPath.split('/').at(-1)!, exists: !!record,
      data: () => record && Object.fromEntries(fields.filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]])) };
  };
  const db = {
    getAll: vi.fn(async (ref: { path: string }, options: { fieldMask: string[] }) => {
      reads.push({ path: ref.path, fields: options.fieldMask });
      return [snapshot(ref.path, options.fieldMask)];
    }),
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}`, id }),
      where: (field: string, _operator: string, value: unknown) => ({
        select: (...fields: string[]) => ({
          limit: (limit: number) => ({ get: async () => {
            queries.push({ field, value, fields, limit });
            const matches = Object.keys(records).filter(key => key.startsWith(`${name}/`) && records[key][field] === value).slice(0, limit);
            return { docs: matches.map(key => snapshot(key, fields)) };
          } }),
        }),
      }),
    }),
  };
  return { db: db as unknown as Firestore, reads, queries };
}

describe('social link selector boundary', () => {
  it.each(['/', '/?ref=partner&c=launch', '/?token=private&phone=hidden#piece-old'])('does not copy unrelated query or fragment values: %s', url => {
    expect(parseSocialPieceQuery(url)).toEqual({ kind: 'home' });
  });
  it.each(['monograph', 'article', 'id'])('accepts the existing %s public selector', key => {
    expect(parseSocialPieceQuery(`/?${key}=piece-123&ref=partner&c=launch`)).toEqual({ kind: 'piece', identifier: 'piece-123' });
  });
  it.each([
    '/?monograph=one&monograph=two', '/?monograph=one&article=one', '/?id=',
    '/?article[]=one', '/?monograph%5B0%5D=one', '/?monograph=..%2Fprivate',
    '/?article=https://evil.example/private', '/?article=bad%QQ', '/?article=%E0%A4',
    '/?id=%3Cscript%3E', '/?id=' + 'x'.repeat(201), 'https://[invalid',
  ])('rejects malformed or ambiguous selectors: %s', url => {
    expect(parseSocialPieceQuery(url)).toEqual({ kind: 'invalid' });
  });
  it('rejects oversize URLs before parsing', () => {
    expect(parseSocialPieceQuery('/?ref=' + 'x'.repeat(16_001))).toEqual({ kind: 'invalid' });
  });
  it('does not initialize the database for an invalid selector', async () => {
    expect((await loadSocialMetadata({ kind: 'invalid' })).status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });
  it('does not initialize or read the database for the ordinary homepage', async () => {
    expect((await loadSocialMetadata({ kind: 'home' })).imageUrl).toBe(`${SOCIAL_ORIGIN}/social-preview-image`);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe('targeted read-only public metadata', () => {
  it('uses canonical author even when empty and never reads unrelated settings', async () => {
    const fake = fakeDb({ 'site_configs/author': {}, 'site_configs/author_profile': { bio: 'Old biography', consumerSecret: 'DO NOT READ' } });
    expect(await readSocialAuthor(fake.db)).toEqual({});
    expect(fake.reads.map(read => read.path)).toEqual(['site_configs/author']);
    expect(fake.reads[0].fields).not.toContain('consumerSecret');
  });
  it('reads legacy author only when canonical document is missing', async () => {
    const fake = fakeDb({ 'site_configs/author_profile': { bio: 'Legacy public biography', consumerSecret: 'DO NOT READ' } });
    expect(await readSocialAuthor(fake.db)).toEqual({ bio: 'Legacy public biography' });
    expect(fake.reads.map(read => read.path)).toEqual(['site_configs/author', 'site_configs/author_profile']);
  });
  it('retrieves only allowlisted public article fields and never paid content', async () => {
    const fake = fakeDb({ 'articles/stable-id': { status: 'published', title: 'A public title', content: 'PAID SECRET', behindThePiece: 'PRIVATE NOTE', coverImageOriginal: 'PRIVATE ORIGINAL' } });
    const result = await readSocialPiece('stable-id', fake.db);
    expect(result).toEqual({ id: 'stable-id', piece: { status: 'published', title: 'A public title' } });
    expect(fake.queries).toHaveLength(0);
    expect(fake.reads[0].fields).not.toEqual(expect.arrayContaining(['content']));
    expect(fake.reads[0].fields).not.toContain('coverImageOriginal');
    expect(fake.reads[0].fields).not.toContain('behindThePiece');
  });
  it('resolves legacy slugs with an exact field-masked query limited to two records', async () => {
    const fake = fakeDb({ 'articles/stable-id': { status: 'published', slug: 'old-slug', title: 'Public' } });
    expect((await readSocialPiece('old-slug', fake.db))?.id).toBe('stable-id');
    expect(fake.queries).toEqual([expect.objectContaining({ field: 'slug', value: 'old-slug', limit: 2 })]);
    expect(fake.queries[0].fields).not.toContain('content');
  });
  it('fails closed for ambiguous legacy slugs without selecting either title', async () => {
    const fake = fakeDb({
      'articles/first': { status: 'published', slug: 'same', title: 'First' },
      'articles/second': { status: 'draft', slug: 'same', title: 'Draft secret' },
    });
    expect(await readSocialPiece('same', fake.db)).toBeNull();
  });
  it.each(['draft', 'archived', undefined, 'scheduled'])('does not expose a non-public article with status %s', async status => {
    const fake = fakeDb({ 'articles/private': { status, title: 'SECRET DRAFT', content: 'SECRET', coverImage: '/uploads/secret.jpg' } });
    const metadata = await loadSocialMetadata({ kind: 'piece', identifier: 'private' }, fake.db);
    expect(metadata.status).toBe(404);
    expect(metadata.robots).toBe('noindex, follow');
    expect(JSON.stringify(metadata)).not.toContain('SECRET');
    expect(metadata.imageUrl).not.toContain('secret.jpg');
  });
  it('does not leak an unknown identifier into canonical metadata', async () => {
    const fake = fakeDb({});
    const metadata = await loadSocialMetadata({ kind: 'piece', identifier: 'unknown-secret' }, fake.db);
    expect(metadata.status).toBe(404);
    expect(metadata.canonicalUrl).toBe(`${SOCIAL_ORIGIN}/`);
  });
  it('supports only scheduled works whose release time has arrived', () => {
    const now = Date.parse('2026-10-25T10:00:00Z');
    expect(isSocialPiecePublished({ status: 'scheduled', scheduledAt: '2026-10-25T09:59:00Z' }, now)).toBe(true);
    expect(isSocialPiecePublished({ status: 'scheduled', scheduledAt: '2026-10-25T10:01:00Z' }, now)).toBe(false);
    expect(isSocialPiecePublished({ status: 'scheduled', scheduledAt: 'invalid' }, now)).toBe(false);
  });
  it('reads updated data on every metadata request, not an indefinite startup cache', async () => {
    const records = { 'articles/stable-id': { status: 'published', title: 'Before' } };
    const fake = fakeDb(records);
    expect((await loadSocialMetadata({ kind: 'piece', identifier: 'stable-id' }, fake.db)).title).toContain('Before');
    records['articles/stable-id'].title = 'After';
    expect((await loadSocialMetadata({ kind: 'piece', identifier: 'stable-id' }, fake.db)).title).toContain('After');
    expect(fake.reads.filter(read => read.path === 'articles/stable-id')).toHaveLength(2);
    expect(fake.reads.some(read => read.path.startsWith('site_configs/'))).toBe(false);
  });
});

describe('canonical public image and HTML projection', () => {
  it('normalizes trusted existing upload paths into absolute canonical URLs', () => {
    expect(publicSocialImageUrl('/api/assets/cover.jpg')).toBe(`${SOCIAL_ORIGIN}/api/assets/cover.jpg`);
    expect(publicSocialImageUrl('/uploads/cover.jpg')).toBe(`${SOCIAL_ORIGIN}/uploads/cover.jpg`);
  });
  it.each(['//evil.example/x', 'http://evil.example/x', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'blob:private', '/api/auth/login', '/uploads/%2Fprivate', 'https://user:password@images.example/x', 'https://127.0.0.1/x', 'https://[::ffff:192.168.1.1]/x', 'https://host.local/x'])('rejects unsafe image references: %s', value => {
    expect(publicSocialImageUrl(value)).toBeUndefined();
  });
  it('references an existing public HTTPS cover without fetching it', () => {
    expect(publicSocialImageUrl('https://images.example/cover.jpg?v=2')).toBe('https://images.example/cover.jpg?v=2');
  });
  it('uses stable IDs and the existing public embedded cover endpoint, never original data', () => {
    const metadata = pieceSocialMetadata('stable-id', { title: 'Public', slug: 'may-change', excerpt: 'Public excerpt', coverImage: 'data:image/jpeg;base64,AAA=', coverImageOriginal: 'PRIVATE ORIGINAL', content: 'PAID SECRET', updatedAt: '2026-10-25T12:00:00Z' }, siteSocialMetadata());
    expect(metadata.canonicalUrl).toBe(`${SOCIAL_ORIGIN}/?monograph=stable-id`);
    expect(metadata.imageUrl).toBe(`${SOCIAL_ORIGIN}/api/articles/stable-id/cover?v=2026-10-25T12%3A00%3A00Z`);
    expect(JSON.stringify(metadata)).not.toMatch(/PAID SECRET|PRIVATE ORIGINAL|base64/);
  });
  it('uses only a public branding image source and a fixed endpoint for embedded rasters', () => {
    expect(siteSocialMetadata({ logoUrl: '/uploads/logo.png' }).imageUrl).toBe(`${SOCIAL_ORIGIN}/uploads/logo.png`);
    expect(siteSocialMetadata({ coverPhotoUrl: 'data:image/png;base64,AAA=' }).imageUrl).toBe(`${SOCIAL_ORIGIN}/social-preview-image`);
    expect(authorSocialImageSource({ coverPhotoUrl: 'javascript:bad', logoUrl: '/api/assets/logo.png' })).toBe(`${SOCIAL_ORIGIN}/api/assets/logo.png`);
  });
  it('escapes every HTML boundary, removes stale tags/JSON-LD and preserves app assets/body', () => {
    const template = '<html><head><title>Old</title><meta content="old" property="og:image"><meta name="twitter:title" content="old"><link href="https://inkandwitness.com" rel="canonical"><script type="application/ld+json">{"old":"stale"}</script><script src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';
    const html = injectSocialMetadata(template, { ...siteSocialMetadata(), title: '</title><script>alert(1)</script> " & $& $` $\'', description: '" onload="bad', imageUrl: `${SOCIAL_ORIGIN}/uploads/a.jpg?x="bad`, imageAlt: '<svg onload="bad">' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot; onload=&quot;bad');
    expect(html).toContain('$&amp; $` $&#39;');
    expect(html).not.toContain('application/ld+json');
    expect(html).not.toContain('inkandwitness.com');
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('<script src="/assets/app.js"></script>');
    expect(html).toContain('<body><div id="root"></div></body>');
    expect(html.match(/<\/head>/g)).toHaveLength(1);
  });
  it('does not allow stored article prose to select canonical origin or serialize private fields', () => {
    const metadata = pieceSocialMetadata('safe', { title: 'Title', excerpt: 'Public', content: 'PAID', host: 'evil.example', canonicalUrl: 'https://evil.example' }, siteSocialMetadata());
    expect(metadata.canonicalUrl).toBe(`${SOCIAL_ORIGIN}/?monograph=safe`);
    expect(metadata.title).toContain(SOCIAL_SITE_NAME);
    expect(JSON.stringify(metadata)).not.toMatch(/evil|PAID/);
  });
});

describe('Vercel social HTML routing and build tracing', () => {
  const config = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
  it('excludes private runtime data without hiding nested source-code data folders', () => {
    const exclusions = readFileSync(path.join(process.cwd(), '.vercelignore'), 'utf8').split(/\r?\n/);
    expect(exclusions).toContain('/data/');
    expect(exclusions).toContain('/uploads/');
    expect(exclusions).not.toContain('data');
    expect(exclusions).not.toContain('data/');
  });
  it('routes only the homepage HTML to the dedicated handler and traces built assets', () => {
    expect(config.rewrites.find((rule: { source: string }) => rule.source === '/')).toEqual({ source: '/', destination: '/api/social-preview' });
    expect(config.functions['api/social-preview.ts'].includeFiles).toBe('dist/index.html');
    expect(config.rewrites.find((rule: { source: string }) => rule.source === '/api/:path*').destination).toBe('/api/index?path=:path*');
    expect(config.rewrites.find((rule: { source: string }) => rule.source === '/r/:code').destination).toBe('/api/index?path=affiliate/redirect/:code');
    expect(config.rewrites.findIndex((rule: { source: string }) => rule.source === '/social-preview-image')).toBeLessThan(config.rewrites.findIndex((rule: { source: string }) => rule.source === '/api/:path*'));
  });
  it('does not auto-deploy the isolated hotfix branch against production settings', () => {
    expect(config.git.deploymentEnabled['hotfix/social-link-previews-20261025']).toBe(false);
    expect(config.git.deploymentEnabled.main).not.toBe(false);
  });
  it('keeps the static fallback on the real canonical domain with absolute image URLs', () => {
    const template = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    expect(template).not.toContain('https://inkandwitness.com');
    expect(template).toContain(`property="og:image" content="${SOCIAL_ORIGIN}/`);
    expect(template).toContain(`name="twitter:image" content="${SOCIAL_ORIGIN}/`);
  });
  it('emits stable root query share URLs while leaving legacy query navigation intact', () => {
    const reader = readFileSync(path.join(process.cwd(), 'src/components/ArticleReaderModal.tsx'), 'utf8');
    const app = readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(reader).toContain('${origin}/?monograph=${encodeURIComponent(article.id)}');
    expect(reader).not.toContain('${origin}${pathname}?monograph=');
    expect(app).toContain("searchParams.get('monograph') || searchParams.get('article') || searchParams.get('id')");
  });
});
