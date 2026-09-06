import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // The desktop build sets VITE_HASH_PATCH_BASE_URL=./ so the production bundle
  // is loadable from a file:// origin inside the Electron window (absolute
  // /assets/... paths only work when served over HTTP). Dev keeps the default.
  base: process.env.VITE_HASH_PATCH_BASE_URL || '/',
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
