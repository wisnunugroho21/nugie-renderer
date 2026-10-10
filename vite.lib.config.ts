import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Every runtime module is an entry so tree shaking cannot remove its deep-import exports. */
function libraryEntries(directory = resolve('src')): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['demo', 'game', 'bench', 'selftest'].includes(entry.name)) Object.assign(entries, libraryEntries(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && entry.name !== 'main.ts' && !entry.name.endsWith('.worker.ts')) {
      entries[relative(resolve('src'), path).replaceAll('\\', '/').slice(0, -3)] = path;
    }
  }
  return entries;
}

/**
 * Library build (`npm run build:lib`): ES modules, one output file per source module (so consumers can tree-shake and deep-import),
 * WGSL shaders inlined as strings, the geometry worker emitted as an asset. Type declarations come from tsconfig.build.json.
 */
export default defineConfig({
  base: './',   // asset URLs (the geometry worker) must be relative to the module, not absolute from the site root
  build: {
    lib: { entry: libraryEntries(), formats: ['es'] },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' },
    },
  },
});
