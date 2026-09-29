// EXPORTS: AppShell

import type { ReactNode } from 'react';
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
 */
export function AppShell({ children }: IAppShellProps) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
