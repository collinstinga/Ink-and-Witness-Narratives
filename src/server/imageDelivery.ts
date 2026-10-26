import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { isImageDeliveryWidth, type ImageDeliveryWidth } from '../shared/imageDeliveryPolicy.js';
import { MAX_IMAGE_PIXELS, validateImageDataUrl, ImageValidationError } from './imageSecurity.js';

export interface ImageDeliveryVariant {
  width: ImageDeliveryWidth;
  format: 'webp';
}

export class ImageDeliveryRequestError extends Error {
  constructor() {
    super('Unsupported image size or format.');
    this.name = 'ImageDeliveryRequestError';
  }
}

/** Call before the asset lookup. Arrays/objects and arbitrary sizes fail closed. */
export function parseImageDeliveryVariant(query: { w?: unknown; format?: unknown }): ImageDeliveryVariant | null {
  if (query.w === undefined && query.format === undefined) return null;
  if (typeof query.w !== 'string' || !/^[1-9][0-9]{1,3}$/.test(query.w) || query.format !== 'webp') {
    throw new ImageDeliveryRequestError();
  }
  const width = Number(query.w);
  if (!isImageDeliveryWidth(width)) throw new ImageDeliveryRequestError();
  return { width, format: 'webp' };
}

/**
 * Derive bytes from an already-authorized public uploaded asset. No network,
 * filesystem, database writes, crop changes or original-image replacement.
 * The public route must reject private assets before calling this function.
 */
export async function renderResponsiveImage(dataUrl: unknown, variant: ImageDeliveryVariant): Promise<{
  buffer: Buffer;
  mimeType: 'image/webp';
  extension: 'webp';
  width: number;
  height: number;
  etag: string;
}> {
  // Defense in depth if a caller bypasses the query parser.
  if (!variant || !isImageDeliveryWidth(variant.width) || variant.format !== 'webp') {
    throw new ImageDeliveryRequestError();
  }
  const source = validateImageDataUrl(dataUrl);
  try {
    const result = await sharp(source.buffer, {
      failOn: 'warning',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true
    })
      .rotate()
      .resize({ width: variant.width, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, alphaQuality: 80, effort: 3 })
      .timeout({ seconds: 3 })
      .toBuffer({ resolveWithObject: true });

    // Stay comfortably below the Function response cap even for unusual
    // legacy images. Never fall back to a mismatched content type/cache key.
    if (result.data.length > 3 * 1024 * 1024) throw new ImageValidationError('Derived image is too large.');
    return {
      buffer: result.data,
      mimeType: 'image/webp',
      extension: 'webp',
      width: result.info.width,
      height: result.info.height,
      etag: `"${createHash('sha256').update(result.data).digest('hex')}"`
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError('Stored image could not be decoded safely.');
  }
}
