// EXPORTS: MAX_PAYLOAD_BYTES, MAX_FILE_PRECHECK, MAX_UPLOAD_PRECHECK, MAX_IMAGE_PRECHECK

/**
 * 聊天室传输体积限制（单一事实来源）。
 *
 * 修复 AUDIT.md `FUNC-15`：此前 950KB / 700KB 两个阈值在
 * `useMqttChat.ts` 与 `ChatInputSection.tsx` 中各定义一份，
 * 容易出现「只改一侧」的失同步。
 */

/** MQTT 单包上限（加密 + Base64 膨胀后的最终报文），留出 JSON envelope 余量 */
export const MAX_PAYLOAD_BYTES = 950 * 1024;

/** 文件类消息的发送前预检上限（加密 + Base64 后约膨胀 33%，故低于单包上限） */
export const MAX_FILE_PRECHECK = 700 * 1024;

/** 图片压缩后的体积上限（与文件保持一致，超出则提示用户） */
export const MAX_IMAGE_PRECHECK = 700 * 1024;

/** 原始文件体积上限：超过则直接拒绝，避免读取/解码超大文件导致页面卡死 */
export const MAX_UPLOAD_PRECHECK = 10 * 1024 * 1024;
