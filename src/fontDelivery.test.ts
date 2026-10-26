import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');
const fontsDirectory = new URL('../public/fonts/', import.meta.url);
const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]);

describe('same-origin font delivery', () => {
  it('removes the third-party stylesheet waterfall rather than deferring it with fragile inline events', () => {
    expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    expect(css).not.toMatch(/https?:\/\/fonts\./);
    expect(html).not.toMatch(/onload\s*=/i);
  });

  it.each([
    ['Cinzel', 'normal', '500 800', 2],
    ['JetBrains Mono', 'normal', '400 500', 6],
    ['Newsreader', 'normal', '300 600', 3],
    ['Newsreader', 'italic', '400 500', 3],
    ['Plus Jakarta Sans', 'normal', '300 700', 4],
  ] as const)('preserves %s %s weights %s and all %i original language subsets', (family, style, weights, count) => {
    const matching = faces.filter((face) => face.includes(`font-family: '${family}';`) && face.includes(`font-style: ${style};`));
    expect(matching).toHaveLength(count);
    for (const face of matching) {
      expect(face).toContain(`font-weight: ${weights};`);
      expect(face).toContain('font-display: swap;');
      expect(face).toMatch(/unicode-range:\s*U\+/);
      expect(face).toMatch(/src:\s*url\(\/fonts\/[^)]+\.woff2\) format\('woff2'\)/);
    }
  });

  it('ships every referenced font as an actual WOFF2 with a matching content-hash filename', () => {
    expect(faces).toHaveLength(18);
    const urls = faces.map((face) => face.match(/url\(\/fonts\/([^)]+)\)/)![1]);
    expect(new Set(urls).size).toBe(18);
    expect(readdirSync(fontsDirectory).filter((filename) => filename.endsWith('.woff2')).sort()).toEqual([...urls].sort());
    for (const filename of urls) {
      const bytes = readFileSync(new URL(filename, fontsDirectory));
      expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
      expect(bytes.readUInt32BE(8)).toBe(bytes.length);
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      expect(filename.endsWith(`-${hash}.woff2`)).toBe(true);
    }
  });

  it('preloads only the two small critical Latin faces with reusable anonymous font requests', () => {
    const preloads = [...html.matchAll(/<link\s+rel="preload"\s+href="(\/fonts\/[^\"]+)"[^>]+>/g)];
    expect(preloads.map((match) => match[1])).toEqual([
      '/fonts/cinzel-normal-latin-09941fb1c169.woff2',
      '/fonts/plus-jakarta-sans-normal-latin-153fc85b7029.woff2',
    ]);
    let bytes = 0;
    for (const [tag, url] of preloads) {
      expect(tag).toContain('as="font"');
      expect(tag).toContain('type="font/woff2"');
      expect(tag).toMatch(/\scrossorigin(?:\s|>)/);
      expect(css).toContain(`url(${url})`);
      bytes += readFileSync(new URL(url.slice('/fonts/'.length), fontsDirectory)).length;
    }
    expect(bytes).toBe(53_252);
    expect(bytes).toBeLessThan(60_000);
  });

  it('keeps the original type families and platform fallback stacks', () => {
    expect(css).toContain(`--font-serif: 'Newsreader', Georgia, Cambria, "Times New Roman", Times, serif;`);
    expect(css).toContain(`--font-display: 'Cinzel', 'Newsreader', Georgia, serif;`);
    expect(css).toContain(`--font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;`);
    expect(css).toContain(`--font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;`);
  });

  it('retains the redistribution license and each family copyright', () => {
    const license = readFileSync(new URL('OFL.txt', fontsDirectory), 'utf8');
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
    for (const name of ['Cinzel', 'JetBrains Mono', 'Newsreader', 'Plus Jakarta Sans']) {
      expect(license).toContain(`The ${name} Project Authors`);
    }
    expect(license).toContain('PERMISSION & CONDITIONS');
    expect(license).toContain('DISCLAIMER');
  });
});
