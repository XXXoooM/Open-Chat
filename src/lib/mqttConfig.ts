// EXPORTS: BROKER_URL, BROKER_USERNAME, BROKER_PASSWORD, HAS_BROKER_CONFIG, MISSING_BROKER_VARS, BROKER_CONFIG_HINT

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
