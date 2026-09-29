import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

/**
 * Vite 配置（自持）—— 替代平台预设 `@lark-apaas/coding-preset-vite-react`。
 *
 * 平台预设除了 React 与 Tailwind 之外，还挂载了若干平台注入插件
 * （view-context 注入 `{{appId}}` 等 HBS 占位符外壳、slardar 埋点、og-meta、
 * 开发期平台探针等）。本站自托管，这些插件既不需要也会造成白屏与平台痕迹，
 * 因此这里只保留真正需要的两项能力：React 与 Tailwind v4。
 *
 * 原预设额外提供、但本站未使用的开发期能力（错误浮层、HMR 计时、ws 看门狗、
 * 平台能力包打包等）不再配置；Vite 原生已自带 HMR 与错误浮层。
 */

// 与 scripts/dev.mjs 的默认值保持一致
const RELAY_DEV_PORT = process.env.RELAY_DEV_PORT || '8787'

// 用 import.meta.url 推导目录：package.json 为 ESM（"type": "module"），
// 因此不可使用 CJS 的 __dirname。
const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const sharedDir = fileURLToPath(new URL('./shared', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': srcDir,
      '@shared': sharedDir,
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
