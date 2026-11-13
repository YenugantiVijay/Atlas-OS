import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const websiteDirectory = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
export const previewVersionHeader = 'x-atlas-dev-preview';

export function getPreviewVersion() {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: websiteDirectory, encoding: 'utf8', windowsHide: true });
  return createHash('sha256').update(websiteDirectory).update('\0')
    .update(git.status === 0 ? git.stdout.trim() : '').digest('hex');
}
