export const IMAGE_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp';
export const CONTENT_COVER_UPLOAD_ACCEPT = 'image/jpeg,.jpg,.jpeg';
// Retain the collection-specific name for existing callers while both content
// types share the same strict JPEG policy.
export const COLLECTION_COVER_UPLOAD_ACCEPT = CONTENT_COVER_UPLOAD_ACCEPT;
export const MAX_IMAGE_UPLOAD_BYTES = 700 * 1024;

export type ContentCoverKind = 'collection' | 'bundle';

const APPROVED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const APPROVED_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;
const JPEG_IMAGE_EXTENSION = /\.jpe?g$/i;

export function getImageUploadValidationError(
  file: Pick<File, 'name' | 'size' | 'type'>
): string | null {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return 'Image file exceeds the 700 KB storage limit. Please compress it and try again.';
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
  const label = kind === 'bundle' ? 'Bundle' : 'Collection';

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return `${label} cover exceeds the 700 KB storage limit. Please compress the JPEG and try again.`;
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
