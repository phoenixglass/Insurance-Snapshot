import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Use relative asset URLs so both a Netlify root domain and the GitHub Pages
  // /Insurance-Snapshot/ subpath can load the same build.
  base: './',
  plugins: [react()],
})
