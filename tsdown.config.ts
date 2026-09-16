import { defineConfig } from 'tsdown';

// Loader registration id — the host boot graph derives each client row's id
// from package.json "name" (zDSH-main packages/client/modules: graphRow rows
// keyed by the located manifest name), and the module system throws if the
// executed bundle registers under any other id. Keep this string exactly in
// sync with package.json "name" when the package identity ever changes.
const loaderBanner =
  'window.__ModuleLoader__.load({\n' +
  '  id: "dsh-plugin-center",\n' +
  '  factory: (require) => {\n' +
  '    var module = { exports: {} };\n' +
  '    var exports = module.exports;\n';
const loaderFooter = '\n    return module.exports;\n  }\n});';

export default defineConfig([
  {
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib',
    format: 'esm',
    dts: true,
    sourcemap: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    external: [/^@deepseek-ai\//, /^react($|\/)/],
  },
  {
    entry: { 'guardian-entry': 'src/host/guardian-entry.ts' },
    outDir: 'lib',
    format: 'esm',
    dts: false,
    sourcemap: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    dts: false,
    sourcemap: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    external: [/^@deepseek-ai\//, /^react($|\/)/],
    banner: { js: loaderBanner },
    footer: { js: loaderFooter },
  },
]);
