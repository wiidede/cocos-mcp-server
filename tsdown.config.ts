import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'main': 'source/main.ts',
    'panels/default/index': 'source/panels/default/index.ts',
    'panels/tool-manager/index': 'source/panels/tool-manager/index.ts',
    'panels/dev-test/index': 'source/panels/dev-test/index.ts',
    'scene': 'source/scene.ts',
  },
  outDir: 'dist',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  minify: true,
  dts: false,
  sourcemap: false,
  deps: {
    alwaysBundle: ['vue'],
    neverBundle: ['cc'],
  },
})
