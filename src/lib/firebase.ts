import { FirebaseError, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.storageBucket &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId,
);

if (!isFirebaseConfigured) {
  throw new Error(
    'Firebase configuration is missing. Check VITE_FIREBASE_* variables in .env.local.',
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export function formatAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'ログインウィンドウが閉じられました。もう一度お試しください。';
      case 'auth/popup-blocked':
        return 'ポップアップがブロックされました。ブラウザのポップアップ許可を確認してください。';
      case 'auth/unauthorized-domain':
        return '現在のドメインが Firebase Authentication の承認済みドメインに登録されていません。';
      case 'auth/network-request-failed':
        return 'ネットワークに接続できません。通信状態を確認してください。';
      default:
        return `サインインに失敗しました (${error.code})。`;
    }
  }
  return 'サインイン中に予期しないエラーが発生しました。';
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth, googleProvider);
}

/**
 * Signs out of Firebase Auth, wipes in-memory state via callback,
 * terminates Firestore, clears IndexedDB offline persistence, and reloads.
 */
export async function secureSignOut(beforeSignOut?: () => void): Promise<void> {
  beforeSignOut?.();
  await signOut(auth);
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    // Another open tab may hold the IndexedDB lock; reloading still clears memory state.
  }
  window.location.reload();
}
