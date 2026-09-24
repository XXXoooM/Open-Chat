/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** MQTT Broker 的 WebSocket 端点，例如 wss://example.com:8084/mqtt */
  readonly VITE_MQTT_URL?: string;
  /** MQTT 用户名（不再硬编码在源码中） */
  readonly VITE_MQTT_USERNAME?: string;
  /** MQTT 密码（不再硬编码在源码中） */
  readonly VITE_MQTT_PASSWORD?: string;
  /**
   * 中继地址（Cloudflare Workers 侧）。
   * 配置后优先走中继通路；清空即回落到 MQTT，无需改代码。
   * 开发环境可设为 /relay（由 Vite 代理到本地 wrangler dev）。
   */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
