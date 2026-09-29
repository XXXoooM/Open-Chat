// EXPORTS: ErrorFallback

import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface IErrorFallbackProps {
  error: unknown;
  resetErrorBoundary?: (...args: unknown[]) => void;
}

/** 把任意抛出物转成可展示文案（Error / 字符串 / 其它对象） */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return '未知错误';
  }
}

/**
 * 根级错误回退界面 —— 替代平台 toolkit 的 `ErrorRender`。
 *
 * 与原实现的两点差异：
 * 1. 不再向平台外壳发送 `RenderError` 消息（平台依赖已整体移除），只在本机提供恢复入口。
 * 2. 恢复动作是**整页 reload**，而不是仅调用 `resetErrorBoundary`：
 *    开发期 Vite 的 React Refresh 在 ErrorBoundary 状态下 family map 找不到对应 fiber，
 *    仅重置会让 children 重新挂载时仍拿到旧模块引用，形成反复抛错的死循环；
 *    整页 reload 才能让模块图完整重载（这也是 Vite 对 ErrorBoundary 场景的推荐做法）。
 */
export function ErrorFallback({ error }: IErrorFallbackProps) {
  const message = describeError(error);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <TriangleAlertIcon className="size-10 text-destructive" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-foreground">页面出错了</h1>
      <p className="max-w-md text-sm break-words text-muted-foreground">{message}</p>
      <Button onClick={() => window.location.reload()}>
        <RotateCwIcon className="size-4" aria-hidden="true" />
        重新加载页面
      </Button>
    </div>
  );
}
