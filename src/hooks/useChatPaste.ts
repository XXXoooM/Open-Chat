// EXPORTS: useChatPaste

import { useEffect, useRef, type ClipboardEvent, type RefObject } from 'react';
import { toast } from 'sonner';
import { readPastePayloadFromDataTransfer } from '@/lib/clipboard/paste';
import { playSound } from '@/lib/sound/map';

interface IUseChatPasteOptions {
  /** 聊天输入框：用于判断焦点是否在它内部（避免与它自己的 onPaste 重复处理） */
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  sending: boolean;
  /** 图片发送收口（含体积预检、压缩与错误提示，由调用方提供，保证与「选择文件」同一条路径） */
  onSendImage: (file: File) => void | Promise<unknown>;
  /** 文件发送收口 */
  onSendFile: (file: File) => void | Promise<unknown>;
  /** 把文本插入输入框（调用方决定插入位置与光标处理） */
  onInsertText: (text: string) => void;
}

/**
 * 聊天输入区的粘贴策略。
 *
 * 从 `ChatInputSection` 抽出来的原因：粘贴的判定规则（图片 / 文件 / 富文本 / 纯文本）
 * 与「焦点在哪」的取舍，是**独立于输入框外观的一套策略**，混在展示组件里会让两边都难改。
 * 抽成 hook 后，两条入口（输入框内粘贴、页面任意处粘贴图片）共用同一份逻辑，不再重复。
 *
 * ## 两条入口与它们的分工
 *
 * - **输入框内**（`onPaste`）：接管全部类型 —— 文本插入光标处，图片/文件走上传；
 * - **页面其它位置**：**只**接管图片（「刚截完图直接粘贴」的常见动作）。纯文本不在这里
 *   抢：用户看不到光标位置，插入到哪里都会显得莫名其妙。
 *
 * 三个守卫缺一不可：
 * 1. 焦点在输入框内 → 交给它自己的 `onPaste`（否则同一次粘贴会被处理两次、发两遍图）；
 * 2. 焦点在**任何**可编辑元素内 → 一律不接管（那是用户在别处正常粘贴，不能抢）；
 * 3. 只接管图片 → 见上。
 */
export function useChatPaste({
  inputRef,
  disabled,
  sending,
  onSendImage,
  onSendFile,
  onInsertText,
}: IUseChatPasteOptions) {
  /** 一次粘贴里只处理第一个文件，其余只提示不发送（误粘多张截图会刷出多条消息） */
  function notifyExtraFiles(count: number | undefined, label: string) {
    if (!count || count <= 0) return;
    toast.info(`一次只发送第 1 个${label}，其余 ${count} 个已忽略`);
  }

  async function dispatchPayload(
    payload: ReturnType<typeof readPastePayloadFromDataTransfer>,
  ): Promise<void> {
    if (payload.kind === 'image' && payload.imageFile) {
      notifyExtraFiles(payload.extraFiles, '图片');
      await onSendImage(payload.imageFile);
      return;
    }
    if (payload.kind === 'file' && payload.file) {
      notifyExtraFiles(payload.extraFiles, '文件');
      await onSendFile(payload.file);
      return;
    }
    onInsertText(payload.text);
    if (payload.note) toast.info(payload.note);
  }

  /**
   * 输入框内的粘贴。
   * 空粘贴**不拦截**：交回浏览器默认行为，避免打断原生粘贴（例如粘贴进输入法组合态）。
   */
  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const payload = readPastePayloadFromDataTransfer(event.clipboardData);
    if (payload.kind === 'empty') return;
    event.preventDefault();
    playSound('chat:paste');
    void dispatchPayload(payload);
  }

  /**
   * 页面任意处的粘贴（仅图片）。
   *
   * 监听器**只注册一次**，通过 ref 取最新一次渲染的闭包 —— 否则每次 `sending` 变化都要
   * 解绑重绑全局监听，既浪费也容易漏掉一次事件。
   */
  const handlerRef = useRef<(event: globalThis.ClipboardEvent) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target === inputRef.current) return;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      if (disabled || sending) return;

      const payload = readPastePayloadFromDataTransfer(event.clipboardData);
      if (payload.kind !== 'image' || !payload.imageFile) return;

      event.preventDefault();
      playSound('chat:paste');
      notifyExtraFiles(payload.extraFiles, '图片');
      void onSendImage(payload.imageFile);
    };
  });

  useEffect(() => {
    const listener = (event: globalThis.ClipboardEvent) => handlerRef.current(event);
    window.addEventListener('paste', listener);
    return () => window.removeEventListener('paste', listener);
  }, []);

  return { handlePaste };
}
