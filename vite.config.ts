import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 18842,
    host: '0.0.0.0',
    proxy: {
      '/a2ui': {
        target: 'http://127.0.0.1:18841',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const ct = proxyRes.headers['content-type'] || '';
            if (ct.includes('text/event-stream')) {
              // Disable buffering for SSE
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist/client'
  }
});
