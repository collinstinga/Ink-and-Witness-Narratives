import fs from 'fs';
import path from 'path';
import { AFFILIATE_BACKUP_DATASETS } from './literary-circle-migration-lib.js';
import { LiteraryCircleReleasePlanError } from './literary-circle-release-plan-lib.js';

/** Constrain artifacts to this local workspace before exists/stat/read calls.
 * UNC, device paths and URI schemes must never be resolved by an offline CLI. */
export function releaseArtifactPath(value: string, rootDirectory: 'data' | 'data/backups', cwd = process.cwd()): string {
  if (!value || /[\u0000-\u001f\u007f]/.test(value) || /^(?:\\\\|\/\/|\\\?\?\\|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(value)
    || (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value))) {
    throw new LiteraryCircleReleasePlanError('Offline release artifacts must be local workspace paths, not network/device paths or URIs.');
  }
  const root = path.resolve(cwd, rootDirectory);
  const candidate = path.resolve(cwd, value);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new LiteraryCircleReleasePlanError('Release artifacts must remain inside the designated local data directory.');
  }
  return candidate;
}

function assertNoArtifactLinks(candidate: string, cwd: string): void {
  const relative = path.relative(cwd, candidate);
  let current = cwd;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new LiteraryCircleReleasePlanError('Release artifacts cannot use symbolic links or junctions.');
    }
  }
}

export function assertOfflineBackupPath(value: string, cwd = process.cwd()): string {
  const candidate = releaseArtifactPath(value, 'data/backups', cwd);
  if (path.basename(candidate) !== 'manifest.json') throw new LiteraryCircleReleasePlanError('An explicit local backup manifest.json path is required.');
  assertNoArtifactLinks(candidate, cwd);
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    assertNoArtifactLinks(path.join(path.dirname(candidate), definition.fileName), cwd);
  }
  return candidate;
}

export function readBoundedReleaseEvidence(value: string, cwd = process.cwd()): unknown {
  const candidate = releaseArtifactPath(value, 'data', cwd);
  assertNoArtifactLinks(candidate, cwd);
  const descriptor = fs.openSync(candidate, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 65_536) throw new LiteraryCircleReleasePlanError('Staging evidence must be a bounded regular JSON file.');
    // Read at most max+1 bytes from this descriptor. A concurrent growth or
    // replacement cannot turn the size preflight into an unbounded read.
    const bytes = Buffer.alloc(65_537);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length > 65_536) throw new LiteraryCircleReleasePlanError('Staging evidence exceeds the fixed size limit.');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { fs.closeSync(descriptor); }
}
