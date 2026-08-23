import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/host/index.ts'],
    outDir: 'lib',
    format: 'esm',
    dts: true,
    sourcemap: true,
    external: [/^@deepseek-ai\//, /^react($|\/)/],
  },
  {
    entry: ['src/client/index.tsx'],
    outDir: 'lib',
    format: 'cjs',
    dts: false,
    sourcemap: true,
    external: [/^@deepseek-ai\//, /^react($|\/)/],
  },
]);
