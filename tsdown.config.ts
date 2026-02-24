import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'main': 'source/main.ts',
    'panels/default/index': 'source/panels/default/index.ts',
    'panels/tool-manager/index': 'source/panels/tool-manager/index.ts',
    'scene': 'source/scene.ts',
  },
  outDir: 'dist',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  dts: false,
  sourcemap: false,
  external: ['cc'],
})
