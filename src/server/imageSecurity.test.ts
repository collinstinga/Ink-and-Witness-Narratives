import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  ImageValidationError,
  MAX_STORED_IMAGE_BYTES,
  sanitizeImageDataUrl,
  validateImageDataUrl
} from './imageSecurity.js';

function asDataUrl(mimeType: string, buffer: Buffer): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function pngFixture(width = 1, height = 1): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  const iend = Buffer.alloc(12);
  iend.write('IEND', 4, 'ascii');
  return Buffer.concat([signature, ihdr, iend]);
}

function jpegFixture(width = 1, height = 1): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9
  ]);
}

function webpFixture(width = 1, height = 1): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

describe('image upload validation', () => {
  it.each([
    ['image/png', pngFixture(640, 480), 'png', 640, 480],
    ['image/jpeg', jpegFixture(320, 240), 'jpg', 320, 240],
    ['image/webp', webpFixture(1200, 630), 'webp', 1200, 630]
  ] as const)('accepts structurally valid %s bytes', (mimeType, fixture, extension, width, height) => {
    const image = validateImageDataUrl(asDataUrl(mimeType, fixture));

    expect(image.mimeType).toBe(mimeType);
    expect(image.extension).toBe(extension);
    expect(image.width).toBe(width);
    expect(image.height).toBe(height);
    expect(image.dataUrl).toBe(asDataUrl(mimeType, fixture));
  });

  it('rejects SVG and HTML data even when Base64 encoded', () => {
    const svg = asDataUrl('image/svg+xml', Buffer.from('<svg onload="alert(1)"></svg>'));
    const html = asDataUrl('text/html', Buffer.from('<script>alert(1)</script>'));

    expect(() => validateImageDataUrl(svg)).toThrow(ImageValidationError);
    expect(() => validateImageDataUrl(html)).toThrow(ImageValidationError);
  });

  it('rejects declared MIME types that do not match the file signature', () => {
    expect(() => validateImageDataUrl(asDataUrl('image/png', jpegFixture()))).toThrow(
      'contents do not match'
    );
  });

  it('rejects malformed Base64 and data URLs', () => {
    expect(() => validateImageDataUrl('not-a-data-url')).toThrow(ImageValidationError);
    expect(() => validateImageDataUrl('data:image/png;base64,%%%%')).toThrow(ImageValidationError);
    expect(() => validateImageDataUrl('data:image/png;base64,AAA')).toThrow(ImageValidationError);
  });

  it('rejects encoded payloads before decoding when they exceed the byte cap', () => {
    const oversized = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_STORED_IMAGE_BYTES + 1) / 3) * 4)}`;
    expect(() => validateImageDataUrl(oversized)).toThrow('too large');
  });

  it('rejects excessive width, height, and total pixels', () => {
    expect(() => validateImageDataUrl(asDataUrl('image/png', pngFixture(8193, 1)))).toThrow('dimensions');
    expect(() => validateImageDataUrl(asDataUrl('image/png', pngFixture(8000, 5000)))).toThrow('dimensions');
  });

  it('rejects appended polyglot content after a PNG end marker', () => {
    const polyglot = Buffer.concat([pngFixture(), Buffer.from('<script>alert(1)</script>')]);
    expect(() => validateImageDataUrl(asDataUrl('image/png', polyglot))).toThrow('contents do not match');
  });

  it.each([
    ['image/jpeg', 'jpeg'],
    ['image/png', 'png'],
    ['image/webp', 'webp']
  ] as const)('decodes and re-encodes a genuine %s upload', async (mimeType, format) => {
    const source = sharp({
      create: { width: 8, height: 6, channels: 4, background: '#9f1239' }
    });
    const buffer = await source[format]().toBuffer();

    const sanitized = await sanitizeImageDataUrl(asDataUrl(mimeType, buffer));

    expect(sanitized.mimeType).toBe(mimeType);
    expect(sanitized.width).toBe(8);
    expect(sanitized.height).toBe(6);
    await expect(sharp(sanitized.buffer).metadata()).resolves.toMatchObject({ width: 8, height: 6 });
  });

  it('rejects a header-only file that cannot be decoded as pixels', async () => {
    await expect(sanitizeImageDataUrl(asDataUrl('image/png', pngFixture())))
      .rejects.toThrow('could not be decoded safely');
  });

  it('strips embedded image metadata during canonical re-encoding', async () => {
    const original = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#0f172a' }
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { ImageDescription: '<script>alert(1)</script>' } } })
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const sanitized = await sanitizeImageDataUrl(asDataUrl('image/jpeg', original));
    const metadata = await sharp(sanitized.buffer).metadata();

    expect(metadata.exif).toBeUndefined();
    expect(sanitized.buffer.toString('latin1')).not.toContain('<script>');
  });
});
