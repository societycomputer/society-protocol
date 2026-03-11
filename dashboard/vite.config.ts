import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: '.',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 4201,
    proxy: {
      '/ws': {
        target: 'ws://localhost:4200',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
  },
});
