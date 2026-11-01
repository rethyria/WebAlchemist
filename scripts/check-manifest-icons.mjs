// Fails when an icon path declared in a manifest is missing from a directory.
// Usage: node scripts/check-manifest-icons.mjs [dist-directory]
// The manifest read is <directory>/manifest.json, so run it after a build.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Collects every string under the icon-bearing keys of a manifest. */
export function iconPaths(manifest) {
  const paths = []
  const collect = (value) => {
    if (typeof value === 'string') paths.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        // "size" in a theme_icons entry is a number, so only strings are kept.
        if (key !== 'size') collect(inner)
      }
    }
  }
  collect(manifest.icons)
  for (const surface of ['action', 'browser_action', 'page_action', 'sidebar_action']) {
    const section = manifest[surface]
    if (!section) continue
    collect(section.default_icon)
    collect(section.theme_icons)
  }
  return [...new Set(paths)]
}

/** Returns the declared icon paths that do not exist under `directory`. */
export function missingIcons(manifest, directory) {
  return iconPaths(manifest).filter((path) => !existsSync(resolve(directory, path)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? 'dist')
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'))
  const missing = missingIcons(manifest, directory)
  if (missing.length > 0) {
    console.error(`Icon files declared in the manifest but missing from ${directory}:`)
    for (const path of missing) console.error(`  ${path}`)
    process.exit(1)
  }
  console.log(`All ${iconPaths(manifest).length} manifest icon paths exist in ${directory}.`)
}
