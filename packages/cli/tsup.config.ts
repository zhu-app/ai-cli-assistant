import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts', 'src/config-store.ts'],
  format: ['cjs'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  external: [
    '@anthropic-ai/sdk',
    'openai',
    'glob',
    'ws',
    'commander',
    'chalk',
    'inquirer',
    'ora',
  ],
  noExternal: [
    '@ai-cli/shared',
    '@ai-cli/server',
    '@ai-cli/tools',
  ],
});
