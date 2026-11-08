import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // 原生模块不能被打进 bundle,运行时从 node_modules 加载。
      external: ['better-sqlite3'],
    },
  },
});
