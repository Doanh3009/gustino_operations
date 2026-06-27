import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5177',
      '/uploads': 'http://127.0.0.1:5177',
    },
  },
  preview: {
    host: true,
    port: 5175,
    proxy: {
      '/api': 'http://127.0.0.1:5177',
      '/uploads': 'http://127.0.0.1:5177',
    },
  },
  build: { target: 'es2018' },
})
