import { IMAGE_DELIVERY_WIDTHS, isImageDeliveryWidth, type ImageDeliveryWidth } from '../shared/imageDeliveryPolicy.js';
import { SUBSCRIPTION_IMAGE_VARIANTS } from './subscriptionImageVariants.js';

const SITE_ORIGINS = new Set([
  'https://www.inkandwitness-narratives.co.ke',
  'https://inkandwitness-narratives.co.ke'
]);
const ASSET_PATH = /^\/api\/assets\/(?:[a-zA-Z0-9_-]{1,180}|[a-zA-Z0-9_-]{1,170}\.(?:jpe?g|png|webp))$/i;
const LEGACY_PATH = /^\/uploads\/[a-zA-Z0-9_-]{1,170}\.(?:jpe?g|png|webp)$/i;

/**
 * Only uploaded public asset routes support these transforms. This is not an
 * external image proxy: arbitrary origins, private routes and inline images
 * retain their existing source unchanged.
 */
function localImagePath(source: string): string | null {
  if (!source || source.length > 512 || source.includes('\\')) return null;
  let path: string;
  if (source.startsWith('/') && !source.startsWith('//')) {
    if (source.includes('?') || source.includes('#')) return null;
    path = source;
  } else {
    try {
      const parsed = new URL(source);
      if (!SITE_ORIGINS.has(parsed.origin) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  return path;
}

export function responsiveImageUrl(source: string, width: number): string {
  const path = localImagePath(source);
  if (!path || !isImageDeliveryWidth(width)) return source;
  const staticVariants = Object.hasOwn(SUBSCRIPTION_IMAGE_VARIANTS, path) ? SUBSCRIPTION_IMAGE_VARIANTS[path] : undefined;
  if (staticVariants) {
    return (staticVariants.find(variant => variant.width >= width) || staticVariants[staticVariants.length - 1]).src;
  }
  if (!ASSET_PATH.test(path) && !LEGACY_PATH.test(path)) return source;
  return `${path}?w=${width}&format=webp`;
}

export function responsiveImageSrcSet(
  source: string,
  widths: readonly ImageDeliveryWidth[] = IMAGE_DELIVERY_WIDTHS
): string | undefined {
  const path = localImagePath(source);
  if (!path) return undefined;
  const approved = [...new Set(widths)].filter(isImageDeliveryWidth).sort((left, right) => left - right);
  if (!approved.length) return undefined;
  const staticVariants = Object.hasOwn(SUBSCRIPTION_IMAGE_VARIANTS, path) ? SUBSCRIPTION_IMAGE_VARIANTS[path] : undefined;
  if (staticVariants) {
    const selected = approved.map(width => staticVariants.find(variant => variant.width >= width) || staticVariants[staticVariants.length - 1]);
    return [...new Set(selected)].map(variant => `${variant.src} ${variant.width}w`).join(', ');
  }
  if (!ASSET_PATH.test(path) && !LEGACY_PATH.test(path)) return undefined;
  return approved.map(width => `${path}?w=${width}&format=webp ${width}w`).join(', ');
}
