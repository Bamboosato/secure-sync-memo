import { Timestamp, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  DEFAULT_KDF_ITERATIONS,
  type EncryptedPayload,
  createKeyCheck,
  deriveKekFromPassphrase,
  exportRecoveryKey,
  generateDek,
  generateSalt,
  importRecoveryKey,
  unwrapDek,
  verifyKeyCheck,
  wrapDek,
} from './crypto';
import { db } from './firebase';

export interface UserKeyDocument {
  kdfSalt: string;
  kdfIterations: number;
  wrappedDek: EncryptedPayload;
  keyCheck: EncryptedPayload;
  updatedAt: Timestamp | null;
}

export interface PendingEncryptionSetup {
  recoveryKey: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedDek: EncryptedPayload;
  keyCheck: EncryptedPayload;
  sessionDek: CryptoKey;
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.iv === 'string' && typeof candidate.data === 'string';
}

export async function fetchUserKeyDoc(uid: string): Promise<UserKeyDocument | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) {
    return null;
  }
  const data = snap.data();
  if (
    typeof data.kdfSalt !== 'string' ||
    typeof data.kdfIterations !== 'number' ||
    !isEncryptedPayload(data.wrappedDek) ||
    !isEncryptedPayload(data.keyCheck)
  ) {
    throw new Error('暗号化設定ドキュメントの形式が不正です。');
  }
  return {
    kdfSalt: data.kdfSalt,
    kdfIterations: data.kdfIterations,
    wrappedDek: data.wrappedDek,
    keyCheck: data.keyCheck,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
  };
}

/**
 * Generates DEK, KEK, wrappedDek, keyCheck, and 1-time recovery key in memory.
 * Persistence is deferred until the user confirms saving the recovery key.
 */
export async function prepareUserEncryption(
  passphrase: string,
): Promise<PendingEncryptionSetup> {
  const kdfSalt = generateSalt(16);
  const kdfIterations = DEFAULT_KDF_ITERATIONS;
  const extractableDek = await generateDek();
  const recoveryKey = await exportRecoveryKey(extractableDek);
  const kek = await deriveKekFromPassphrase(passphrase, kdfSalt, kdfIterations);
  const wrappedDek = await wrapDek(extractableDek, kek);
  const keyCheck = await createKeyCheck(extractableDek);
  const sessionDek = await unwrapDek(wrappedDek, kek, false);

  return {
    recoveryKey,
    kdfSalt,
    kdfIterations,
    wrappedDek,
    keyCheck,
    sessionDek,
  };
}

export async function commitUserEncryption(
  uid: string,
  setup: PendingEncryptionSetup,
): Promise<UserKeyDocument> {
  await setDoc(doc(db, 'users', uid), {
    kdfSalt: setup.kdfSalt,
    kdfIterations: setup.kdfIterations,
    wrappedDek: setup.wrappedDek,
    keyCheck: setup.keyCheck,
    updatedAt: serverTimestamp(),
  });

  return {
    kdfSalt: setup.kdfSalt,
    kdfIterations: setup.kdfIterations,
    wrappedDek: setup.wrappedDek,
    keyCheck: setup.keyCheck,
    updatedAt: null,
  };
}

export async function unlockWithPassphrase(
  keyDoc: UserKeyDocument,
  passphrase: string,
): Promise<CryptoKey> {
  try {
    const kek = await deriveKekFromPassphrase(
      passphrase,
      keyDoc.kdfSalt,
      keyDoc.kdfIterations,
    );
    const dek = await unwrapDek(keyDoc.wrappedDek, kek, false);
    const isValid = await verifyKeyCheck(keyDoc.keyCheck, dek);
    if (!isValid) {
      throw new Error('マスターパスフレーズが正しくありません。');
    }
    return dek;
  } catch {
    throw new Error('マスターパスフレーズが正しくありません。');
  }
}

export async function recoverWithRecoveryKey(
  uid: string,
  keyDoc: UserKeyDocument,
  recoveryKey: string,
  newPassphrase: string,
): Promise<{ dek: CryptoKey; updatedDoc: UserKeyDocument }> {
  let importedDek: CryptoKey;
  try {
    importedDek = await importRecoveryKey(recoveryKey, true);
  } catch {
    throw new Error('リカバリーキーの形式が正しくありません。');
  }

  const isValid = await verifyKeyCheck(keyDoc.keyCheck, importedDek);
  if (!isValid) {
    throw new Error('リカバリーキーが一致しません。');
  }

  const kdfSalt = generateSalt(16);
  const kdfIterations = DEFAULT_KDF_ITERATIONS;
  const newKek = await deriveKekFromPassphrase(newPassphrase, kdfSalt, kdfIterations);
  const wrappedDek = await wrapDek(importedDek, newKek);
  const sessionDek = await unwrapDek(wrappedDek, newKek, false);

  await setDoc(doc(db, 'users', uid), {
    kdfSalt,
    kdfIterations,
    wrappedDek,
    keyCheck: keyDoc.keyCheck,
    updatedAt: serverTimestamp(),
  });

  return {
    dek: sessionDek,
    updatedDoc: {
      kdfSalt,
      kdfIterations,
      wrappedDek,
      keyCheck: keyDoc.keyCheck,
      updatedAt: null,
    },
  };
}

export async function changeMasterPassphrase(
  uid: string,
  keyDoc: UserKeyDocument,
  currentPassphrase: string,
  newPassphrase: string,
): Promise<UserKeyDocument> {
  let extractableDek: CryptoKey;
  try {
    const currentKek = await deriveKekFromPassphrase(
      currentPassphrase,
      keyDoc.kdfSalt,
      keyDoc.kdfIterations,
    );
    extractableDek = await unwrapDek(keyDoc.wrappedDek, currentKek, true);
    const isValid = await verifyKeyCheck(keyDoc.keyCheck, extractableDek);
    if (!isValid) {
      throw new Error('現在のマスターパスフレーズが正しくありません。');
    }
  } catch {
    throw new Error('現在のマスターパスフレーズが正しくありません。');
  }

  const kdfSalt = generateSalt(16);
  const kdfIterations = DEFAULT_KDF_ITERATIONS;
  const newKek = await deriveKekFromPassphrase(newPassphrase, kdfSalt, kdfIterations);
  const wrappedDek = await wrapDek(extractableDek, newKek);

  await setDoc(doc(db, 'users', uid), {
    kdfSalt,
    kdfIterations,
    wrappedDek,
    keyCheck: keyDoc.keyCheck,
    updatedAt: serverTimestamp(),
  });

  return {
    kdfSalt,
    kdfIterations,
    wrappedDek,
    keyCheck: keyDoc.keyCheck,
    updatedAt: null,
  };
}
