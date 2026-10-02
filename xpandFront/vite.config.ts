import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 5173 is the origin already whitelisted in the backend's CORS_ORIGINS.
    port: 5173,
    strictPort: true,
    // `host: true` exposes the dev server on the LAN so a tunnel (ngrok/cloudflared) can
    // publish it to Telegram for on-device testing. See README → "Testing inside Telegram".
    host: true,
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app']
  },
  preview: {
    port: 4173,
  },
});
