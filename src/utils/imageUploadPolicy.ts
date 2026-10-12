import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_TRANSPORT_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_LABEL,
} from '../shared/imageLimits.js';

export const IMAGE_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp';
export const CONTENT_COVER_UPLOAD_ACCEPT = 'image/jpeg,.jpg,.jpeg';
// Retain the collection-specific name for existing callers while both content
// types share the same strict JPEG policy.
export const COLLECTION_COVER_UPLOAD_ACCEPT = CONTENT_COVER_UPLOAD_ACCEPT;
export { MAX_IMAGE_UPLOAD_BYTES } from '../shared/imageLimits.js';
export { MAX_IMAGE_TRANSPORT_BYTES } from '../shared/imageLimits.js';

export type ContentCoverKind = 'collection' | 'bundle' | 'subscription';

const APPROVED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const APPROVED_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;
const JPEG_IMAGE_EXTENSION = /\.jpe?g$/i;

export function getImageUploadValidationError(
  file: Pick<File, 'name' | 'size' | 'type'>
): string | null {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return `Image file exceeds the ${MAX_IMAGE_UPLOAD_LABEL} upload limit. Please compress it and try again.`;
  }

  if (
    !APPROVED_IMAGE_MIME_TYPES.has(file.type.toLowerCase()) &&
    !APPROVED_IMAGE_EXTENSION.test(file.name)
  ) {
    return 'Invalid format. Supported image types: JPEG, PNG, and WebP.';
  }

  return null;
}

export function getContentCoverValidationError(
  file: Pick<File, 'name' | 'size' | 'type'>,
  kind: ContentCoverKind
): string | null {
  const label = kind === 'bundle' ? 'Bundle' : kind === 'subscription' ? 'Reader pass' : 'Collection';

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return `${label} cover exceeds the ${MAX_IMAGE_UPLOAD_LABEL} upload limit. Please compress the JPEG and try again.`;
  }

  const mimeType = file.type.trim().toLowerCase();
  if ((mimeType && mimeType !== 'image/jpeg') || (!mimeType && !JPEG_IMAGE_EXTENSION.test(file.name))) {
    return `${label} covers must be JPEG files (.jpg or .jpeg).`;
  }

  return null;
}

export function getCollectionCoverValidationError(
  file: Pick<File, 'name' | 'size' | 'type'>
): string | null {
  return getContentCoverValidationError(file, 'collection');
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The selected image could not be read.'));
    };
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function decodedDataUrlBytes(value: string): number {
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return Number.POSITIVE_INFINITY;
  const payload = value.slice(commaIndex + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function loadBrowserImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image could not be decoded.'));
    image.src = source;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('The selected image could not be optimized.')),
      mimeType,
      quality,
    );
  });
}

async function optimizeBrowserImage(
  source: string,
  sourceMimeType: string,
  loadedImage?: HTMLImageElement,
): Promise<string> {
  const image = loadedImage || await loadBrowserImage(source);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (naturalWidth < 1 || naturalHeight < 1) {
    throw new Error('The selected image has invalid dimensions.');
  }

  const outputMimeType = sourceMimeType.toLowerCase() === 'image/jpeg'
    ? 'image/jpeg'
    : 'image/webp';
  const sourceMaximumDimension = Math.max(naturalWidth, naturalHeight);
  const attempts = [
    { maximumDimension: 3000, quality: 0.86 },
    { maximumDimension: 2400, quality: 0.82 },
    { maximumDimension: 1920, quality: 0.78 },
    { maximumDimension: 1600, quality: 0.74 },
    { maximumDimension: 1280, quality: 0.7 },
    { maximumDimension: 1024, quality: 0.66 },
  ];

  for (const attempt of attempts) {
    const scale = Math.min(1, attempt.maximumDimension / sourceMaximumDimension);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image optimization is unavailable in this browser.');
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, outputMimeType, attempt.quality);
    if (blob.size <= MAX_IMAGE_TRANSPORT_BYTES) {
      return readBlobAsDataUrl(blob);
    }
  }

  throw new Error('The selected image could not be prepared safely. Try a simpler or smaller image.');
}

export function hasSafeImageDimensions(width: number, height: number): boolean {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width >= 1
    && height >= 1
    && width <= MAX_IMAGE_DIMENSION
    && height <= MAX_IMAGE_DIMENSION
    && width * height <= MAX_IMAGE_PIXELS;
}

/**
 * Accept a writer-selected source file up to 5 MB while keeping the actual
 * Function request below Vercel's non-configurable payload ceiling.
 */
export async function prepareImageFileForUpload(file: File): Promise<string> {
  const validationError = getImageUploadValidationError(file);
  if (validationError) throw new Error(validationError);

  const declaredMimeType = file.type.trim().toLowerCase();
  const inferredMimeType = declaredMimeType
    || (/\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadBrowserImage(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (file.size <= MAX_IMAGE_TRANSPORT_BYTES && hasSafeImageDimensions(width, height)) {
      return await readBlobAsDataUrl(file);
    }
    return await optimizeBrowserImage(objectUrl, inferredMimeType, image);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Optimize a crop generated in-browser if its JPEG happens to exceed the safe transport size. */
export async function prepareImageDataUrlForUpload(dataUrl: string): Promise<string> {
  const mimeType = /^data:(image\/(?:jpeg|png|webp));base64,/i.exec(dataUrl)?.[1] || 'image/jpeg';
  const image = await loadBrowserImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (decodedDataUrlBytes(dataUrl) <= MAX_IMAGE_TRANSPORT_BYTES && hasSafeImageDimensions(width, height)) {
    return dataUrl;
  }
  return optimizeBrowserImage(dataUrl, mimeType, image);
}
