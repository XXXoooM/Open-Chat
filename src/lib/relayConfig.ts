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

/**
 * 中继地址。
 *
 * ⚠️ `HAS_RELAY_CONFIG` 刻意写成**字面量比较**（`RAW !== ''`），而不是
 * `RAW.trim().length > 0`：`import.meta.env.VITE_RELAY_URL` 会被 Vite 在构建期
 * 替换成字符串字面量，只有字面量比较能让打包器把它折叠成 `false`，进而把
 * `relayTransport` 判定为不可达并整块删除。
 *
 * 这不是微优化 —— 实测过：改之前，即使不配置中继地址，产物里依然能找到中继路径
 * 标记 `/room/`（即整块代码被保留）；改成字面量比较后该标记消失。
 *
 * `&&` 的第二项保留 `RELAY_URL !== ''`，用于挡掉「只有空白字符」的配置：
 * 那种情况下也不该把请求发到一个空地址上去。
 */
const RAW_RELAY_URL = import.meta.env.VITE_RELAY_URL ?? '';

/** 去掉末尾斜杠，避免拼出 `//room` 这类路径 */
export const RELAY_URL = RAW_RELAY_URL.trim().replace(/\/+$/, '');

export const HAS_RELAY_CONFIG = RAW_RELAY_URL !== '' && RELAY_URL !== '';

export const RELAY_CONFIG_HINT = HAS_RELAY_CONFIG
  ? ''
  : '未配置 VITE_RELAY_URL，当前使用 MQTT 通路（阅后即焚将退化为本地定时销毁）。';
