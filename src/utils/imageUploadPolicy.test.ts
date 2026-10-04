import { describe, expect, it } from 'vitest';
import {
  COLLECTION_COVER_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_ACCEPT,
  MAX_IMAGE_UPLOAD_BYTES,
  getCollectionCoverValidationError,
  getImageUploadValidationError
} from './imageUploadPolicy.js';

describe('browser image upload policy', () => {
  it('matches the three server-approved image types', () => {
    expect(IMAGE_UPLOAD_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });

  it('accepts a supported image within the storage limit', () => {
    expect(getImageUploadValidationError({ name: 'cover.jpg', type: 'image/jpeg', size: 50_000 })).toBeNull();
  });

  it('allows a supported extension when the browser omits the MIME type', () => {
    expect(getImageUploadValidationError({ name: 'cover.webp', type: '', size: 50_000 })).toBeNull();
  });

  it('rejects active/unsupported formats and oversized files', () => {
    expect(getImageUploadValidationError({ name: 'logo.svg', type: 'image/svg+xml', size: 1_000 })).toContain('Invalid format');
    expect(getImageUploadValidationError({ name: 'photo.png', type: 'image/png', size: MAX_IMAGE_UPLOAD_BYTES + 1 })).toContain('700 KB');
  });

  it('limits collection covers to JPEG files', () => {
    expect(COLLECTION_COVER_UPLOAD_ACCEPT).toBe('image/jpeg,.jpg,.jpeg');
    expect(getCollectionCoverValidationError({ name: 'collection.jpg', type: 'image/jpeg', size: 50_000 })).toBeNull();
    expect(getCollectionCoverValidationError({ name: 'collection.jpeg', type: '', size: 50_000 })).toBeNull();
    expect(getCollectionCoverValidationError({ name: 'collection.png', type: 'image/png', size: 50_000 })).toContain('JPEG');
    expect(getCollectionCoverValidationError({ name: 'mislabelled.jpg', type: 'image/png', size: 50_000 })).toContain('JPEG');
  });

  it('applies the existing storage limit to collection JPEGs', () => {
    expect(getCollectionCoverValidationError({
      name: 'collection.jpg',
      type: 'image/jpeg',
      size: MAX_IMAGE_UPLOAD_BYTES + 1
    })).toContain('700 KB');
  });
});
