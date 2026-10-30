import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The build (web/dist) is uploaded into the mim's storage by mim/scripts/deploy.sh and served by the mim.
// Text files only (fonts and images inlined as data URIs) and a flat folder (assetsDir ''), because the mim keeps one
// storage item per file. Relative base, because the page lives under the mim's base path (/api/team-hours-report/v1/).
// Two pages: index.html (the CopilotKit report builder) and team-time.html (the Team Time report, no CopilotKit).
// In dev, /api is proxied to the local mimOE node so the page talks to the deployed mim's /agui endpoint.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist', assetsDir: '', emptyOutDir: true, assetsInlineLimit: () => true,
    rollupOptions: { input: { main: 'index.html', teamTime: 'team-time.html' } },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.MIMOE_URL ?? 'http://localhost:8083', changeOrigin: true } },
  },
});
