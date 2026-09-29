// EXPORTS: AppShell

import { useEffect, type ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { SoundProvider } from '@/lib/sound/SoundProvider';
import { Toaster } from '@/components/ui/sonner';

interface IAppShellProps {
  children: ReactNode;
}

/**
 * 应用根壳：承载全局 UI 容器。
 *
 * **修复 `AUDIT.md` D-1**：项目此前从未挂载 `<Toaster />`，使 `useMqttChat.ts`、
 * `ChatInputSection.tsx` 等处的 8 次 `toast.*` 调用全部静默失效 —— 用户看不到
 * 「XX 加入了聊天室」「发送失败」这类反馈。此前该容器被误以为由平台 `AppContainer`
 * 提供，但实测其实现中**并不包含** Toaster，因此这里显式挂载，不再依赖外部容器。
 *
 * 平台 `AppContainer` 另有几项职责，均与本站无关，已随依赖一并移除：
 * 品牌水印、平台埋点上报（含首屏上报）、开发期的平台探针与 iframe 桥，
 * 以及为平台组件准备的 react-query Provider（本项目未使用 react-query）。
 *
 * ── 主题（SpaceUI 引入首批） ───────────────────────────────────────────────
 * 本站此前**完全没有主题运行时**：`next-themes` 虽在依赖里，却没有 `ThemeProvider`，
 * 也没有任何代码往 `<html>` 写 `.dark`，且既有的 `.dark` 只重映射了调色板色阶
 * （见 `src/styles/vendor/tailwind-theme.css`），未覆盖语义 token。因此这里补上三件事：
 *   1. `ThemeProvider attribute="class"` —— 与 `src/styles/spaceui/tokens.css` 中的
 *      `@custom-variant dark (&:is(.dark, .dark *))` 严格对应（类驱动，而非媒体查询）；
 *   2. `defaultTheme="light"` —— 本站此前无暗色，默认保持亮色，避免老用户刷新后被
 *      静默切到暗色；用户可手动切到暗色或跟随系统，选择由 next-themes 持久化；
 *   3. `theme-ready` —— 首帧就绪后写入 `<html>`，配合 tokens.css 的
 *      `html:not(.theme-ready) * { transition: none !important }` 规则，避免刷新与切换
 *      时出现大面积过渡动画闪烁（该做法取自上游 `src/app/globals.css`）。
 */
export function AppShell({ children }: IAppShellProps) {
  useEffect(() => {
    document.documentElement.classList.add('theme-ready');
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="open-chat-theme">
      <SoundProvider>
        {children}
        <Toaster />
      </SoundProvider>
    </ThemeProvider>
  );
}
