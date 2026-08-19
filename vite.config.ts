import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendProxy = {
  '/api': 'http://127.0.0.1:8081',
  '/files': 'http://127.0.0.1:8081',
};

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) {
            return 'react-vendor';
          }
          if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf-renderer';
          if (id.includes('/node_modules/pdf-lib/')) return 'pdf-export';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: backendProxy,
  },
  preview: {
    proxy: backendProxy,
  },
});
