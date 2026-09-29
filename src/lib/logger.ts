// EXPORTS: ILogger, logger

/**
 * 应用自有日志器 —— 替代平台 toolkit 的 `logger`。
 *
 * 三条硬约束：
 * 1. **只写 console，不做任何远程上报**。原平台 logger 联动 observable/slardar 上报链路，
 *    而本应用面向隐私场景，日志不得离开用户设备。
 * 2. **不输出敏感信息**：密码、房间号、消息明文一律不得进入日志（由调用方保证）。
 * 3. **签名与既有调用点完全一致**，使 22 处调用零改动。
 *
 * 级别策略：生产构建下静默 `debug`，避免把开发期细节写入用户控制台；
 * `info` / `warn` / `error` 始终输出，便于用户反馈问题时取证。
 */

export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** 控制台前缀：便于在混杂的浏览器日志中定位本应用的输出 */
const PREFIX = '[OpenChat]';

/**
 * 生产环境判定用 Vite 内建常量（构建期被替换为布尔字面量）。
 * **不可**改用 `process.env` —— 浏览器中不存在 `process`，会直接抛错。
 */
const IS_PRODUCTION = import.meta.env.PROD;

export const logger: ILogger = {
  debug(message, ...args) {
    if (IS_PRODUCTION) return;
    console.debug(PREFIX, message, ...args);
  },
  info(message, ...args) {
    if (IS_PRODUCTION) return;
    console.info(PREFIX, message, ...args);
  },
  warn(message, ...args) {
    console.warn(PREFIX, message, ...args);
  },
  error(message, ...args) {
    console.error(PREFIX, message, ...args);
  },
};
