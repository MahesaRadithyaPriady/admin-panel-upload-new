import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // izinkan semua host
    port: 5173,
    allowedHosts: ['localhost', 'upload.nanimeid.xyz'], // whitelist host dev
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: ['upload.nanimeid.xyz'], // whitelist host preview
  },
})
