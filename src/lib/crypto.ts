// EXPORTS: KDF_V1_ITERATIONS, KDF_V2_ITERATIONS, CURRENT_KDF_VERSION, isKdfVersionSupported,
//          createKeyRing, resolveKey, deriveTopicNamespace, sha256Hex,
//          encryptJson, decryptJson, encryptBinary, decryptBinary

// ── Base64 编解码 ────────────────────────────────────────────
function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── 字符串 / ArrayBuffer 转换 ─────────────────────────────────
function stringToBuffer(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

// ── 工具：提取 Uint8Array 底层 ArrayBuffer（兼容 TS 类型）─────
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// ── 密钥派生版本（修复 AUDIT.md SEC-03）────────────────────────
//
// v1（历史版本）：PBKDF2-HMAC-SHA256 100,000 次 —— 保留用于解密既有房间，
//                否则升级会让进行中的房间全部显示「密码错误」。
// v2（当前版本）：PBKDF2-HMAC-SHA256 600,000 次 —— 新房间一律使用。
//
// 盐值仍为确定性「固定前缀 + 房间号」：这是端到端加密的硬约束 ——
// 所有成员必须在拿到任何服务端数据之前独立推导出同一把密钥，
// 因此无法使用随机盐（随机盐本身也需要被分发）。
export const KDF_V1_ITERATIONS = 100_000;
export const KDF_V2_ITERATIONS = 600_000;

/** 新建房间使用的密钥派生版本 */
export const CURRENT_KDF_VERSION = 2;

const KDF_ITERATIONS: Readonly<Record<number, number>> = {
  1: KDF_V1_ITERATIONS,
  2: KDF_V2_ITERATIONS,
};

export function isKdfVersionSupported(version: number): boolean {
  return Object.prototype.hasOwnProperty.call(KDF_ITERATIONS, version);
}

/** 信封中缺失 `v` 字段的历史报文一律视为 v1 */
export function normalizeEnvelopeVersion(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
}

// ── 密钥环：按版本懒派生并缓存 ────────────────────────────────
export interface IKeyRing {
  password: string;
  roomId: string;
  keys: Map<number, CryptoKey>;
}

export function createKeyRing(password: string, roomId: string): IKeyRing {
  return { password, roomId, keys: new Map() };
}

async function deriveKey(
  password: string,
  roomId: string,
  version: number,
): Promise<CryptoKey> {
  const iterations = KDF_ITERATIONS[version];
  if (!iterations) throw new Error(`不支持的密钥派生版本: ${version}`);

  const salt = stringToBuffer(`chatroom-e2ee-v${version}-${roomId}`);
  const pw = stringToBuffer(password);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    buf(pw),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: buf(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 取得指定版本的密钥（带缓存）。
 * 按需派生而非启动时全量派生：600,000 次 PBKDF2 有明显耗时，
 * 若房间是 v1 则完全不需要它。
 */
export async function resolveKey(
  ring: IKeyRing,
  version: number,
): Promise<CryptoKey | null> {
  if (!isKdfVersionSupported(version)) return null;

  const cached = ring.keys.get(version);
  if (cached) return cached;

  const key = await deriveKey(ring.password, ring.roomId, version);
  ring.keys.set(version, key);
  return key;
}

// ── 生成随机 12 字节 IV ───────────────────────────────────────
function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

// ── 信封结构 ──────────────────────────────────────────────────
export interface IEnvelope {
  v: number;
  iv: string;
  data: string;
}

function isEnvelope(value: unknown): value is IEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IEnvelope>;
  return typeof candidate.iv === 'string' && typeof candidate.data === 'string';
}

// ── JSON 加密 / 解密 ──────────────────────────────────────────
export async function encryptJson(
  key: CryptoKey,
  obj: unknown,
  version: number = CURRENT_KDF_VERSION,
): Promise<IEnvelope> {
  const iv = generateIv();
  const plaintext = stringToBuffer(JSON.stringify(obj));

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv) },
    key,
    buf(plaintext),
  );

  return {
    v: version,
    iv: base64Encode(iv),
    data: base64Encode(new Uint8Array(cipherBuf)),
  };
}

/**
 * 解密结果。区分「版本不支持」与「解密失败」是必要的：
 * 前者说明对端/本方客户端版本不一致，绝不能当成密码错误处理
 * （否则任意伪造报文都能把在线用户踢出房间，见 AUDIT.md SEC-02）。
 *
 * 刻意采用「扁平对象 + 可空字段」而非可判别联合：
 * 本项目 tsconfig 继承自平台预设（`strict: false`），在关闭 strictNullChecks
 * 的情况下布尔判别式不会收窄联合类型，扁平结构可以规避这一类陷阱。
 */
export type DecryptFailureReason =
  | 'invalid-envelope'
  | 'unsupported-version'
  | 'decrypt-failed';

export interface IDecryptResult<T> {
  /** 解密成功时的明文；失败为 null */
  value: T | null;
  /** 失败原因；成功为 null */
  reason: DecryptFailureReason | null;
  /** 报文声明的密钥派生版本 */
  version: number;
  /** 该版本是否受支持。为 false 说明是版本不匹配，而不是密码错误 */
  versionSupported: boolean;
}

export async function decryptJson<T = unknown>(
  ring: IKeyRing,
  envelope: unknown,
): Promise<IDecryptResult<T>> {
  if (!isEnvelope(envelope)) {
    return { value: null, reason: 'invalid-envelope', version: 1, versionSupported: true };
  }

  const version = normalizeEnvelopeVersion(envelope.v);
  const versionSupported = isKdfVersionSupported(version);
  if (!versionSupported) {
    return { value: null, reason: 'unsupported-version', version, versionSupported };
  }

  let key: CryptoKey | null;
  try {
    key = await resolveKey(ring, version);
  } catch {
    return { value: null, reason: 'decrypt-failed', version, versionSupported };
  }
  if (!key) {
    // 声明支持但派生失败（如迭代次数表被改坏），按版本不匹配上报，避免误判为密码错误
    return { value: null, reason: 'unsupported-version', version, versionSupported: false };
  }

  try {
    const iv = base64Decode(envelope.iv);
    const ciphertext = base64Decode(envelope.data);

    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(iv) },
      key,
      buf(ciphertext),
    );

    return {
      value: JSON.parse(bufferToString(plainBuf)) as T,
      reason: null,
      version,
      versionSupported,
    };
  } catch {
    return { value: null, reason: 'decrypt-failed', version, versionSupported };
  }
}

// ── 二进制加密 / 解密 ─────────────────────────────────────────
export async function encryptBinary(
  key: CryptoKey,
  data: Uint8Array,
  version: number = CURRENT_KDF_VERSION,
): Promise<IEnvelope> {
  const iv = generateIv();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv) },
    key,
    buf(data),
  );
  return {
    v: version,
    iv: base64Encode(iv),
    data: base64Encode(new Uint8Array(cipherBuf)),
  };
}

export type BinaryDecryptResult = IDecryptResult<Uint8Array>;

export async function decryptBinary(
  ring: IKeyRing,
  envelope: unknown,
): Promise<BinaryDecryptResult> {
  if (!isEnvelope(envelope)) {
    return { value: null, reason: 'invalid-envelope', version: 1, versionSupported: true };
  }

  const version = normalizeEnvelopeVersion(envelope.v);
  const versionSupported = isKdfVersionSupported(version);
  if (!versionSupported) {
    return { value: null, reason: 'unsupported-version', version, versionSupported };
  }

  let key: CryptoKey | null;
  try {
    key = await resolveKey(ring, version);
  } catch {
    return { value: null, reason: 'decrypt-failed', version, versionSupported };
  }
  if (!key) {
    return { value: null, reason: 'unsupported-version', version, versionSupported: false };
  }

  try {
    const iv = base64Decode(envelope.iv);
    const ciphertext = base64Decode(envelope.data);

    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(iv) },
      key,
      buf(ciphertext),
    );

    return { value: new Uint8Array(plainBuf), reason: null, version, versionSupported };
  } catch {
    return { value: null, reason: 'decrypt-failed', version, versionSupported };
  }
}

// ── topic 命名空间（修复 AUDIT.md SEC-05）──────────────────────
//
// 历史 topic 形如 `chatroom/{roomId}/messages`，roomId 是短数字，可被穷举
// 通配订阅。加入一段由「房间密码」派生的命名空间后，无密码者无法定位 topic。
//
// 该派生必须与消息密钥同等抗暴力破解，因此同样走 PBKDF2（不能直接 sha256，
// 否则命名空间本身就成了一个廉价的密码校验器）。
const TOPIC_NS_ITERATIONS = 100_000;
const TOPIC_NS_SALT_PREFIX = 'chatroom-topic-ns-v1';
const TOPIC_NS_BYTES = 8;

export async function deriveTopicNamespace(
  password: string,
  roomId: string,
): Promise<string> {
  const salt = stringToBuffer(`${TOPIC_NS_SALT_PREFIX}|${roomId}`);
  const pw = stringToBuffer(password);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    buf(pw),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: buf(salt),
      iterations: TOPIC_NS_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    TOPIC_NS_BYTES * 8,
  );

  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── 不可逆短标识（修复 AUDIT.md SEC-04）───────────────────────
// 用于 MQTT 遗嘱：遗嘱由 Broker 代发，无法加密，因此只允许携带不含
// 身份信息的哈希值，接收方通过 sid → userId 映射还原是谁离开。
export async function sha256Hex(input: string, length = 16): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf(stringToBuffer(input)));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, length);
}
