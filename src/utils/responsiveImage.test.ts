import { describe, expect, it } from 'vitest';
import { responsiveImageSrcSet, responsiveImageUrl } from './responsiveImage.js';
import { SUBSCRIPTION_IMAGE_VARIANTS } from './subscriptionImageVariants.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

describe('responsive public image sources', () => {
  it('sizes only the existing uploaded public asset routes', () => {
    expect(responsiveImageUrl('/api/assets/cover-123_jpg', 480)).toBe('/api/assets/cover-123_jpg?w=480&format=webp');
    expect(responsiveImageUrl('/api/assets/cover.jpg', 1280)).toBe('/api/assets/cover.jpg?w=1280&format=webp');
    expect(responsiveImageUrl('/uploads/legacy-cover.JPEG', 320)).toBe('/uploads/legacy-cover.JPEG?w=320&format=webp');
  });

  it('normalizes only the explicit canonical site origins to same-origin assets', () => {
    expect(responsiveImageUrl('https://www.inkandwitness-narratives.co.ke/api/assets/cover', 640)).toBe('/api/assets/cover?w=640&format=webp');
    expect(responsiveImageUrl('https://inkandwitness-narratives.co.ke/uploads/cover.jpg', 960)).toBe('/uploads/cover.jpg?w=960&format=webp');
  });

  it.each([
    'https://images.example.com/cover.jpg',
    'https://inkandwitness-narratives.co.ke.evil.test/api/assets/cover',
    'https://user:password@inkandwitness-narratives.co.ke/api/assets/cover',
    '//evil.test/api/assets/cover',
    'data:image/jpeg;base64,AAAA',
    'blob:private-image',
    '/api/admin/affiliates/literary-circle/resource-assets/draft',
    '/api/assets/%2e%2e',
    '/api/assets/cover.svg',
    '/uploads/../private.jpg',
    '/api/assets/cover?token=secret',
    '/api/assets/cover#fragment',
    '/api/assets/cover\\private',
    '/assets/subscriptions/nonexistent.png',
    '/assets/subscriptions/the-first-chapter.png?unknown=1',
    '/assets/subscriptions/the-first-chapter.png#fragment',
    ''
  ])('preserves unsupported references without creating a proxy: %s', source => {
    expect(responsiveImageUrl(source, 480)).toBe(source);
    expect(responsiveImageSrcSet(source)).toBeUndefined();
  });

  it.each([0, 1, 400, 481, 2400, 8192, Infinity, NaN])('does not create arbitrary-size variants: %s', width => {
    expect(responsiveImageUrl('/api/assets/cover', width)).toBe('/api/assets/cover');
  });

  it('provides ordered, deduplicated width descriptors without changing the original', () => {
    const original = '/api/assets/cover';
    expect(responsiveImageSrcSet(original, [960, 320, 640, 320])).toBe(
      '/api/assets/cover?w=320&format=webp 320w, /api/assets/cover?w=640&format=webp 640w, /api/assets/cover?w=960&format=webp 960w'
    );
    expect(responsiveImageSrcSet(original, [])).toBeUndefined();
    expect(original).toBe('/api/assets/cover');
  });

  it('maps only the four original subscription covers to immutable static variants', () => {
    expect(Object.keys(SUBSCRIPTION_IMAGE_VARIANTS)).toHaveLength(4);
    for (const [original, variants] of Object.entries(SUBSCRIPTION_IMAGE_VARIANTS)) {
      expect(responsiveImageUrl(original, 480)).toBe(variants[1].src);
      expect(responsiveImageUrl(`https://www.inkandwitness-narratives.co.ke${original}`, 480)).toBe(variants[1].src);
      expect(responsiveImageUrl(original, 1920)).toBe(variants[3].src);
      expect(responsiveImageSrcSet(original, [320, 640, 960])).toBe(
        [variants[0], variants[2], variants[3]].map(variant => `${variant.src} ${variant.width}w`).join(', ')
      );
      for (const variant of variants) {
        const buffer = readFileSync(new URL(`../../public${variant.src}`, import.meta.url));
        expect(variant.src).toContain(`.${variant.width}.${createHash('sha256').update(buffer).digest('hex').slice(0, 12)}.webp`);
        expect(buffer.length).toBeLessThan(120_000);
      }
    }
  });

  it('preserves the existing static cover bytes', () => {
    const expected = {
      'the-first-chapter': 'd664ffb16e25f33fe2231e7c79277075b805513f1d3ab738814869193aea78a9',
      'the-long-read': 'c82be515440b78924ef1148e55a8d9c9582b3d42f4dbe78ba292199b144f1a93',
      'the-deep-archive': '5b4dc238aa51c0077d1de99a45c71f466447baff7a939d4ec95dee507b20c2c6',
      'the-full-witness': '08ee05a9b8663913576ca2232ba80ed5b1b332c5b7b55c7818e008d3b7034d01'
    };
    for (const [name, hash] of Object.entries(expected)) {
      const bytes = readFileSync(new URL(`../../public/assets/subscriptions/${name}.png`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
    }
  });
});
