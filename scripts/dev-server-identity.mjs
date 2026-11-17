import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const previewIdentityHeader = 'x-atlas-erp-preview';

export function getPreviewIdentity(mode) {
  const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  return createHash('sha256').update(root).update('\0').update(mode).update('\0')
    .update(git.status === 0 ? git.stdout.trim() : '').digest('hex');
}
