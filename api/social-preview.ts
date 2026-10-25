import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { injectSocialMetadata, loadSocialMetadata, parseSocialPieceQuery, siteSocialMetadata, type SocialMetadata } from '../src/server/socialPreview.js';

let templatePromise: Promise<string> | undefined;
function readBuiltTemplate(): Promise<string> {
  templatePromise ||= readFile(path.join(process.cwd(), 'dist', 'index.html'), 'utf8').catch(error => {
    templatePromise = undefined;
    throw error;
  });
  return templatePromise;
}

export function createSocialPreviewHandler(dependencies = {
  readTemplate: readBuiltTemplate,
  loadMetadata: loadSocialMetadata,
}) {
  return async function socialPreview(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    try {
      const template = await dependencies.readTemplate();
      const query = parseSocialPieceQuery(req.url || '/');
      let metadata: SocialMetadata = siteSocialMetadata(null, query.kind === 'invalid' ? 400 : 200);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Keep the public application available during a quota/network outage.
        // Only safe site defaults are emitted when fresh metadata is unavailable.
        if (query.kind !== 'invalid') metadata = await Promise.race([
          dependencies.loadMetadata(query),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Metadata timeout')), 8_000); }),
        ]);
      } catch {
        metadata = { ...metadata, status: query.kind === 'piece' ? 503 : metadata.status, robots: 'noindex, follow' };
        if (query.kind === 'piece') res.setHeader('Retry-After', '30');
        console.warn('[Social Preview] Fresh public metadata is temporarily unavailable.');
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (metadata.robots.startsWith('noindex')) res.setHeader('X-Robots-Tag', 'noindex, follow');
      const html = injectSocialMetadata(template, metadata);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(Buffer.byteLength(html)));
        return res.status(metadata.status).end();
      }
      return res.status(metadata.status).send(html);
    } catch {
      console.error('[Social Preview] The built public page could not be rendered.');
      return res.status(503).send('The site is temporarily unavailable. Please retry.');
    }
  };
}

export default createSocialPreviewHandler();
