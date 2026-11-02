import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'

export default defineConfig({
  // Needed to compile the $state runes in the .svelte.ts modules under test.
  // The client build of Svelte is used for the .svelte.ts modules and their
  // tests, so that effects and deriveds react as they do in the sidebar. The
  // components keep the server build, which the render tests rely on.
  plugins: [
    svelte({
      dynamicCompileOptions: ({ filename }) =>
        /\.svelte(\.test)?\.ts$/.test(filename) ? { generate: 'client' } : undefined,
    }),
  ],
  resolve: {
    conditions: ['browser'],
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
