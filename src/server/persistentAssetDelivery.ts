import type { RequestHandler } from 'express';
import { ImageDeliveryRequestError, parseImageDeliveryVariant, renderResponsiveImage } from './imageDelivery.js';
import { ImageValidationError, validateImageDataUrl } from './imageSecurity.js';

export interface UploadedDeliveryAsset {
  dataUrl?: unknown;
  accessScope?: unknown;
}
export type UploadedDeliveryAssetLoader = (assetId: string) => Promise<UploadedDeliveryAsset | null | undefined>;

/** The loader reads one uploaded asset; this handler never initializes a store or writes. */
export function createPersistentAssetHandler(getAsset: UploadedDeliveryAssetLoader): RequestHandler {
  return async (req, res, next) => {
    const noStore = () => {
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('CDN-Cache-Control', 'no-store');
      res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    };
    // An invalid request, missing image or private draft must never be cached.
    noStore();
    try {
      const variant = parseImageDeliveryVariant({ w: req.query.w, format: req.query.format });
      const rawId = req.params.assetId || req.params.filename;
      const validAssetId = /^[a-zA-Z0-9_-]{1,180}$/;
      const validLegacyFilename = /^[a-zA-Z0-9_-]{1,170}\.(?:jpe?g|png|webp)$/i;
      // Preserve the exact legacy filename grammar on either public alias.
      const isLegacyFilename = Boolean(req.params.filename) || validLegacyFilename.test(rawId);
      if (
        (!isLegacyFilename && !validAssetId.test(rawId))
        || (isLegacyFilename && !validLegacyFilename.test(rawId))
      ) {
        return res.status(404).json({ error: 'Image not found.' });
      }
      const assetId = isLegacyFilename ? rawId.replace('.', '_') : rawId;
      const asset = await getAsset(assetId);
      if (!asset?.dataUrl) return res.status(404).json({ error: 'Image not found.' });
      // The public route must never decode/cache private Literary Circle drafts.
      // Only explicit publication changes that asset scope in the existing store.
      if (asset.accessScope === 'literary_circle_private') {
        return res.status(404).json({ error: 'Image not found.' });
      }

      const image = variant
        ? await renderResponsiveImage(asset.dataUrl, variant)
        : validateImageDataUrl(asset.dataUrl);
      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${assetId}.${image.extension}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.removeHeader('CDN-Cache-Control');
      res.removeHeader('Vercel-CDN-Cache-Control');
      if ('etag' in image) {
        res.setHeader('ETag', image.etag);
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=31536000');
        res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=31536000');
      }
      res.setHeader('Content-Length', String(image.buffer.length));
      return res.send(image.buffer);
    } catch (error) {
      // A disconnected/already-streaming response cannot safely become JSON.
      if (res.headersSent) return next(error);
      // A late send/header failure must not inherit the success cache contract,
      // ETag, length or image type when the handler returns a JSON error instead.
      noStore();
      for (const header of ['ETag', 'Content-Length', 'Content-Disposition', 'Content-Type']) res.removeHeader(header);
      if (error instanceof ImageDeliveryRequestError) {
        return res.status(400).json({ error: 'Unsupported image size or format.' });
      }
      if (error instanceof ImageValidationError) {
        console.warn('[Assets] Rejected invalid stored image.');
        return res.status(415).json({ error: 'Stored image is not an approved image type.' });
      }
      console.error('[Assets] Failed to serve persistent image:', error);
      return res.status(503).json({ error: 'Image storage is temporarily unavailable.' });
    }
  };
}
