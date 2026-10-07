import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // Demo launcher + starter game + benchmark page + GPU self-test page (paths are relative to the project root).
    rollupOptions: { input: { main: 'index.html', game: 'game.html', bench: 'bench.html', selftest: 'selftest.html' } },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
