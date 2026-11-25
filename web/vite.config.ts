import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 一份构建同时作为前台（user-dist，挂在 /）和后台（admin-dist，挂在 /dashboard）。
// 资源用绝对路径 /assets/...，两个目录内容相同，因此无论从哪边请求都能命中。
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8008', ws: true, changeOrigin: false },
      '/probe': { target: 'http://127.0.0.1:8008' },
    },
  },
})
