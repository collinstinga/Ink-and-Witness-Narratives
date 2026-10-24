import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('controlled Literary Circle preview release', () => {
  it('does not auto-deploy the staging branch before scoped credentials are ready or disable production deployments', () => {
    const config = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
    expect(config.git.deploymentEnabled).toEqual({ 'feature/literary-circle-upgrade': false });
    expect(config.git.deploymentEnabled.main).toBeUndefined();
  });

  it('explicitly excludes preservation files and local secrets from uploaded deployment sources', () => {
    const ignored = fs.readFileSync(new URL('./.vercelignore', import.meta.url), 'utf8').split(/\r?\n/);
    for (const entry of ['.git/', 'node_modules/', 'data/', 'uploads/', '.env*', '*.log']) expect(ignored).toContain(entry);
  });
});
