// EXPORTS: usePrivacyBlur

import { useEffect, useState } from 'react';

/**
 * 窗口级失焦检测：窗口失去焦点、切换标签页、应用进入后台时返回 true。
 *
 * 刻意监听**窗口级**事件而非元素级 blur：
 * 元素级 blur 在输入框之间切换（例如昵称框 → 密码框）时同样会触发，
 * 会把欢迎页整块内容糊掉，属于典型的误触发。
 *
 * 边界（须如实理解，代码与文案都不承诺更多）：
 * 这是防「肩窥」的视觉遮挡，不是 DRM —— 页面内容仍在内存与 DOM 中，
 * 也无法阻止截屏或拍屏。
 */
export function usePrivacyBlur(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }

    const hide = () => setHidden(true);
    const show = () => setHidden(false);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') hide();
      else show();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    // 移动端切到后台时 blur 不一定会触发，用 pagehide 兜底；
    // pagehide 之后页面通常被冻结，恢复由 focus / visibilitychange 承担。
    window.addEventListener('pagehide', hide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
      window.removeEventListener('pagehide', hide);
    };
  }, [enabled]);

  return enabled && hidden;
}
