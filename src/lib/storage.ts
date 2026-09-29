// EXPORTS: IStringStorage, storage, readLegacyValue

/**
 * 应用自有本地存储 —— 替代平台 toolkit 的 `scopedStorage`。
 *
 * ## 为什么必须带迁移逻辑
 *
 * 应用此前运行在平台托管环境，其存储实现会在逻辑键前拼接命名空间，形如
 * `<前缀><命名空间><分隔符><逻辑键>`。本应用改用无前缀的逻辑键后，若不迁移，
 * **已部署用户升级后会「丢失」昵称、房间号与隐私设置**（数据其实还在 localStorage
 * 里，只是按新键读不到），用户表现为需要重新输入昵称与房间号。
 *
 * 读取顺序：新键 → 旧带前缀键（命中则迁移到新键并清理旧键）→ null。
 *
 * ## 为什么按「形状」而非「固定前缀」识别旧键
 *
 * 这里刻意**不硬编码**历史命名空间的具体前缀：
 * - 旧实现的命名空间取值取决于运行时注入的应用标识，历史上可能是空（`__global__`）
 *   也可能是真实应用号，固定前缀会漏匹配；
 * - 该前缀字符串若写死，会被打包进公开产物，等于在本项目里留下平台标识。
 *
 * 因此改为按形状匹配：以 `__` 开头、以 `__:<逻辑键>` 结尾。逻辑键本身已足够独特
 * （如 `__global_chat_nickname`），不存在误匹配风险。
 *
 * ## 降级要求
 *
 * 所有操作均 try/catch 包裹：隐私模式、存储配额耗尽等场景下不可抛异常打断渲染，
 * 静默降级为「本次会话内不记忆」。
 */

/** 旧键的起始标记 */
const LEGACY_KEY_PREFIX = '__';
/** 命名空间与逻辑键之间的分隔符 */
const LEGACY_SEPARATOR = '__:';

export interface IStringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 在 localStorage 中查找某个逻辑键对应的旧带前缀键。
 * 取**最短**的匹配键：命名空间越短越可能是「未绑定应用标识」时期写入的形式，
 * 那正是当前部署历史上真实存在过的键。
 */
function findLegacyKey(logicalKey: string): string | null {
  const suffix = `${LEGACY_SEPARATOR}${logicalKey}`;
  try {
    let best: string | null = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      // 长度必须大于后缀：排除「键恰好等于后缀」的退化情形
      if (!key || key.length <= suffix.length) continue;
      if (!key.startsWith(LEGACY_KEY_PREFIX) || !key.endsWith(suffix)) continue;
      if (best === null || key.length < best.length) best = key;
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * 读取旧键的原始值（不迁移）。
 * 仅供调试/诊断使用；`storage.getItem` 内部已自动迁移，正常代码无需调用。
 */
export function readLegacyValue(logicalKey: string): string | null {
  const legacyKey = findLegacyKey(logicalKey);
  if (!legacyKey) return null;
  try {
    return localStorage.getItem(legacyKey);
  } catch {
    return null;
  }
}

export const storage: IStringStorage = {
  getItem(key) {
    try {
      const current = localStorage.getItem(key);
      if (current !== null) return current;

      const legacyKey = findLegacyKey(key);
      if (!legacyKey) return null;

      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue !== null) {
        // 迁移：先写新键再删旧键。任一步失败都不影响本次返回值。
        try {
          localStorage.setItem(key, legacyValue);
          localStorage.removeItem(legacyKey);
        } catch {
          // 配额不足或存储不可用：保留旧键，下次读取会再试一次
        }
      }
      return legacyValue;
    } catch {
      return null;
    }
  },

  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 存储不可用时静默降级为「本次会话内有效」
    }
  },

  removeItem(key) {
    try {
      localStorage.removeItem(key);
      const legacyKey = findLegacyKey(key);
      if (legacyKey) localStorage.removeItem(legacyKey);
    } catch {
      // 同上
    }
  },
};
