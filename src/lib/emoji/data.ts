// EXPORTS: EmojiCategoryId, EMOJI_CATEGORIES, IEmojiCatalogItem, hexToChar,
//          loadEmojiCatalog, getEmojiName, filterEmojiByCategory, searchEmoji

import { logger } from '@/lib/logger';

/**
 * 表情目录：从 `@usespaceui/emoji/data` 动态导入并按需建立索引。
 *
 * ## 为什么必须动态导入
 *
 * 数据集本身很大（`emoji-manifest.json` 1.35 MB + `emojiLib` 54 KB，构建后
 * `data.js` 约 1.5 MB）。它**只在用户打开表情面板时才需要**，因此这里用
 * `import()` 按需加载，绝不在模块顶层静态导入 —— 否则首屏 bundle 会被拖大。
 * 加载结果在模块作用域缓存：面板反复开关只解析一次。
 *
 * ## 上游没有的能力（本模块补齐）
 *
 * 实测：包内**没有表情选择器、也没有搜索 API**，只有「码点清单」和「名称字典」。
 * 分类、搜索、分页都由本模块自建：
 * - 分类：按 Unicode 码点区间归类（**近似**，见 CATEGORY_RANGES 注释）
 * - 搜索：用名称字典匹配（空格转连字符，与上游命名口径一致）
 */

/** 分类标识 */
export type EmojiCategoryId =
  | 'faces'
  | 'people'
  | 'animals'
  | 'food'
  | 'activities'
  | 'travel'
  | 'objects'
  | 'symbols'
  | 'flags'
  | 'other';

export interface IEmojiCategory {
  id: EmojiCategoryId;
  label: string;
}

/** 分类展示顺序（面板按此横向排列） */
export const EMOJI_CATEGORIES: IEmojiCategory[] = [
  { id: 'faces', label: '笑脸' },
  { id: 'people', label: '人物' },
  { id: 'animals', label: '动物' },
  { id: 'food', label: '食物' },
  { id: 'activities', label: '活动' },
  { id: 'travel', label: '出行' },
  { id: 'objects', label: '物品' },
  { id: 'symbols', label: '符号' },
  { id: 'flags', label: '旗帜' },
  { id: 'other', label: '其他' },
];

/**
 * 分类规则：按首个码点落在哪个区间归类，**顺序敏感**（先匹配到的区间生效）。
 *
 * 刻意声明为「近似」：Unicode 的 emoji 分组（Smileys / People / Nature…）并没有
 * 与码点区间一一对应（例如 ❤ 属于情绪类但码点在 0x2764 符号区）。用户在大类里
 * 找不到某个表情时还可以用搜索，因此这里优先要**零额外数据体积**，而不是绝对准确。
 */
const CATEGORY_RANGES: Array<{ id: EmojiCategoryId; ranges: ReadonlyArray<readonly [number, number]> }> = [
  {
    id: 'faces',
    ranges: [
      [0x1f600, 0x1f64f],
      [0x1f910, 0x1f96f],
      [0x1f970, 0x1f97f],
      [0x2639, 0x263a],
      [0x2764, 0x2764],
      [0x1f493, 0x1f49f],
    ],
  },
  {
    id: 'people',
    ranges: [
      [0x1f440, 0x1f450],
      [0x1f464, 0x1f48f],
      [0x1f4aa, 0x1f4af],
      [0x1f57a, 0x1f596],
      [0x1f645, 0x1f64f],
      [0x1f930, 0x1f9af],
      [0x1f9b0, 0x1f9ff],
      [0x270a, 0x270d],
      [0x1f344, 0x1f344],
    ],
  },
  {
    id: 'animals',
    ranges: [
      [0x1f330, 0x1f343],
      [0x1f400, 0x1f43f],
      [0x1f980, 0x1f9ae],
      [0x1f9ba, 0x1f9bf],
      [0x1fac0, 0x1faff],
    ],
  },
  {
    id: 'food',
    ranges: [
      [0x1f345, 0x1f37f],
      [0x1f950, 0x1f96f],
      [0x1f9c0, 0x1f9cb],
      [0x2615, 0x2615],
      [0x1f37e, 0x1f37e],
    ],
  },
  {
    id: 'activities',
    ranges: [
      [0x1f380, 0x1f3ca],
      [0x1f3cf, 0x1f3d3],
      [0x1f3e0, 0x1f3e0],
      [0x1f396, 0x1f397],
      [0x1f3ab, 0x1f3af],
      [0x1f004, 0x1f004],
    ],
  },
  {
    id: 'travel',
    ranges: [
      [0x1f300, 0x1f32c],
      [0x1f3d4, 0x1f3df],
      [0x1f3e1, 0x1f3f0],
      [0x1f5fa, 0x1f5ff],
      [0x1f680, 0x1f6a4],
      [0x1f6b2, 0x1f6ff],
    ],
  },
  {
    id: 'objects',
    ranges: [
      [0x1f450, 0x1f463],
      [0x1f4a0, 0x1f4ff],
      [0x1f500, 0x1f5ff],
      [0x1f9b0, 0x1f9b9],
      [0x1fa70, 0x1faff],
      [0x231a, 0x231b],
      [0x2600, 0x2620],
    ],
  },
  {
    id: 'symbols',
    ranges: [
      [0x2190, 0x21ff],
      [0x2300, 0x23ff],
      [0x2460, 0x24ff],
      [0x25a0, 0x27bf],
      [0x2900, 0x2bff],
      [0x1f100, 0x1f1ad],
      [0x1f500, 0x1f5ff],
    ],
  },
  { id: 'flags', ranges: [[0x1f1e6, 0x1f1ff], [0x1f3f3, 0x1f3f4]] },
];

/** 面板中的单个表情项 */
export interface IEmojiCatalogItem {
  /** 表情字符 */
  char: string;
  /** 码点串（与 CDN 文件名一致，可直接拼 URL） */
  hex: string;
  /** 英文名称；上游字典未收录时为空 */
  name?: string;
  category: EmojiCategoryId;
}

/** 从码点串还原字符（例：`0023-fe0f-20e3` → `#️⃣`） */
export function hexToChar(hex: string): string {
  return hex
    .split('-')
    .map((part) => String.fromCodePoint(Number.parseInt(part, 16)))
    .join('');
}

function classify(hex: string): EmojiCategoryId {
  const head = hex.split('-')[0];
  const codePoint = Number.parseInt(head, 16);
  if (!Number.isFinite(codePoint)) return 'other';
  for (const group of CATEGORY_RANGES) {
    for (const [start, end] of group.ranges) {
      if (codePoint >= start && codePoint <= end) return group.id;
    }
  }
  return 'other';
}

/** 动态导入的数据集最小形状（上游类型极深，这里只取用得到的两个字段） */
interface IEmojiDataModule {
  emojiManifest?: { providers?: Record<string, unknown> };
  emojiLib?: Record<string, string>;
}

let catalogPromise: Promise<IEmojiCatalogItem[]> | null = null;

/**
 * 加载并构建目录（幂等，结果在模块作用域缓存）。
 * 失败时抛错，由调用方（面板）展示重试入口 —— 不吞掉错误，否则面板会静止在骨架态。
 */
export function loadEmojiCatalog(): Promise<IEmojiCatalogItem[]> {
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const data = (await import('@usespaceui/emoji/data')) as IEmojiDataModule;
    // 字符 → 名称（上游字典即为该方向）
    const names = data.emojiLib ?? {};
    const providerList = data.emojiManifest?.providers?.['fluent/3d'];

    // 首选「该图集真实存在的码点清单」：只展示能真正加载出图片的表情
    let hexList: string[] = Array.isArray(providerList)
      ? providerList.filter((item): item is string => typeof item === 'string')
      : [];

    if (hexList.length === 0) {
      // 清单缺失时回落到名称字典：宁可少一些，也不能给出 404 的表情
      logger.warn('表情目录清单缺失，已回落到名称字典');
      hexList = Object.keys(names);
    }

    const items: IEmojiCatalogItem[] = hexList.map((hex) => {
      const char = hexToChar(hex);
      return { char, hex, name: names[char], category: classify(hex) };
    });

    logger.debug('表情目录已就绪', { count: items.length, named: Object.keys(names).length });
    return items;
  })();

  // 失败后允许重试：不缓存被拒绝的 Promise
  catalogPromise.catch(() => {
    catalogPromise = null;
  });

  return catalogPromise;
}

/** 取某个表情的名称（用于搜索结果的可访问标题） */
export function getEmojiName(item: IEmojiCatalogItem): string {
  return item.name ? item.name.replace(/-/g, ' ') : item.hex;
}

export function filterEmojiByCategory(
  items: IEmojiCatalogItem[],
  category: EmojiCategoryId,
): IEmojiCatalogItem[] {
  return items.filter((item) => item.category === category);
}

/**
 * 按关键词搜索。
 * 归一化方式与上游命名口径一致：小写、空格转连字符（`grinning face` → `grinning-face`）。
 */
export function searchEmoji(items: IEmojiCatalogItem[], query: string, limit = 120): IEmojiCatalogItem[] {
  const keyword = query.trim().toLowerCase().replace(/\s+/g, '-');
  if (!keyword) return items.slice(0, limit);

  const matched: IEmojiCatalogItem[] = [];
  for (const item of items) {
    const name = item.name;
    if (name) {
      if (name.includes(keyword)) matched.push(item);
    } else if (item.hex.includes(keyword)) {
      // 未收录名称的表情支持按码点搜索（例：1f525）
      matched.push(item);
    }
    if (matched.length >= limit) break;
  }
  return matched;
}
