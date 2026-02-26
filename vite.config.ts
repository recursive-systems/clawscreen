import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 18842,
    host: '0.0.0.0',
    proxy: {
      '/a2ui': {
        target: 'http://127.0.0.1:18841',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist/client'
  }
});
