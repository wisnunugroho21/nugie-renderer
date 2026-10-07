import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // Main app + benchmark page + GPU self-test page (paths are relative to the project root).
    rollupOptions: { input: { main: 'index.html', bench: 'bench.html', selftest: 'selftest.html' } },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
