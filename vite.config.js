import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    // Forward API requests to the Express backend during development
    proxy: {
      '/analyze': 'http://localhost:3001',
      '/health':  'http://localhost:3001',
      '/monday':  'http://localhost:3001',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
