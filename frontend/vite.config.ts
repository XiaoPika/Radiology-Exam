import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  envPrefix: ['VITE_'],
  plugins: [
    react(),
    // Exclude WASM codec packages from CJS->ESM transform.
    viteCommonjs({
      exclude: [
        '**/node_modules/@cornerstonejs/codec-charls/**',
        '**/node_modules/@cornerstonejs/codec-openjpeg/**',
        '**/node_modules/@cornerstonejs/codec-openjph/**',
        '**/node_modules/@cornerstonejs/codec-libjpeg-turbo-8bit/**',
      ],
    }),
    wasm(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: [
      '@cornerstonejs/dicom-image-loader',
      '@icr/polyseg-wasm',
    ],
    include: ['dicom-parser', 'comlink'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'es2020',
  },
});
