import path from 'path'
import { defineConfig } from '@lark-apaas/coding-preset-vite-react'

// 与 scripts/dev.mjs 的默认值保持一致
const RELAY_DEV_PORT = process.env.RELAY_DEV_PORT || '8787'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      // 本地把 /relay 代理到 wrangler dev：同源可避免跨域，也不需要本地证书。
      // 生产环境不使用该代理，VITE_RELAY_URL 直接指向 wss://<worker>。
      '/relay': {
        target: `ws://127.0.0.1:${RELAY_DEV_PORT}`,
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/relay/, ''),
      },
    },
  },
})
