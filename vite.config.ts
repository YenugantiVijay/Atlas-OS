import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { getPreviewIdentity, previewIdentityHeader } from './scripts/dev-server-identity.mjs';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), {
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
}));
