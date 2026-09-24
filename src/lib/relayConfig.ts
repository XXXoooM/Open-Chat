// EXPORTS: RELAY_URL, HAS_RELAY_CONFIG, RELAY_CONFIG_HINT

/**
 * 中继配置。
 *
 * 与 MQTT 配置的区别：中继地址**不是**凭据，它只是一个入口。
 * 真正的准入控制来自「房间地址 = 房间号 + 密码派生命名空间」，
 * 只有知道密码的人才能算出该地址，因此这里不需要（也不应该有）共享密钥。
 *
 * 该变量会被注入前端产物，属预期行为：地址本身对匿名者无意义。
 */

const raw = (import.meta.env.VITE_RELAY_URL ?? '').trim();

/** 去掉末尾斜杠，避免拼出 `//room` 这类路径 */
export const RELAY_URL = raw.replace(/\/+$/, '');

export const HAS_RELAY_CONFIG = RELAY_URL.length > 0;

export const RELAY_CONFIG_HINT = HAS_RELAY_CONFIG
  ? ''
  : '未配置 VITE_RELAY_URL，当前使用 MQTT 通路（阅后即焚将退化为本地定时销毁）。';
