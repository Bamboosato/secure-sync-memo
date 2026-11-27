export const DEFAULT_KDF_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 8;
const AES_GCM_IV_BYTES = 12;
const DEK_BYTES = 32;
const KEY_CHECK_PLAINTEXT = 'secure-sync-memo:key-check:v1';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface EncryptedPayload {
  iv: string;
  data: string;
}

export interface EncryptedTextResult {
  iv: string;
  ciphertext: string;
}

export interface PassphraseStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  isValid: boolean;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not available in this environment.');
  }
  return subtle;
}

function getRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Web Crypto API (crypto.getRandomValues) is not available in this environment.');
  }
  const buffer = new ArrayBuffer(length);
  const bytes = new Uint8Array(buffer);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toArrayBufferBytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(view.byteLength);
  const copy = new Uint8Array(buffer);
  copy.set(view);
  return copy;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const normalized = base64.trim();
  const binary = atob(normalized);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateSalt(byteLength = 16): string {
  if (byteLength < 16) {
    throw new Error('KDF salt must be at least 16 bytes.');
  }
  return bytesToBase64(getRandomBytes(byteLength));
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31] ?? '';
  }

  return output.match(/.{1,4}/g)?.join('-') ?? output;
}

function decodeBase32(input: string): Uint8Array<ArrayBuffer> {
  const cleaned = input.replace(/[\s-]+/g, '').replace(/=+$/g, '').toUpperCase();
  if (cleaned.length === 0) {
    throw new Error('Recovery key is empty.');
  }

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('Recovery key contains invalid characters.');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  const buffer = new ArrayBuffer(output.length);
  const bytes = new Uint8Array(buffer);
  bytes.set(output);
  return bytes;
}

/**
 * Derives an AES-256-GCM Key Encryption Key (KEK) from a master passphrase via PBKDF2-HMAC-SHA-256.
 */
export async function deriveKekFromPassphrase(
  passphrase: string,
  saltBase64: string,
  iterations = DEFAULT_KDF_ITERATIONS,
): Promise<CryptoKey> {
  if (!passphrase) {
    throw new Error('Passphrase must not be empty.');
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('KDF iterations must be a positive integer.');
  }

  const subtle = getSubtle();
  const salt = base64ToBytes(saltBase64);
  const keyMaterial = await subtle.importKey(
    'raw',
    toArrayBufferBytes(textEncoder.encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Generates a fresh 256-bit AES-GCM Data Encryption Key (DEK).
 * Created extractable so it can be exported once as a recovery key and wrapped by the KEK.
 */
export async function generateDek(): Promise<CryptoKey> {
  const subtle = getSubtle();
  return subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Exports an extractable DEK as a human-readable grouped Base32 recovery key.
 */
export async function exportRecoveryKey(dek: CryptoKey): Promise<string> {
  const subtle = getSubtle();
  const raw = await subtle.exportKey('raw', dek);
  const bytes = new Uint8Array(raw);
  if (bytes.byteLength !== DEK_BYTES) {
    throw new Error('Unexpected DEK byte length.');
  }
  return encodeBase32(bytes);
}

/**
 * Imports a Base32 recovery key string as an AES-256-GCM DEK.
 */
export async function importRecoveryKey(
  recoveryKey: string,
  extractable = true,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const bytes = decodeBase32(recoveryKey);
  if (bytes.byteLength !== DEK_BYTES) {
    throw new Error('Invalid recovery key length.');
  }
  return subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Wraps (encrypts) a DEK with a KEK using a fresh random 12-byte AES-GCM IV.
 */
export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<EncryptedPayload> {
  const subtle = getSubtle();
  const iv = getRandomBytes(AES_GCM_IV_BYTES);
  const wrappedBuffer = await subtle.wrapKey('raw', dek, kek, {
    name: 'AES-GCM',
    iv,
  });
  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(wrappedBuffer)),
  };
}

/**
 * Unwraps (decrypts) a wrapped DEK using the derived KEK.
 * Defaults to non-extractable so active session DEKs cannot be exported from memory.
 */
export async function unwrapDek(
  wrappedDek: EncryptedPayload,
  kek: CryptoKey,
  extractable = false,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const iv = base64ToBytes(wrappedDek.iv);
  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error('Invalid wrapped DEK IV length.');
  }
  const wrappedBytes = base64ToBytes(wrappedDek.data);
  return subtle.unwrapKey(
    'raw',
    wrappedBytes,
    kek,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts UTF-8 plaintext with the DEK and a newly generated 12-byte random IV.
 */
export async function encryptText(
  plainText: string,
  dek: CryptoKey,
): Promise<EncryptedTextResult> {
  const subtle = getSubtle();
  const iv = getRandomBytes(AES_GCM_IV_BYTES);
  const plainBytes = toArrayBufferBytes(textEncoder.encode(plainText));
  const cipherBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    dek,
    plainBytes,
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

/**
 * Decrypts Base64 AES-256-GCM ciphertext and IV back into UTF-8 text.
 */
export async function decryptText(
  ciphertext: string,
  iv: string,
  dek: CryptoKey,
): Promise<string> {
  const subtle = getSubtle();
  const ivBytes = base64ToBytes(iv);
  if (ivBytes.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error('Invalid ciphertext IV length.');
  }
  const cipherBytes = base64ToBytes(ciphertext);
  const plainBuffer = await subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    dek,
    cipherBytes,
  );
  return textDecoder.decode(plainBuffer);
}

/**
 * Creates a deterministic-purpose verification payload encrypted under the DEK.
 */
export async function createKeyCheck(dek: CryptoKey): Promise<EncryptedPayload> {
  const { iv, ciphertext } = await encryptText(KEY_CHECK_PLAINTEXT, dek);
  return { iv, data: ciphertext };
}

/**
 * Verifies that a DEK successfully decrypts the key-check payload to the expected sentinel.
 */
export async function verifyKeyCheck(
  keyCheck: EncryptedPayload,
  dek: CryptoKey,
): Promise<boolean> {
  try {
    const decrypted = await decryptText(keyCheck.data, keyCheck.iv, dek);
    return decrypted === KEY_CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}

export function evaluatePassphraseStrength(passphrase: string): PassphraseStrength {
  const isValid = passphrase.length >= MIN_PASSPHRASE_LENGTH;
  if (!passphrase) {
    return { score: 0, label: '未入力', isValid: false };
  }

  let points = 0;
  if (passphrase.length >= MIN_PASSPHRASE_LENGTH) points += 1;
  if (passphrase.length >= 12) points += 1;
  if (/[a-z]/.test(passphrase) && /[A-Z]/.test(passphrase)) points += 1;
  if (/\d/.test(passphrase) && /[^a-zA-Z0-9]/.test(passphrase)) points += 1;

  const score = Math.min(4, points) as 0 | 1 | 2 | 3 | 4;
  const labels: Record<0 | 1 | 2 | 3 | 4, string> = {
    0: '8文字以上が必要です',
    1: '弱い（もう少し長く・文字種を増やすと安全です）',
    2: '普通',
    3: '強い',
    4: '非常に強い',
  };

  return {
    score: isValid ? Math.max(1, score) as 1 | 2 | 3 | 4 : 0,
    label: isValid ? labels[Math.max(1, score) as 1 | 2 | 3 | 4] : labels[0],
    isValid,
  };
}
