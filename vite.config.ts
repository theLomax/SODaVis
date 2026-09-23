import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'node',
    // `test/private` is the SODaVis-Tests submodule: the suites that assert the real
    // export's figures. Included when checked out, absent otherwise — so a clone
    // without access to it runs the public suites and reports nothing missing.
    include: ['src/**/*.test.ts', 'test/private/**/*.test.ts'],
  },
})
