import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/** 打包为单个文件：服务器上只需要 Node.js 24+，不需要安装依赖 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    target: 'node24',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      // ws 的可选原生加速模块：缺失时自动使用纯 JS 实现
      external: ['bufferutil', 'utf-8-validate'],
      output: { format: 'es', entryFileNames: 'server.mjs', inlineDynamicImports: true },
    },
  },
});
