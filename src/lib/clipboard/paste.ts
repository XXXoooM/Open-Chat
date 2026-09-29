// EXPORTS: PasteKind, IPastePayload, IRawClipboard, PASTE_MAX_CHARS,
//          readPastePayload, readPastePayloadFromDataTransfer

import { htmlToMarkdown, looksStructuredMarkdown } from '@/lib/clipboard/htmlToMarkdown';
import { logger } from '@/lib/logger';

/**
 * 剪贴板粘贴的**识别与归一化**。
 *
 * 设计要点：核心函数 `readPastePayload` 只接受「已经取好的三种表示」
 * （`text/html`、`text/plain`、文件列表），**不接触 `DataTransfer`** —— 这样它是纯函数，
 * 可以在 Node 里逐例验证；浏览器相关的取值放在 `readPastePayloadFromDataTransfer` 里。
 *
 * ## 识别优先级
 *
 * 1. **图片**：剪贴板里有图片文件（截屏、复制图片、从网页复制图）→ 交给既有上传链路
 *    （它会做体积预检与压缩，与「点按钮选图」完全同一条路径，不复刻逻辑）；
 * 2. **其它文件**：非图片文件同样交给既有文件上传链路；
 * 3. **有 HTML 且转换后确有结构** → 采用 Markdown 源文本；
 * 4. **否则** → 采用纯文本。
 *
 * ## 为什么不支持多条图片一次性发送
 *
 * 只发送第一张：粘贴 5 张截图会立刻刷出 5 条消息，而用户往往只是误粘。
 * 若有剩余，会在返回值里给出数量，由界面提示用户，避免「悄悄少发」。
 */

export type PasteKind = 'image' | 'file' | 'markdown' | 'text' | 'empty';

/** 单次粘贴写入输入框的字符上限（超出后截断并提示） */
export const PASTE_MAX_CHARS = 2000;

export interface IPastePayload {
  kind: PasteKind;
  /** 最终要写入输入框的文本（Markdown 或纯文本）；图片/文件粘贴时为空串 */
  text: string;
  /** 图片文件（交给既有图片上传链路） */
  imageFile?: File;
  /** 非图片文件 */
  file?: File;
  /** 剪贴板中未被处理的同类文件数量（只处理第一个） */
  extraFiles?: number;
  /** 是否发生了 HTML → Markdown 的转换 */
  converted?: boolean;
  /** 需要向用户说明的一句话（转换、截断、多余文件） */
  note?: string;
}

/** 从剪贴板取到的原始三种表示 */
export interface IRawClipboard {
  html?: string;
  text?: string;
  files?: File[];
}

/**
 * 单行输入框的归一化：把换行折叠为空格。
 *
 * 与浏览器对 `<input>` 的原生行为一致（原生粘贴多行文本时换行同样会被丢弃），
 * 因此这里显式做同样的事，避免「React 状态里有换行、DOM 里没有」的不一致。
 */
function toSingleLine(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

function isMarkdownLike(text: string): boolean {
  return looksStructuredMarkdown(text);
}

/** 核心识别（纯函数，可离线验证） */
export function readPastePayload(raw: IRawClipboard): IPastePayload {
  const files = raw.files ?? [];

  const images = files.filter((file) => file.type.startsWith('image/'));
  if (images.length > 0) {
    return {
      kind: 'image',
      text: '',
      imageFile: images[0],
      extraFiles: Math.max(0, images.length - 1),
    };
  }

  const others = files.filter((file) => file.size > 0);
  if (others.length > 0) {
    return {
      kind: 'file',
      text: '',
      file: others[0],
      extraFiles: Math.max(0, others.length - 1),
    };
  }

  const plain = (raw.text ?? '').replace(/\r\n?/g, '\n');
  if (!plain.trim()) return { kind: 'empty', text: '' };

  let chosen = plain;
  let converted = false;
  let note: string | undefined;

  const html = raw.html ?? '';
  if (html) {
    const markdown = htmlToMarkdown(html);
    // 仅当转换确实带出了结构、且结果与原纯文本不同时才采用
    if (markdown && looksStructuredMarkdown(markdown) && markdown !== plain.trim()) {
      chosen = markdown;
      converted = true;
      note = '已按 Markdown 解析粘贴内容';
    }
  }

  const singleLine = toSingleLine(chosen);
  const truncated = singleLine.length > PASTE_MAX_CHARS;
  const text = truncated ? singleLine.slice(0, PASTE_MAX_CHARS) : singleLine;

  if (truncated) {
    note = `粘贴内容过长，已截断至 ${PASTE_MAX_CHARS} 字`;
  }

  const kind: PasteKind = converted || isMarkdownLike(text) ? 'markdown' : 'text';
  return { kind, text, converted, note };
}

/**
 * 浏览器侧取值：把 `DataTransfer` 归一化为三种表示。
 * 取值失败一律降级为空（识别层会走「空粘贴」分支，把控制权交回浏览器）。
 */
export function readPastePayloadFromDataTransfer(data: DataTransfer | null): IPastePayload {
  if (!data) return { kind: 'empty', text: '' };

  let html = '';
  let text = '';
  const files: File[] = [];

  try {
    html = data.getData('text/html');
    text = data.getData('text/plain');
  } catch (error) {
    logger.warn('读取剪贴板文本失败，已按无文本处理', error);
  }

  try {
    // items 能拿到「文件」形式的粘贴（截图、复制的图片）；files 作为兜底
    const fromItems = Array.from(data.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    files.push(...fromItems);
    if (files.length === 0 && data.files) files.push(...Array.from(data.files));
  } catch (error) {
    logger.warn('读取剪贴板文件失败，已按无文件处理', error);
  }

  return readPastePayload({ html, text, files });
}
