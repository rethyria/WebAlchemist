/**
 * The two beautifier files of js-beautify are imported by path, so that the
 * HTML beautifier and the command-line code in the package's main file are not
 * bundled. The package ships no type declarations.
 */
declare module 'js-beautify/js/lib/beautify.js' {
  const beautify: { js_beautify: (source: string, options?: Record<string, unknown>) => string }
  export default beautify
}

declare module 'js-beautify/js/lib/beautify-css.js' {
  const beautify: { css_beautify: (source: string, options?: Record<string, unknown>) => string }
  export default beautify
}
