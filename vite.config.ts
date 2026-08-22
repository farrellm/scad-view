import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8173', changeOrigin: true },
    },
  },
});
