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
      // The content script is injected programmatically; the editor page is
      // opened by URL rather than declared as a manifest surface. Neither is
      // reachable from the manifest, so both are named here.
      additionalInputs: ['src/content/index.ts', 'src/editor/index.html'],
      webExtConfig: {
        target: ['firefox-desktop'],
        // Firefox is a flatpak on this machine; scripts/firefox-flatpak stands
        // in for the binary and explains why. The profile lives inside the
        // project because the flatpak sandbox is only granted this directory.
        firefox: resolve(__dirname, 'scripts/firefox-flatpak'),
        firefoxProfile: resolve(__dirname, '.web-ext-profile'),
        profileCreateIfMissing: true,
        keepProfileChanges: true,
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
