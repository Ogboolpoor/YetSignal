import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = process.env.YS_SERVER ?? 'http://localhost:8787';

// In dev, proxy the API and WebSocket to the sensing server so the UI can use
// same-origin relative paths (/api, /ws) in both dev and the production build.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
