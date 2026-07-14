import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // public/ in this project is the legacy vanilla-JS backup, not a Vite static
  // asset folder — don't let Vite copy it into dist/.
  publicDir: false,
  server: {
    proxy: {
      '/api': 'http://localhost:5177',
    },
  },
});
