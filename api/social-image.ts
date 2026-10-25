import type { Request, Response } from 'express';
import { SOCIAL_ORIGIN, authorSocialImageSource, readSocialAuthor } from '../src/server/socialPreview.js';
import { validateImageDataUrl } from '../src/server/imageSecurity.js';

export function createSocialImageHandler(readAuthor = readSocialAuthor) {
  return async function socialImage(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    // This is one public branding image, not an arbitrary asset/database proxy.
    if (new URL(req.url || '/', SOCIAL_ORIGIN).search) {
      return res.status(400).json({ error: 'Invalid image request.' });
    }
    try {
      const source = authorSocialImageSource(await readAuthor());
      if (source?.startsWith('https://')) {
        // Source is a validated, saved public branding URL, not a caller URL.
        // Follow existing image delivery; never fetch/proxy it server-side.
        // The shared validator rejects private/credentialed hosts, non-HTTPS
        // URLs, and our own image/API endpoints that could cause redirect loops.
        res.setHeader('Location', source);
        return res.status(302).send('');
      }
      if (!source?.startsWith('data:image/')) return res.status(404).json({ error: 'Image not found.' });
      // Stay below Vercel's 4.5 MB response ceiling even when uploads allow 5 MB.
      const image = validateImageDataUrl(source, 4 * 1024 * 1024);
      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('Content-Length', String(image.buffer.length));
      res.setHeader('Content-Disposition', `inline; filename="ink-and-witness.${image.extension}"`);
      if (req.method === 'HEAD') return res.status(200).end();
      return res.status(200).send(image.buffer);
    } catch {
      return res.status(503).json({ error: 'Image is temporarily unavailable.' });
    }
  };
}

export default createSocialImageHandler();
