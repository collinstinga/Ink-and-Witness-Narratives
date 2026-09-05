export const IMAGE_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp';
export const MAX_IMAGE_UPLOAD_BYTES = 700 * 1024;

const APPROVED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const APPROVED_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;

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
