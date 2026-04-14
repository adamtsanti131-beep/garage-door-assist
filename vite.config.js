import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    // Forward /analyze requests to the Express backend during development
    proxy: {
      '/analyze': 'http://localhost:3001',
    },
  },
});
