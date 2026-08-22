import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // Vite's default `localhost` resolves to [::1] only on this platform, and a
    // reverse proxy in front of it (tailscale serve) dials 127.0.0.1 — so bind
    // the v4 loopback explicitly or the proxy gets connection refused.
    host: '127.0.0.1',
    port: 5273,
    // Reached through `tailscale serve`, the Host header is the MagicDNS name,
    // which Vite's DNS-rebinding guard rejects with a 403. A leading dot allows
    // the domain and its subdomains, so this covers any tailnet, not just ours.
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:8173', changeOrigin: true },
    },
  },
});
