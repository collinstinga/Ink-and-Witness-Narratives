import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLLECTION_COVER_UPLOAD_ACCEPT,
  CONTENT_COVER_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_ACCEPT,
  MAX_IMAGE_TRANSPORT_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  getCollectionCoverValidationError,
  getContentCoverValidationError,
  getImageUploadValidationError,
  hasSafeImageDimensions,
  prepareImageDataUrlForUpload,
  prepareImageFileForUpload
} from './imageUploadPolicy.js';

function installBrowserImageMocks(options: {
  width: number;
  height: number;
  optimizedSize?: number;
}) {
  const createObjectURL = vi.fn(() => 'blob:test-image');
  const revokeObjectURL = vi.fn();
  const canvasToBlob = vi.fn((callback: (blob: Blob | null) => void, mimeType: string) => {
    callback(new Blob([new Uint8Array(options.optimizedSize || 1024)], { type: mimeType }));
  });

  class MockImage {
    naturalWidth = options.width;
    naturalHeight = options.height;
    width = options.width;
    height = options.height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  class MockFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob & { type?: string }) {
      this.result = `data:${blob.type || 'image/jpeg'};base64,QUJD`;
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.stubGlobal('Image', MockImage);
  vi.stubGlobal('FileReader', MockFileReader);
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: canvasToBlob
    })
  });

  return { createObjectURL, revokeObjectURL, canvasToBlob };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser image upload policy', () => {
  it('matches the three server-approved image types', () => {
    expect(IMAGE_UPLOAD_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });

  it('accepts a supported image at or below the 5 MB upload limit', () => {
    expect(getImageUploadValidationError({ name: 'cover.jpg', type: 'image/jpeg', size: 50_000 })).toBeNull();
    expect(getImageUploadValidationError({ name: 'cover.jpg', type: 'image/jpeg', size: MAX_IMAGE_UPLOAD_BYTES })).toBeNull();
  });

  it('keeps the optimized Base64 JSON transport below the Vercel Function ceiling', () => {
    const encodedLength = Math.ceil(MAX_IMAGE_TRANSPORT_BYTES / 3) * 4;
    const representativeEnvelopeBytes = encodedLength + 1024;
    expect(representativeEnvelopeBytes).toBeLessThan(4.5 * 1024 * 1024);
  });

  it('uses the same decompression-bomb limits as the server before sending an unchanged file', () => {
    expect(hasSafeImageDimensions(8_000, 4_000)).toBe(true);
    expect(hasSafeImageDimensions(8_193, 1)).toBe(false);
    expect(hasSafeImageDimensions(8_000, 5_000)).toBe(false);
  });

  it('keeps a transport-safe source unchanged and always releases its object URL', async () => {
    const mocks = installBrowserImageMocks({ width: 1200, height: 800 });
    const file = new Blob([new Uint8Array(1024)], { type: 'image/jpeg' }) as File;
    Object.defineProperty(file, 'name', { value: 'cover.jpg' });

    await expect(prepareImageFileForUpload(file)).resolves.toBe('data:image/jpeg;base64,QUJD');
    expect(mocks.canvasToBlob).not.toHaveBeenCalled();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
  });

  it('optimizes an oversized extension-inferred PNG to a transport-safe WebP', async () => {
    const mocks = installBrowserImageMocks({ width: 4000, height: 3000, optimizedSize: 2048 });
    const file = {
      name: 'cover.png',
      type: '',
      size: MAX_IMAGE_TRANSPORT_BYTES + 1
    } as File;

    await expect(prepareImageFileForUpload(file)).resolves.toBe('data:image/webp;base64,QUJD');
    expect(mocks.canvasToBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.86);
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
  });

  it('keeps a safe generated data URL unchanged after checking its decoded dimensions', async () => {
    const mocks = installBrowserImageMocks({ width: 1200, height: 800 });
    const dataUrl = 'data:image/jpeg;base64,QUJD';

    await expect(prepareImageDataUrlForUpload(dataUrl)).resolves.toBe(dataUrl);
    expect(mocks.canvasToBlob).not.toHaveBeenCalled();
  });

  it('downscales a transport-small data URL with unsafe decoded dimensions', async () => {
    const mocks = installBrowserImageMocks({ width: 9000, height: 1000, optimizedSize: 2048 });

    await expect(prepareImageDataUrlForUpload('data:image/jpeg;base64,QUJD'))
      .resolves.toBe('data:image/jpeg;base64,QUJD');
    expect(mocks.canvasToBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.86);
  });

  it('allows a supported extension when the browser omits the MIME type', () => {
    expect(getImageUploadValidationError({ name: 'cover.webp', type: '', size: 50_000 })).toBeNull();
  });

  it('rejects active/unsupported formats and oversized files', () => {
    expect(getImageUploadValidationError({ name: 'logo.svg', type: 'image/svg+xml', size: 1_000 })).toContain('Invalid format');
    expect(getImageUploadValidationError({ name: 'photo.png', type: 'image/png', size: MAX_IMAGE_UPLOAD_BYTES + 1 })).toContain('5 MB');
  });

  it('limits collection covers to JPEG files', () => {
    expect(CONTENT_COVER_UPLOAD_ACCEPT).toBe('image/jpeg,.jpg,.jpeg');
    expect(COLLECTION_COVER_UPLOAD_ACCEPT).toBe('image/jpeg,.jpg,.jpeg');
    expect(getCollectionCoverValidationError({ name: 'collection.jpg', type: 'image/jpeg', size: 50_000 })).toBeNull();
    expect(getCollectionCoverValidationError({ name: 'collection.jpeg', type: '', size: 50_000 })).toBeNull();
    expect(getCollectionCoverValidationError({ name: 'collection.png', type: 'image/png', size: 50_000 })).toContain('JPEG');
    expect(getCollectionCoverValidationError({ name: 'mislabelled.jpg', type: 'image/png', size: 50_000 })).toContain('JPEG');
  });

  it('applies the same JPEG-only policy to bundle covers', () => {
    expect(getContentCoverValidationError({ name: 'bundle.jpg', type: 'image/jpeg', size: 50_000 }, 'bundle')).toBeNull();
    expect(getContentCoverValidationError({ name: 'bundle.jpeg', type: '', size: 50_000 }, 'bundle')).toBeNull();
    expect(getContentCoverValidationError({ name: 'bundle.webp', type: 'image/webp', size: 50_000 }, 'bundle')).toContain('Bundle');
    expect(getContentCoverValidationError({ name: 'mislabelled.jpg', type: 'image/png', size: 50_000 }, 'bundle')).toContain('JPEG');
  });

  it('applies the 5 MB upload limit to collection JPEGs', () => {
    expect(getCollectionCoverValidationError({
      name: 'collection.jpg',
      type: 'image/jpeg',
      size: MAX_IMAGE_UPLOAD_BYTES + 1
    })).toContain('5 MB');
  });

  it('applies the 5 MB upload limit to bundle JPEGs', () => {
    expect(getContentCoverValidationError({
      name: 'bundle.jpg',
      type: 'image/jpeg',
      size: MAX_IMAGE_UPLOAD_BYTES + 1
    }, 'bundle')).toContain('5 MB');
  });
});
