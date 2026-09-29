// EXPORTS: htmlToMarkdown, looksStructuredMarkdown

/**
 * HTML → Markdown（移植：把从网页/文档复制来的富文本还原为可读的 Markdown 源文本）。
 *
 * ## 为什么需要它
 *
 * 从网页或文档里复制内容时，剪贴板同时带有 `text/html`（带粗体、链接、列表结构）与
 * `text/plain`（只剩文字）。若只取纯文本，用户精心复制的结构与链接会全部丢失。
 * 这里把常见语义还原成 Markdown 源文本 —— 消息协议本身是纯文本，因此
 * **还原成 Markdown 源码是唯一不改变收发两端约定的做法**。
 *
 * ## 覆盖范围与刻意的取舍
 *
 * 覆盖：标题、粗体/斜体/删除线、行内代码、代码块（含 `language-*` 语言标记）、
 * 链接、图片、有序/无序列表、引用、分割线、表格（拍平成 `|` 分隔的文本行）、换行与段落。
 *
 * 不覆盖（会退化为普通文本，不会报错）：复杂嵌套布局、CSS 生成的装饰内容、
 * 需要脚本才能得到的内容（`script`/`style` 一律删除）。
 *
 * ## 为什么不用 turndown 之类的库
 *
 * 转换只需在「粘贴含 HTML 时」执行一次，为一个边缘路径引入体积可观且长期需要跟随
 * 上游的依赖并不划算；而这里的规则集足够小，可以逐条看懂、逐条调整。
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'TEMPLATE', 'HEAD']);

/** 块级标签：前后需要空行分隔 */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'TR',
]);

function collapse(text: string): string {
  // 行内空白折叠（与 HTML 渲染一致），但保留换行
  return text.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n');
}

/** 取代码块的语言标记：`class="language-ts"` / `class="lang-ts"` */
function codeLanguage(element: Element): string {
  const className = element.getAttribute('class') ?? '';
  const matched = /(?:language|lang|highlight)-([\w+#-]+)/i.exec(className);
  return matched ? matched[1].toLowerCase() : '';
}

function renderChildren(node: Node): string {
  const parts: string[] = [];
  node.childNodes.forEach((child) => {
    parts.push(renderNode(child));
  });
  return parts.join('');
}

function renderListItems(list: Element, ordered: boolean): string {
  const lines: string[] = [];
  let index = 1;
  list.childNodes.forEach((child) => {
    if (!(child instanceof Element) || child.tagName !== 'LI') return;
    const marker = ordered ? `${index}. ` : '- ';
    const body = collapse(renderChildren(child)).trim().replace(/\n+/g, ' ');
    lines.push(`${marker}${body}`);
    index += 1;
  });
  return `\n${lines.join('\n')}\n`;
}

function renderTextNode(node: Node): string {
  return collapse(node.textContent ?? '');
}

function renderNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return renderTextNode(node);
  if (!(node instanceof Element)) return '';
  const tag = node.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return '';

  switch (tag) {
    case 'BR':
      return '\n';
    case 'HR':
      return '\n\n---\n\n';
    case 'STRONG':
    case 'B': {
      const inner = renderChildren(node).trim();
      return inner ? `**${inner}**` : '';
    }
    case 'EM':
    case 'I': {
      const inner = renderChildren(node).trim();
      return inner ? `*${inner}*` : '';
    }
    case 'DEL':
    case 'S':
    case 'STRIKE': {
      const inner = renderChildren(node).trim();
      return inner ? `~~${inner}~~` : '';
    }
    case 'CODE': {
      // 位于 PRE 内时由 PRE 分支处理，这里只处理行内代码
      if (node.parentElement?.tagName === 'PRE') return renderChildren(node);
      const inner = node.textContent ?? '';
      return inner ? `\`${inner}\`` : '';
    }
    case 'PRE': {
      const codeElement = node.querySelector('code');
      const source = (codeElement ?? node).textContent ?? '';
      const language = codeElement ? codeLanguage(codeElement) : '';
      return `\n\n\`\`\`${language}\n${source.replace(/\n+$/, '')}\n\`\`\`\n\n`;
    }
    case 'A': {
      const inner = renderChildren(node).trim();
      const href = node.getAttribute('href') ?? '';
      if (!href || href.startsWith('javascript:')) return inner;
      // 链接文字与地址相同时不重复输出
      return inner && inner !== href ? `[${inner}](${href})` : href;
    }
    case 'IMG': {
      const src = node.getAttribute('src') ?? '';
      if (!src) return '';
      const alt = node.getAttribute('alt') ?? '';
      return `![${alt}](${src})`;
    }
    case 'UL':
      return renderListItems(node, false);
    case 'OL':
      return renderListItems(node, true);
    case 'BLOCKQUOTE': {
      const body = renderChildren(node).trim().replace(/\n+/g, '\n');
      const quoted = body
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `\n\n${quoted}\n\n`;
    }
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number(tag.slice(1));
      const inner = renderChildren(node).trim();
      return inner ? `\n\n${'#'.repeat(level)} ${inner}\n\n` : '';
    }
    case 'TD':
    case 'TH': {
      const inner = collapse(renderChildren(node)).trim().replace(/\n+/g, ' ');
      return `${inner} | `;
    }
    case 'TR':
      return `\n${renderChildren(node)}`.replace(/ \| $/, '');
    case 'TABLE':
      return `\n\n${renderChildren(node).trim()}\n\n`;
    default: {
      const inner = renderChildren(node);
      if (BLOCK_TAGS.has(tag)) return `\n\n${inner}\n\n`;
      return inner;
    }
  }
}

/**
 * 把 HTML 片段转成 Markdown。
 *
 * 环境不支持 `DOMParser`（例如在 Node 中做单元测试）时返回空串，调用方会自动回落到
 * 剪贴板里的纯文本 —— 功能降级，但不会报错。
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return '';

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  /**
   * 取值根的兜底顺序：`body` → `documentElement` → 文档本身。
   *
   * 标准浏览器实现有 `body`；但轻量 DOM 实现（如 linkedom，用于离线验证）只提供
   * `documentElement`。此前只认 `body`，遇到这类实现会静默返回空串 —— 表现是
   * 「粘贴富文本却什么都没插入」，很难排查，因此这里显式兜底。
   */
  const root = parsed.body ?? parsed.documentElement ?? parsed;
  if (!root) return '';

  const markdown = renderChildren(root)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
  return markdown;
}

/**
 * 判断 Markdown 是否「比纯文本多出结构」。
 *
 * 用途：从网页复制一段普通文字时，剪贴板里同样有 `text/html`（通常只是把文字包在
 * `<div>`/`<span>` 里）。若不加判断就用转换结果替换，可能引入多余空行或实体差异，
 * 反而破坏用户原本干净的粘贴。因此只在转换**确实带出了结构**时才采用转换结果。
 */
export function looksStructuredMarkdown(markdown: string): boolean {
  if (!markdown) return false;
  return (
    /(^|\n)\s*(?:[-*+]\s|\d+\.\s|#{1,6}\s|>\s|```|\|)/.test(markdown) ||
    /\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|~~[^~\n]+~~/.test(markdown)
  );
}
