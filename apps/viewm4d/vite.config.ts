import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true, // Listen on all interfaces for LAN access
    proxy: {
      // Proxy API requests to the backend - avoids CORS entirely
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});


