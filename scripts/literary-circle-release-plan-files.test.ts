import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AFFILIATE_BACKUP_DATASETS } from './literary-circle-migration-lib.js';
import { assertOfflineBackupPath, readBoundedReleaseEvidence, releaseArtifactPath } from './literary-circle-release-plan-files.js';

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'iw-release-plan-test-'));
  fs.mkdirSync(path.join(cwd, 'data/backups/example'), { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  // Only this newly-created, exact test directory is removed.
  if (path.basename(cwd).startsWith('iw-release-plan-test-') && path.dirname(cwd) === os.tmpdir()) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('local-only release artifact boundary', () => {
  it.each([
    String.raw`\\server\share\manifest.json`, '//server/share/manifest.json',
    String.raw`\\?\C:\private\manifest.json`, String.raw`\\.\pipe\private`, String.raw`\??\C:\private`,
    'file:///C:/private/manifest.json', 'https://example.test/evidence.json', 'C:relative-path',
    '../outside/manifest.json', 'data/backups/../../outside/manifest.json', 'data/backups-other/manifest.json',
  ])('rejects network/device/URI/escaping paths before filesystem I/O: %s', value => {
    const stat = vi.spyOn(fs, 'lstatSync');
    expect(() => assertOfflineBackupPath(value, cwd)).toThrow();
    expect(stat).not.toHaveBeenCalled();
  });

  it('accepts only the explicit local backup manifest and verifies every dataset has no links', () => {
    const folder = path.join(cwd, 'data/backups/example');
    fs.writeFileSync(path.join(folder, 'manifest.json'), '{}');
    for (const definition of AFFILIATE_BACKUP_DATASETS) fs.writeFileSync(path.join(folder, definition.fileName), '{}');
    expect(assertOfflineBackupPath('data/backups/example/manifest.json', cwd)).toBe(path.join(folder, 'manifest.json'));
    expect(() => assertOfflineBackupPath('data/backups/example', cwd)).toThrow(/manifest.json/);
  });

  it('rejects symbolic links/junctions before opening the evidence', () => {
    const file = path.join(cwd, 'data/evidence.json');
    fs.writeFileSync(file, '{}');
    const original = fs.lstatSync;
    vi.spyOn(fs, 'lstatSync').mockImplementation(((candidate: fs.PathLike) => path.resolve(String(candidate)) === file
      ? { isSymbolicLink: () => true } : original(candidate)) as typeof fs.lstatSync);
    const open = vi.spyOn(fs, 'openSync');
    expect(() => readBoundedReleaseEvidence(file, cwd)).toThrow(/links|junctions/);
    expect(open).not.toHaveBeenCalled();
  });

  it('allows local data evidence but rejects the data directory itself', () => {
    expect(releaseArtifactPath('data/review.json', 'data', cwd)).toBe(path.join(cwd, 'data/review.json'));
    expect(() => releaseArtifactPath('data', 'data', cwd)).toThrow();
  });
});

describe('bounded descriptor evidence reading', () => {
  it('reads ordinary JSON from a local regular file and closes its descriptor', () => {
    const file = path.join(cwd, 'data/evidence.json'); fs.writeFileSync(file, '{"schemaVersion":1}');
    const close = vi.spyOn(fs, 'closeSync');
    expect(readBoundedReleaseEvidence(file, cwd)).toEqual({ schemaVersion: 1 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('refuses oversized evidence before allocating unbounded data', () => {
    const file = path.join(cwd, 'data/evidence.json'); fs.writeFileSync(file, Buffer.alloc(65_537, 32));
    expect(() => readBoundedReleaseEvidence(file, cwd)).toThrow(/bounded/);
  });

  it('also refuses data that grows beyond the size reported by descriptor preflight', () => {
    const file = path.join(cwd, 'data/evidence.json'); fs.writeFileSync(file, Buffer.alloc(65_537, 32));
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ size: 1, isFile: () => true } as fs.Stats);
    const read = vi.spyOn(fs, 'readSync'); const close = vi.spyOn(fs, 'closeSync');
    expect(() => readBoundedReleaseEvidence(file, cwd)).toThrow(/fixed size limit/);
    expect(read.mock.calls.every(call => Number(call[3]) <= 65_537)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the descriptor when JSON parsing fails', () => {
    const file = path.join(cwd, 'data/evidence.json'); fs.writeFileSync(file, 'not JSON');
    const close = vi.spyOn(fs, 'closeSync');
    expect(() => readBoundedReleaseEvidence(file, cwd)).toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
