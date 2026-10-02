import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Configuration de test dédiée (séparée de vite.config.js pour ne pas alourdir le build).
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,jsx}', 'src/**/__tests__/**/*.{test,spec}.{js,jsx}'],
    css: false,
  },
})
