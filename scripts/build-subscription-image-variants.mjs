// Mechanical, loss-bounded delivery derivatives of four trusted public covers.
// Originals are never modified. Run from the repository root with Node.js.
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const names = ['the-first-chapter', 'the-long-read', 'the-deep-archive', 'the-full-witness'];
const widths = [320, 480, 640, 960];
const manifest = {};
for (const name of names) {
  const original = path.join(root, 'public', 'assets', 'subscriptions', `${name}.png`);
  const source = await readFile(original);
  const before = createHash('sha256').update(source).digest('hex');
  const variants = [];
  for (const width of widths) {
    const result = await sharp(source, { failOn: 'warning', limitInputPixels: 32_000_000, sequentialRead: true })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78, alphaQuality: 80, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const hash = createHash('sha256').update(result.data).digest('hex').slice(0, 12);
    const filename = `${name}.${result.info.width}.${hash}.webp`;
    const output = path.join(root, 'public', 'assets', 'subscriptions', filename);
    if (process.argv.includes('--check')) {
      const existing = await readFile(output);
      if (!existing.equals(result.data)) throw new Error(`Derivative differs: ${filename}`);
    } else {
      await writeFile(output, result.data, { flag: 'wx' }).catch(async error => {
        if (error.code !== 'EEXIST') throw error;
        if (!(await readFile(output)).equals(result.data)) throw new Error(`Refusing to replace existing derivative: ${filename}`);
      });
    }
    variants.push({ width: result.info.width, height: result.info.height, bytes: (await stat(output)).size, src: `/assets/subscriptions/${filename}` });
  }
  const after = createHash('sha256').update(await readFile(original)).digest('hex');
  if (before !== after) throw new Error(`Original changed: ${name}`);
  manifest[`/assets/subscriptions/${name}.png`] = { sourceBytes: source.length, sourceSha256: before, variants };
}
console.log(JSON.stringify(manifest, null, 2));
