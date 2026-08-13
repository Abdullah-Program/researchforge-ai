import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.VITE_API_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/query':     { target: apiTarget, changeOrigin: true },
      '/papers':    { target: apiTarget, changeOrigin: true },
      '/health':    { target: apiTarget, changeOrigin: true },
      '/ingest':    { target: apiTarget, changeOrigin: true },
      '/sessions':  { target: apiTarget, changeOrigin: true },
      '/analytics': { target: apiTarget, changeOrigin: true },
      '/search':    { target: apiTarget, changeOrigin: true },
    },
  },
})