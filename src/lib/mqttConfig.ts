// EXPORTS: BROKER_URL, BROKER_USERNAME, BROKER_PASSWORD, HAS_BROKER_CONFIG, MISSING_BROKER_VARS,
//          BROKER_CONFIG_HINT, IBrokerUrlInspection, inspectBrokerUrl, BROKER_URL_INSPECTION

/**
 * MQTT Broker 连接配置（修复 AUDIT.md `SEC-01`）。
 *
 * 此前用户名/密码以明文硬编码在 `useMqttChat.ts` 中，必然随前端产物分发。
 * 现在改为构建期注入的环境变量，仓库内不再保存任何真实凭据：
 *
 *   1. 复制根目录 `.env.example` 为 `.env.local`（该文件已被 .gitignore 忽略）
 *   2. 填入 VITE_MQTT_URL / VITE_MQTT_USERNAME / VITE_MQTT_PASSWORD
 *
 * 注意：Vite 只对「静态的成员访问」做编译期替换，因此这里必须写成
 * `import.meta.env.VITE_MQTT_URL` 字面量形式，不能做动态取值。
 */

export const BROKER_URL = import.meta.env.VITE_MQTT_URL?.trim() ?? '';
export const BROKER_USERNAME = import.meta.env.VITE_MQTT_USERNAME?.trim() ?? '';
export const BROKER_PASSWORD = import.meta.env.VITE_MQTT_PASSWORD ?? '';

export const MISSING_BROKER_VARS: string[] = [
  BROKER_URL ? '' : 'VITE_MQTT_URL',
  BROKER_USERNAME ? '' : 'VITE_MQTT_USERNAME',
  BROKER_PASSWORD ? '' : 'VITE_MQTT_PASSWORD',
].filter(Boolean);

export const HAS_BROKER_CONFIG = MISSING_BROKER_VARS.length === 0;

export const BROKER_CONFIG_HINT = HAS_BROKER_CONFIG
  ? ''
  : `未配置聊天服务连接信息，请在项目根目录创建 .env.local 并设置：${MISSING_BROKER_VARS.join('、')}`;

export interface IBrokerUrlInspection {
  /** 阻断级问题：该地址在当前页面环境下无法建立连接 */
  fatal: string;
  /** 可疑但可能可连：多为 EMQX Cloud 等托管服务的常见配置错误 */
  warning: string;
}

/**
 * 检查 Broker 地址是否符合**浏览器端 mqtt.js** 的要求。
 *
 * 注意这里校验的都是「配置写错但看起来很像对的」情形 —— 这类错误的现象是
 * 「一直连不上、却不报凭据错误」，排查成本很高。典型来自 EMQX Cloud：
 *
 * - **协议必须是 ws:// 或 wss://**：浏览器里 mqtt.js 只能走 WebSocket。
 *   控制台给出的 8883 是「MQTT over TLS」（原生 TCP），浏览器**用不了** ——
 *   这是最常见的误解，必须给出明确提示；
 * - **Serverless 仅支持 TLS**：明文端口 1883 / 8083 会被拒绝；
 * - **路径通常必须是 `/mqtt`**：EMQX 的 WebSocket 入口挂在该路径上，写成根路径
 *   通常得到 400 而看不出原因；
 * - **HTTPS 页面不能连 ws://**：浏览器按混合内容拦截，报错发生在网络层之前。
 */
export function inspectBrokerUrl(url: string): IBrokerUrlInspection {
  const result: IBrokerUrlInspection = { fatal: '', warning: '' };
  if (!url) return result;

  if (!/^wss?:\/\//i.test(url)) {
    result.fatal =
      'VITE_MQTT_URL 必须是 ws:// 或 wss:// 开头的 WebSocket 地址。浏览器里 mqtt.js 无法使用原生 MQTT 端口（1883 / 8883）—— EMQX Cloud 请用「WebSocket over TLS/SSL」端口 8084。';
    return result;
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    result.fatal = 'VITE_MQTT_URL 不是合法 URL。';
    return result;
  }

  const isSecure = parsed.protocol === 'wss:';
  if (!isSecure && typeof window !== 'undefined' && window.location.protocol === 'https:') {
    result.fatal =
      '当前页面是 HTTPS，浏览器会按「混合内容」拦截 ws:// 明文连接。请改用 wss://（EMQX Cloud 用 8084 端口）。';
    return result;
  }

  if (!isSecure || parsed.port === '1883' || parsed.port === '8083') {
    result.warning =
      'EMQX Cloud Serverless 仅支持 TLS 端口，明文端口（1883 / 8083）会被拒绝；请使用 wss:// 与 8084。';
    return result;
  }

  if (parsed.port === '8883') {
    result.warning =
      '8883 是「MQTT over TLS」（原生 TCP）端口，浏览器端 mqtt.js 无法使用；WebSocket over TLS/SSL 请用 8084。';
    return result;
  }

  if (parsed.port !== '8084' && parsed.port !== '443' && parsed.port !== '') {
    result.warning = `端口 ${parsed.port} 不是 EMQX Cloud 的常用 WebSocket 端口（8084 为 WebSocket over TLS/SSL）。`;
    return result;
  }

  if (parsed.pathname === '/' || parsed.pathname === '') {
    result.warning =
      'EMQX 的 WebSocket 入口默认挂在 /mqtt 路径上，缺少该路径通常会被拒绝（400）。建议写成 wss://<连接地址>:8084/mqtt。';
  }

  return result;
}

/** 启动时算一次（构建期常量，无需重复计算） */
export const BROKER_URL_INSPECTION = inspectBrokerUrl(BROKER_URL);
