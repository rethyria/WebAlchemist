import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'

export default defineConfig({
  // Needed to compile the $state runes in the .svelte.ts modules under test.
  plugins: [svelte()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@background': resolve(__dirname, 'src/background'),
      '@content': resolve(__dirname, 'src/content'),
      '@safety': resolve(__dirname, 'src/safety'),
      '@sidebar': resolve(__dirname, 'src/sidebar'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
