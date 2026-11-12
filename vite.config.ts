import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
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
});
