import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('source-only TypeScript project boundaries', () => {
  it('retains application, server, scripts, tests and src/data while excluding root build/private artifacts', () => {
    const root = process.cwd();
    const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    expect(parsed.errors).toEqual([]);
    const files = new Set(parsed.fileNames.map(file => path.resolve(file)));
    for (const file of ['server.ts', 'src/data/affiliateTerms.ts', 'src/server/affiliateStore.ts',
      'scripts/plan-literary-circle-release.ts', 'server.affiliate-session-security.test.ts']) {
      expect(files.has(path.join(root, file))).toBe(true);
    }
    for (const folder of ['dist', 'build', 'coverage', 'data', 'uploads', '.vercel', 'node_modules']) {
      expect([...files].some(file => file.startsWith(`${path.join(root, folder)}${path.sep}`))).toBe(false);
    }
  });
});
