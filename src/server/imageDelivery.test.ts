import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { IMAGE_DELIVERY_WIDTHS } from '../shared/imageDeliveryPolicy.js';
import { ImageValidationError } from './imageSecurity.js';
import { ImageDeliveryRequestError, parseImageDeliveryVariant, renderResponsiveImage } from './imageDelivery.js';

const asDataUrl = (mimeType: string, buffer: Buffer) => `data:${mimeType};base64,${buffer.toString('base64')}`;

describe('bounded responsive-image requests', () => {
  it('keeps original delivery opt-in and unchanged', () => {
    expect(parseImageDeliveryVariant({})).toBeNull();
  });

  it.each(IMAGE_DELIVERY_WIDTHS)('accepts only an approved width %s and fixed WebP', width => {
    expect(parseImageDeliveryVariant({ w: String(width), format: 'webp' })).toEqual({ width, format: 'webp' });
  });

  it.each([
    { w: '480' }, { format: 'webp' }, { w: 480, format: 'webp' },
    { w: ['480', '960'], format: 'webp' }, { w: { value: '480' }, format: 'webp' },
    { w: '0480', format: 'webp' }, { w: '480.0', format: 'webp' },
    { w: '480 ', format: 'webp' }, { w: '-480', format: 'webp' },
    { w: '481', format: 'webp' }, { w: '999999999', format: 'webp' },
    { w: '480', format: ['webp'] }, { w: '480', format: 'svg' },
    { w: '480', format: 'WEBP' }
  ])('rejects arbitrary dimensions, coercion, and repeated query values %#', query => {
    expect(() => parseImageDeliveryVariant(query)).toThrow(ImageDeliveryRequestError);
  });
});

describe('responsive uploaded-image rendering', () => {
  it('delivers smaller WebP pixels while leaving the source JPEG untouched', async () => {
    const source = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#173456' } })
      .jpeg({ quality: 90 }).withMetadata({ exif: { IFD0: { ImageDescription: 'private metadata' } } }).toBuffer();
    const sourceCopy = Buffer.from(source);
    const result = await renderResponsiveImage(asDataUrl('image/jpeg', source), { width: 320, format: 'webp' });
    expect(result).toMatchObject({ mimeType: 'image/webp', extension: 'webp', width: 320, height: 200 });
    expect(result.buffer.length).toBeLessThan(source.length);
    expect(result.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(await sharp(result.buffer).metadata()).toMatchObject({ format: 'webp', width: 320, height: 200 });
    expect((await sharp(result.buffer).metadata()).exif).toBeUndefined();
    expect(source).toEqual(sourceCopy);
  });

  it('does not enlarge small artwork and bounds unusually tall legacy images', async () => {
    const small = await sharp({ create: { width: 12, height: 10, channels: 4, background: '#1234' } }).png().toBuffer();
    const original = await renderResponsiveImage(asDataUrl('image/png', small), { width: 640, format: 'webp' });
    expect(original).toMatchObject({ width: 12, height: 10 });

    const tall = await sharp({ create: { width: 1000, height: 4000, channels: 3, background: '#173456' } }).jpeg().toBuffer();
    const bounded = await renderResponsiveImage(asDataUrl('image/jpeg', tall), { width: 1280, format: 'webp' });
    expect(bounded).toMatchObject({ width: 480, height: 1920 });
  });

  it('preserves transparency in PNG-derived variants', async () => {
    const source = await sharp({ create: { width: 80, height: 80, channels: 4, background: { r: 0, g: 1, b: 2, alpha: 0.3 } } }).png().toBuffer();
    const result = await renderResponsiveImage(asDataUrl('image/png', source), { width: 64, format: 'webp' });
    expect((await sharp(result.buffer).metadata()).hasAlpha).toBe(true);
  });

  it('revalidates images and variants independently of the caller', async () => {
    await expect(renderResponsiveImage('data:image/svg+xml;base64,PHN2Zz4=', { width: 320, format: 'webp' })).rejects.toThrow(ImageValidationError);
    await expect(renderResponsiveImage('not-image-data', { width: 320, format: 'webp' })).rejects.toThrow(ImageValidationError);
    await expect(renderResponsiveImage('not-image-data', { width: 7 as never, format: 'webp' })).rejects.toThrow(ImageDeliveryRequestError);
  });

  it('rejects structurally plausible but undecodable stored pixels', async () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const header = Buffer.alloc(25);
    header.writeUInt32BE(13, 0);
    header.write('IHDR', 4, 'ascii');
    header.writeUInt32BE(1, 8);
    header.writeUInt32BE(1, 12);
    const end = Buffer.alloc(12);
    end.write('IEND', 4, 'ascii');
    await expect(renderResponsiveImage(asDataUrl('image/png', Buffer.concat([signature, header, end])), { width: 320, format: 'webp' }))
      .rejects.toThrow('could not be decoded safely');
  });

  it('uses byte-specific validators rather than a reader or session identifier', async () => {
    const source = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#173456' } }).jpeg().toBuffer();
    const data = asDataUrl('image/jpeg', source);
    const first = await renderResponsiveImage(data, { width: 320, format: 'webp' });
    const repeat = await renderResponsiveImage(data, { width: 320, format: 'webp' });
    const larger = await renderResponsiveImage(data, { width: 640, format: 'webp' });
    expect(first.etag).toBe(repeat.etag);
    expect(first.etag).not.toBe(larger.etag);
  });
});
