import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The app never talks to a network: every byte of officiating data stays in this
 * browser. The policy makes that a property the browser enforces rather than a
 * promise — `connect-src 'none'` stops any fetch, XHR or beacon from leaving.
 *
 * Build only: the dev server injects inline scripts for hot reload, which a strict
 * `script-src` would block.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'sodavis-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  }
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: './',
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'node',
    // `test/private` is the SODaVis-Tests submodule: the suites that assert the real
    // export's figures. Included when checked out, absent otherwise — so a clone
    // without access to it runs the public suites and reports nothing missing.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'test/private/**/*.test.ts'],
  },
})
