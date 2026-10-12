import sharp from 'sharp';
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_LABEL,
  MAX_STORED_IMAGE_DIMENSION,
  MAX_STORED_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS
} from '../shared/imageLimits.js';

export {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_STORED_IMAGE_BYTES
} from '../shared/imageLimits.js';

export type SafeImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ValidatedImage {
  buffer: Buffer;
  mimeType: SafeImageMimeType;
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
  dataUrl: string;
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function getPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(pngSignature)) return null;
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;

  // Requiring IEND to be the final chunk prevents appended HTML/script polyglots.
  if (buffer.readUInt32BE(buffer.length - 12) !== 0 || buffer.toString('ascii', buffer.length - 8, buffer.length - 4) !== 'IEND') {
    return null;
  }

  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function getJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 12 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff ||
    buffer[buffer.length - 1] !== 0xd9
  ) {
    return null;
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  let offset = 2;

  while (offset + 3 < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return null;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;

    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= buffer.length) return null;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length - 2) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += segmentLength;
  }

  return null;
}

function getWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP' ||
    buffer.readUInt32LE(4) !== buffer.length - 8
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkLength;
    if (chunkEnd > buffer.length) return null;

    if (chunkType === 'VP8X' && chunkLength >= 10) {
      return {
        width: readUInt24LE(buffer, dataOffset + 4) + 1,
        height: readUInt24LE(buffer, dataOffset + 7) + 1
      };
    }
    if (chunkType === 'VP8L' && chunkLength >= 5 && buffer[dataOffset] === 0x2f) {
      const b0 = buffer[dataOffset + 1];
      const b1 = buffer[dataOffset + 2];
      const b2 = buffer[dataOffset + 3];
      const b3 = buffer[dataOffset + 4];
      return {
        width: 1 + b0 + ((b1 & 0x3f) << 8),
        height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10)
      };
    }
    if (
      chunkType === 'VP8 ' &&
      chunkLength >= 10 &&
      buffer[dataOffset + 3] === 0x9d &&
      buffer[dataOffset + 4] === 0x01 &&
      buffer[dataOffset + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
      };
    }

    offset = chunkEnd + (chunkLength % 2);
  }

  return null;
}

function detectImage(buffer: Buffer): { mimeType: SafeImageMimeType; extension: ValidatedImage['extension']; width: number; height: number } | null {
  const png = getPngDimensions(buffer);
  if (png) return { mimeType: 'image/png', extension: 'png', ...png };

  const jpeg = getJpegDimensions(buffer);
  if (jpeg) return { mimeType: 'image/jpeg', extension: 'jpg', ...jpeg };

  const webp = getWebpDimensions(buffer);
  if (webp) return { mimeType: 'image/webp', extension: 'webp', ...webp };

  return null;
}

export function validateImageDataUrl(
  value: unknown,
  maximumBytes: number = MAX_IMAGE_UPLOAD_BYTES
): ValidatedImage {
  if (typeof value !== 'string') {
    throw new ImageValidationError('Image data must be a JPEG, PNG, or WebP data URL.');
  }

  // Reject an oversized encoded value before allocating its decoded buffer.
  const maximumEncodedLength = Math.ceil(maximumBytes / 3) * 4;
  if (value.length > maximumEncodedLength + 64) {
    throw new ImageValidationError(`Image is too large. Please keep it at or below ${MAX_IMAGE_UPLOAD_LABEL}.`);
  }

  const match = DATA_URL_PATTERN.exec(value);
  if (!match || match[2].length % 4 !== 0) {
    throw new ImageValidationError('Only Base64-encoded JPEG, PNG, or WebP images are accepted.');
  }

  const declaredMimeType = match[1] as SafeImageMimeType;
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > maximumBytes) {
    throw new ImageValidationError(`Image is too large. Please keep it at or below ${MAX_IMAGE_UPLOAD_LABEL}.`);
  }
  if (buffer.toString('base64') !== match[2]) {
    throw new ImageValidationError('Image Base64 encoding is invalid.');
  }

  const detected = detectImage(buffer);
  if (!detected || detected.mimeType !== declaredMimeType) {
    throw new ImageValidationError('The uploaded file contents do not match an approved image type.');
  }
  if (
    detected.width < 1 ||
    detected.height < 1 ||
    detected.width > MAX_IMAGE_DIMENSION ||
    detected.height > MAX_IMAGE_DIMENSION ||
    detected.width * detected.height > MAX_IMAGE_PIXELS
  ) {
    throw new ImageValidationError('Image dimensions are too large. Use an image no larger than 8192 px or 32 megapixels.');
  }

  return {
    buffer,
    mimeType: detected.mimeType,
    extension: detected.extension,
    width: detected.width,
    height: detected.height,
    dataUrl: `data:${detected.mimeType};base64,${buffer.toString('base64')}`
  };
}

export async function sanitizeImageDataUrl(value: unknown): Promise<ValidatedImage> {
  const source = validateImageDataUrl(value, MAX_IMAGE_UPLOAD_BYTES);

  try {
    const createDecoder = (maximumDimension?: number) => {
      const decoder = sharp(source.buffer, {
        failOn: 'warning',
        limitInputPixels: MAX_IMAGE_PIXELS,
        sequentialRead: true
      }).rotate();

      return maximumDimension
        ? decoder.resize({
            width: maximumDimension,
            height: maximumDimension,
            fit: 'inside',
            withoutEnlargement: true
          })
        : decoder;
    };

    const validateCanonical = (
      buffer: Buffer,
      mimeType: SafeImageMimeType
    ): ValidatedImage | null => {
      if (buffer.length > MAX_STORED_IMAGE_BYTES) return null;
      return validateImageDataUrl(
        `data:${mimeType};base64,${buffer.toString('base64')}`,
        MAX_STORED_IMAGE_BYTES
      );
    };

    // Preserve the original format when it already fits. Sharp strips
    // EXIF/XMP/comments by default, so the persisted copy cannot carry active
    // metadata or appended content.
    if (
      source.buffer.length <= MAX_STORED_IMAGE_BYTES
      && Math.max(source.width, source.height) <= MAX_STORED_IMAGE_DIMENSION
    ) {
      let initialBuffer: Buffer;
      if (source.mimeType === 'image/jpeg') {
        initialBuffer = await createDecoder().jpeg({ quality: 90, progressive: true }).toBuffer();
      } else if (source.mimeType === 'image/png') {
        initialBuffer = await createDecoder().png({ compressionLevel: 9 }).toBuffer();
      } else {
        initialBuffer = await createDecoder().webp({ quality: 90 }).toBuffer();
      }
      const initial = validateCanonical(initialBuffer, source.mimeType);
      if (initial) return initial;
    }

    // Large source files are accepted up to 5 MB, then progressively optimized
    // into a web-ready Firestore-safe asset. JPEG covers remain JPEG; an
    // oversized PNG may become WebP so transparency can be retained efficiently.
    const sourceMaximumDimension = Math.max(source.width, source.height);
    const startingDimension = Math.min(sourceMaximumDimension, MAX_STORED_IMAGE_DIMENSION);
    const attempts = [
      { scale: 1, quality: 80 },
      { scale: 0.8, quality: 74 },
      { scale: 0.65, quality: 68 },
      { scale: 0.5, quality: 62 },
      { scale: 0.35, quality: 56 }
    ].map(attempt => ({
      maximumDimension: Math.max(640, Math.round(startingDimension * attempt.scale)),
      quality: attempt.quality
    }));

    const outputMimeType: SafeImageMimeType = source.mimeType === 'image/jpeg'
      ? 'image/jpeg'
      : 'image/webp';

    for (const attempt of attempts) {
      const decoder = createDecoder(attempt.maximumDimension);
      const buffer = outputMimeType === 'image/jpeg'
        ? await decoder.jpeg({ quality: attempt.quality, progressive: true }).toBuffer()
        : await decoder.webp({ quality: attempt.quality, alphaQuality: attempt.quality }).toBuffer();
      const canonical = validateCanonical(buffer, outputMimeType);
      if (canonical) return canonical;
    }

    throw new ImageValidationError('Image could not be optimized for permanent storage. Please use a less complex image.');
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError('Image could not be decoded safely. Please use a valid JPEG, PNG, or WebP file.');
  }
}
