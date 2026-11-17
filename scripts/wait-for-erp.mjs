import { getPreviewIdentity, previewIdentityHeader } from './dev-server-identity.mjs';

const mode = process.argv[2] ?? 'development';
const probeOnly = process.argv.includes('--probe');
const identity = getPreviewIdentity(mode);
const url = 'http://127.0.0.1:5173';
const pages = [
  { path: '/', marker: '/src/main.tsx' },
  { path: '/owner/', marker: '/src/features/admin/owner-entry.tsx' },
];

async function checkPage({ path, marker }) {
  try {
    const response = await fetch(url + path, {
      signal: AbortSignal.timeout(1500),
      redirect: 'manual',
    });
    if (response.headers.get(previewIdentityHeader) !== identity) {
      await response.body?.cancel();
      return 'occupied';
    }
    return response.ok && (await response.text()).includes(marker) ? 'ready' : 'waiting';
  } catch {
    return 'waiting';
  }
}

const attempts = probeOnly ? 1 : 40;
for (let attempt = 0; attempt < attempts; attempt += 1) {
  const statuses = await Promise.all(pages.map(checkPage));
  if (statuses.includes('occupied')) {
    console.error('[ERROR] Port 5173 is serving a different checkout, mode, or application.');
    console.error('Close the terminal using that port and open the launcher again.');
    process.exit(2);
  }
  if (statuses.every(status => status === 'ready')) process.exit(0);
  if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 400));
}

if (!probeOnly) console.error('[ERROR] The ERP server did not become ready. Check its terminal for a startup error.');
process.exit(1);
