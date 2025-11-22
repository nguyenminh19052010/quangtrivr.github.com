import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Make process.env available in client-side code
    // This is necessary for the @google/genai SDK's Live API feature.
    'process.env': process.env
  }
})
