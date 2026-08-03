import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import webExtension from 'vite-plugin-web-extension'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@background': resolve(__dirname, 'src/background'),
      '@content': resolve(__dirname, 'src/content'),
      '@safety': resolve(__dirname, 'src/safety'),
      '@sidebar': resolve(__dirname, 'src/sidebar'),
    },
  },
  plugins: [
    svelte(),
    webExtension({
      manifest: 'src/manifest.json',
      browser: 'firefox',
      // The content script is injected programmatically under activeTab rather
      // than declared in the manifest, so it is listed as an extra input.
      additionalInputs: ['src/content/index.ts'],
      webExtConfig: {
        target: ['firefox-desktop'],
        startUrl: ['https://news.ycombinator.com'],
      },
    }),
  ],
  build: {
    // Extension review requires readable sources; keep output unminified.
    minify: false,
    sourcemap: true,
    target: 'firefox115',
  },
})
