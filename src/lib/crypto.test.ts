import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KDF_ITERATIONS,
  createKeyCheck,
  decryptText,
  deriveKekFromPassphrase,
  encryptText,
  evaluatePassphraseStrength,
  exportRecoveryKey,
  generateDek,
  generateSalt,
  importRecoveryKey,
  unwrapDek,
  verifyKeyCheck,
  wrapDek,
} from './crypto';

const FAST_TEST_ITERATIONS = 10_000;

describe('crypto module', () => {
  it('uses at least 600,000 PBKDF2 iterations by default', () => {
    expect(DEFAULT_KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('encrypts and decrypts ASCII, Japanese, emoji, empty, and large strings', async () => {
    const dek = await generateDek();
    const samples = [
      'Hello, Secure Sync Memo!',
      '日本語の機密メモ：パスワード・APIキー・銀行口座メモ 🔐🗝️',
      '',
      'あいうえお\n'.repeat(2000),
    ];

    for (const plain of samples) {
      const { iv, ciphertext } = await encryptText(plain, dek);
      expect(iv.length).toBeGreaterThan(0);
      expect(ciphertext).not.toBe(plain);
      const decrypted = await decryptText(ciphertext, iv, dek);
      expect(decrypted).toBe(plain);
    }
  });

  it('generates a fresh random IV on every encryption call', async () => {
    const dek = await generateDek();
    const plain = 'identical secret content';

    const first = await encryptText(plain, dek);
    const second = await encryptText(plain, dek);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(await decryptText(first.ciphertext, first.iv, dek)).toBe(plain);
    expect(await decryptText(second.ciphertext, second.iv, dek)).toBe(plain);
  });

  it('rejects tampered ciphertext and wrong DEK on decryption', async () => {
    const dek1 = await generateDek();
    const dek2 = await generateDek();
    const { iv, ciphertext } = await encryptText('confidential note', dek1);

    await expect(decryptText(ciphertext, iv, dek2)).rejects.toThrow();

    const tampered = `${ciphertext.slice(0, -2)}AA`;
    await expect(decryptText(tampered, iv, dek1)).rejects.toThrow();
  });

  it('derives KEK from passphrase, wraps DEK, unwraps DEK, and verifies keyCheck', async () => {
    const salt = generateSalt(16);
    const dek = await generateDek();
    const keyCheck = await createKeyCheck(dek);

    const kek = await deriveKekFromPassphrase('correct-horse-battery-staple', salt, FAST_TEST_ITERATIONS);
    const wrapped = await wrapDek(dek, kek);

    const unwrapped = await unwrapDek(wrapped, kek);
    expect(unwrapped.extractable).toBe(false);
    expect(await verifyKeyCheck(keyCheck, unwrapped)).toBe(true);

    const wrongKek = await deriveKekFromPassphrase('wrong-passphrase', salt, FAST_TEST_ITERATIONS);
    await expect(unwrapDek(wrapped, wrongKek)).rejects.toThrow();

    const otherDek = await generateDek();
    expect(await verifyKeyCheck(keyCheck, otherDek)).toBe(false);
  });

  it('exports and imports recovery keys flexibly and supports full passphrase rotation', async () => {
    const originalDek = await generateDek();
    const keyCheck = await createKeyCheck(originalDek);
    const noteEncrypted = await encryptText('recovery target memo', originalDek);

    const recoveryKey = await exportRecoveryKey(originalDek);
    expect(recoveryKey).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4})+$/);

    // Tolerates lowercase, whitespace, and removed hyphens
    const normalizedInput = recoveryKey.toLowerCase().replace(/-/g, ' ');
    const recoveredDek = await importRecoveryKey(normalizedInput, true);
    expect(await verifyKeyCheck(keyCheck, recoveredDek)).toBe(true);
    expect(await decryptText(noteEncrypted.ciphertext, noteEncrypted.iv, recoveredDek)).toBe(
      'recovery target memo',
    );

    // Re-wrap under a new passphrase
    const newSalt = generateSalt(16);
    const newKek = await deriveKekFromPassphrase('NewStrongPassphrase!99', newSalt, FAST_TEST_ITERATIONS);
    const newWrapped = await wrapDek(recoveredDek, newKek);

    const sessionDek = await unwrapDek(newWrapped, newKek);
    expect(await verifyKeyCheck(keyCheck, sessionDek)).toBe(true);
    expect(await decryptText(noteEncrypted.ciphertext, noteEncrypted.iv, sessionDek)).toBe(
      'recovery target memo',
    );
  });

  it('rejects malformed or wrong-length recovery keys', async () => {
    await expect(importRecoveryKey('')).rejects.toThrow();
    await expect(importRecoveryKey('INVALID-0189-CHARS')).rejects.toThrow();
    await expect(importRecoveryKey('AAAA-BBBB-CCCC')).rejects.toThrow();
  });

  it('evaluates passphrase strength accurately', () => {
    expect(evaluatePassphraseStrength('').isValid).toBe(false);
    expect(evaluatePassphraseStrength('short').isValid).toBe(false);
    expect(evaluatePassphraseStrength('longenough').isValid).toBe(true);
    expect(evaluatePassphraseStrength('Str0ng!Passphrase2026').score).toBe(4);
  });
});
