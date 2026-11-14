import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `npm run dev` (Vite HMR) forwards API calls to the Python backend started with `npm start`.
  server: {
    proxy: { '/api': 'http://127.0.0.1:8089' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
