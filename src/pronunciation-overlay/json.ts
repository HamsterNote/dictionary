/**
 * 规范化 JSON 与稳定指纹工具。
 *
 * 仅用于「比较与真正重复去重」：对象键排序、跳过 `undefined` 字段、不做任何语义改写。
 * 原值必须在调用方完整保留；这里绝不用于生成正式结果。
 * 指纹采用 FNV-1a 64 位（按 UTF-16 码元），是**非加密**的稳定内容指纹，
 * 用于同来源/同范围去重与变化检测；真正的内容 hash（如响应 sha256）由图外采集层提供并存入证据。
 */

/** JSON 可序列化基础值。 */
export type JsonPrimitive = string | number | boolean | null;

/** JSON 可序列化值（只读视图）。 */
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * 规范化序列化：对象键升序、数组保持原序、`undefined` 字段忽略。
 * 遇到非有限数字、函数、symbol 等不可序列化值会抛错，避免静默丢数据。
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('canonicalizeJson: 数字必须是有限值');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new TypeError(`canonicalizeJson: 不支持的类型 ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    .join(',');
  return `{${body}}`;
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_64_MASK = 0xffffffffffffffffn;

/** 计算 FNV-1a 64 位十六进制指纹（非加密，跨平台稳定）。 */
export function fnv1a64Hex(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME) & FNV_64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** 对任意 JSON 值先做规范化序列化，再计算稳定指纹。 */
export function fingerprintJson(value: unknown): string {
  return fnv1a64Hex(canonicalizeJson(value));
}

/** `canonicalizeJson` 的语义化别名。 */
export function stableStringify(value: unknown): string {
  return canonicalizeJson(value);
}
