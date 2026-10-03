import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      // 业务依赖全部打包进产物，安装包内不携带 node_modules，也没有原生模块需要按平台重编译
      externalizeDeps: false,
      // ws 的可选原生加速模块：缺失时自动使用纯 JS 实现
      rollupOptions: { external: ['bufferutil', 'utf-8-validate'] },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        // 沙箱模式下 preload 只能是 CommonJS
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: {
      alias: { '@renderer': resolve(import.meta.dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
});
