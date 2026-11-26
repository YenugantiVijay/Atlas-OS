import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isIndustryToolId } from './src/lib/industry-tools';
import { getPreviewIdentity, previewIdentityHeader } from './scripts/dev-server-identity.mjs';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const toolId = mode.startsWith('tool-') ? mode.slice('tool-'.length) : null;
  if (toolId !== null && !isIndustryToolId(toolId)) throw new Error('Unknown Atlas OS industry tool: ' + toolId);
  return {
    define: { __ATLAS_INDUSTRY_TOOL__: JSON.stringify(toolId) },
    plugins: [react(), {
      name: 'atlas-public-pwa-version',
      generateBundle() {
        const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
        // Change the worker on every release build so browsers detect code updates.
        // Offline cache names are public-only; no application responses are stored.
        const source = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
        const fingerprint = createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 12);
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: source.replace('atlas-public-pwa-v1', 'atlas-public-pwa-' + version + '-' + fingerprint) });
      },
    }, {
      name: 'atlas-erp-preview-identity',
      configureServer(server) {
        const identity = getPreviewIdentity(mode);
        server.middlewares.use((_request, response, next) => {
          response.setHeader(previewIdentityHeader, identity);
          next();
        });
      },
    }],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, mode === 'owner' ? 'owner/index.html' : 'index.html'),
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-ui': ['lucide-react', 'clsx', 'tailwind-merge'],
            'vendor-excel': ['exceljs'],
          },
        },
      },
    },
    server: {
      port: 5173,
      // Restrict the development server to this computer. Vite 6.4.5 has a
      // network-exposed dev-server RCE advisory (GHSA-p4f5-76q4-ffq7).
      // Never use --host or 0.0.0.0 until the patched toolchain is verified.
      host: '127.0.0.1',
      strictPort: true,
    },
  };
});
