import { useState } from 'react';
import { Lock, LogIn, ShieldCheck } from 'lucide-react';
import { formatAuthError, signInWithGoogle } from '../lib/firebase';

export function LoginScreen() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="center-screen">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand">
          <div className="auth-brand-icon" aria-hidden="true">
            <Lock size={22} />
          </div>
          <div>
            <h1 id="login-title" className="auth-title">
              Secure Sync Memo
            </h1>
            <p className="auth-subtitle">
              端末間で暗号化同期する個人用セキュアメモ PWA
            </p>
          </div>
        </div>

        <div className="alert alert-success">
          <ShieldCheck size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            メモ本文はブラウザ内の Web Crypto API（AES-256-GCM）で暗号化されてから
            Cloud Firestore に保存されます。サーバーには平文本文を送信しません。
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGoogleSignIn}
          disabled={isSubmitting}
        >
          <LogIn size={18} aria-hidden="true" />
          <span>{isSubmitting ? 'サインイン中...' : 'Google アカウントでログイン'}</span>
        </button>
      </section>
    </main>
  );
}
