import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFavicon } from './favicon.js';
import { responsiveImageUrl } from './responsiveImage.js';

function iconLink() {
  const link = {
    href: '', rel: 'icon', type: '',
    removeAttribute: vi.fn((name: string) => { if (name === 'type') link.type = ''; }),
  };
  return link;
}

let icons: ReturnType<typeof iconLink>[];
let documentStub: {
  querySelectorAll: ReturnType<typeof vi.fn>;
  createElement: ReturnType<typeof vi.fn>;
  head: { appendChild: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  icons = [];
  documentStub = {
    querySelectorAll: vi.fn(() => icons),
    createElement: vi.fn(() => iconLink()),
    head: { appendChild: vi.fn((link: ReturnType<typeof iconLink>) => { icons.push(link); }) },
  };
  vi.stubGlobal('document', documentStub);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('bounded favicon delivery', () => {
  it('serves an approved uploaded favicon at 64px with the actual WebP MIME', () => {
    const original = '/uploads/favicon-original.jpg';
    const delivered = responsiveImageUrl(original, 64);
    applyFavicon(delivered, delivered !== original ? 'image/webp' : undefined);
    expect(icons).toHaveLength(1);
    expect(icons[0].href).toBe('/uploads/favicon-original.jpg?w=64&format=webp');
    expect(icons[0].type).toBe('image/webp');
    expect(icons[0].rel).toBe('shortcut icon');
  });

  it.each([
    'https://images.example.com/writer-icon.png',
    '/assets/custom-brand.svg',
    'data:image/png;base64,aWNvbg==',
    '/uploads/favicon-original.jpg?existing=variant',
  ])('preserves an unsupported/original source and clears only our stale transformed MIME: %s', original => {
    applyFavicon('/uploads/old.jpg?w=64&format=webp', 'image/webp');
    const delivered = responsiveImageUrl(original, 64);
    applyFavicon(delivered, delivered !== original ? 'image/webp' : undefined);
    expect(icons[0].href).toBe(original);
    expect(icons[0].type).toBe('');
    expect(icons[0].removeAttribute).toHaveBeenCalledWith('type');
  });

  it('keeps the original fallback icon when no writer favicon is supplied', () => {
    applyFavicon('/uploads/old.jpg?w=64&format=webp', 'image/webp');
    applyFavicon(null);
    expect(icons[0].href).toBe('/icon.svg');
    expect(icons[0].type).toBe('');
  });

  it('does not alter existing original MIME declarations or unrelated manifest links', () => {
    const originalIcon = iconLink();
    originalIcon.type = 'image/png';
    icons.push(originalIcon);
    applyFavicon('https://images.example.com/writer-icon.png');
    expect(originalIcon.href).toBe('https://images.example.com/writer-icon.png');
    expect(originalIcon.type).toBe('image/png');
    expect(originalIcon.removeAttribute).not.toHaveBeenCalled();
    expect(documentStub.querySelectorAll).toHaveBeenCalledWith("link[rel*='icon']");
    expect(documentStub.createElement).not.toHaveBeenCalled();
  });

  it('applies only a bounded display derivative to the fetched author favicon', () => {
    const source = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('responsiveImageUrl(originalFavicon, 64)');
    expect(source).toContain("deliveredFavicon !== originalFavicon ? 'image/webp' : undefined");
    expect(source).not.toContain('authorData.faviconUrl =');
  });
});
