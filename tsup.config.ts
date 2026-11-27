import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  platform: 'node',
  target: 'node22',
  // tslog 5 ships only ESM; bundling it gives CommonJS consumers (and Jest's module loader) a plain require().
  noExternal: ['tslog'],
  splitting: false,
  sourcemap: false,
});
