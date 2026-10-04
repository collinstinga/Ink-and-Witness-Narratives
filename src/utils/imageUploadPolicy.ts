export const IMAGE_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp';
export const COLLECTION_COVER_UPLOAD_ACCEPT = 'image/jpeg,.jpg,.jpeg';
export const MAX_IMAGE_UPLOAD_BYTES = 700 * 1024;

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

export function getCollectionCoverValidationError(
  file: Pick<File, 'name' | 'size' | 'type'>
): string | null {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return 'Collection cover exceeds the 700 KB storage limit. Please compress the JPEG and try again.';
  }

  const mimeType = file.type.trim().toLowerCase();
  if ((mimeType && mimeType !== 'image/jpeg') || (!mimeType && !JPEG_IMAGE_EXTENSION.test(file.name))) {
    return 'Collection covers must be JPEG files (.jpg or .jpeg).';
  }

  return null;
}
