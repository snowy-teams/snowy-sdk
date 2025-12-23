import bs58 from "bs58";

function utf8Encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function assertJsonSafeNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error("Snowy SDK: numbers must be finite for deterministic hashing");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/**
 * Recursively canonicalizes a JSON-compatible value by sorting object keys.
 * This ensures deterministic JSON.stringify output for hashing.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (value === undefined) {
    throw new Error("Snowy SDK: undefined values are not allowed in hashed payloads");
  }
  if (value === null) return null;

  const t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") {
    assertJsonSafeNumber(value as number);
    return value;
  }

  if (value instanceof Uint8Array) {
    throw new Error(
      "Snowy SDK: Uint8Array is not JSON-canonical; encode to base58/base64 string before hashing"
    );
  }

  if (Array.isArray(value)) {
    return value.map((v) => canonicalizeJson(v));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) {
        throw new Error("Snowy SDK: undefined values are not allowed in hashed payloads");
      }
      out[key] = canonicalizeJson(v);
    }
    return out;
  }

  throw new Error(`Snowy SDK: unsupported value type for hashing: ${Object.prototype.toString.call(value)}`);
}

async function sha256Raw(data: Uint8Array): Promise<Uint8Array> {
  const cryptoObj: Crypto | undefined = (globalThis as unknown as { crypto?: Crypto }).crypto;

  if (cryptoObj?.subtle) {
    const ab: ArrayBuffer =
      data.buffer instanceof ArrayBuffer
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : new Uint8Array(data).buffer;
    const digest = await cryptoObj.subtle.digest("SHA-256", ab);
    return new Uint8Array(digest);
  }

  // Node.js fallback for environments where globalThis.crypto is not defined.
  try {
    const nodeCrypto = await import("crypto");
    if (nodeCrypto.webcrypto?.subtle) {
      const ab: ArrayBuffer =
        data.buffer instanceof ArrayBuffer
          ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
          : new Uint8Array(data).buffer;
      const digest = await nodeCrypto.webcrypto.subtle.digest("SHA-256", ab);
      return new Uint8Array(digest);
    }

    const hash = nodeCrypto.createHash("sha256").update(data).digest();
    return new Uint8Array(hash);
  } catch {
    throw new Error("Snowy SDK: no SHA-256 implementation available in this environment");
  }
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return sha256Raw(data);
}

export async function sha256Base58(data: Uint8Array): Promise<string> {
  const digest = await sha256Raw(data);
  return bs58.encode(digest);
}

export async function hashDeterministicJson(value: unknown): Promise<{ bytes: Uint8Array; base58: string }> {
  const canonical = canonicalizeJson(value);
  const json = JSON.stringify(canonical);
  const bytes = await sha256(utf8Encode(json));
  return { bytes, base58: bs58.encode(bytes) };
}

export async function hashDeterministicJsonBase58(value: unknown): Promise<string> {
  const canonical = canonicalizeJson(value);
  const json = JSON.stringify(canonical);
  return sha256Base58(utf8Encode(json));
}

export async function hashDeterministicJsonBytes(value: unknown): Promise<Uint8Array> {
  const canonical = canonicalizeJson(value);
  const json = JSON.stringify(canonical);
  return sha256(utf8Encode(json));
}
