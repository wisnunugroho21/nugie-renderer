import { defineConfig } from 'vite';

/**
 * Library build (`npm run build:lib`): ES modules, one output file per source module (so consumers can tree-shake and deep-import),
 * WGSL shaders inlined as strings, the geometry worker emitted as an asset. Type declarations come from tsconfig.build.json.
 */
export default defineConfig({
  base: './',   // asset URLs (the geometry worker) must be relative to the module, not absolute from the site root
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'] },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' },
    },
  },
});
