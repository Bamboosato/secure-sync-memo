import { type FormEvent, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, LockOpen, LogOut, RotateCcw } from 'lucide-react';
import { MIN_PASSPHRASE_LENGTH } from '../lib/crypto';
import {
  type UserKeyDocument,
  recoverWithRecoveryKey,
  unlockWithPassphrase,
} from '../lib/userKey';

export interface UnlockResultOptions {
  rememberDevice: boolean;
  updatedKeyDoc?: UserKeyDocument;
}

interface UnlockScreenProps {
  uid: string;
  userEmail: string | null;
  keyDoc: UserKeyDocument;
  onUnlock: (dek: CryptoKey, options: UnlockResultOptions) => void;
  onSignOut: () => void;
}

export function UnlockScreen({
  uid,
  userEmail,
  keyDoc,
  onUnlock,
  onSignOut,
}: UnlockScreenProps) {
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);

  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmNewPassphrase, setConfirmNewPassphrase] = useState('');

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlockSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!passphrase) {
      setError('マスターパスフレーズを入力してください。');
      return;
    }

    setIsProcessing(true);
    try {
      const dek = await unlockWithPassphrase(keyDoc, passphrase);
      setPassphrase('');
      onUnlock(dek, { rememberDevice });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'ロック解除に失敗しました。',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRecoverySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      setError(`新しいパスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上で入力してください。`);
      return;
    }
    if (newPassphrase !== confirmNewPassphrase) {
      setError('新しいパスフレーズ（確認）が一致しません。');
      return;
    }

    setIsProcessing(true);
    try {
      const { dek, updatedDoc } = await recoverWithRecoveryKey(
        uid,
        keyDoc,
        recoveryKey,
        newPassphrase,
      );
      setRecoveryKey('');
      setNewPassphrase('');
      setConfirmNewPassphrase('');
      onUnlock(dek, { rememberDevice, updatedKeyDoc: updatedDoc });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'リカバリーキーでの復元に失敗しました。',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="center-screen">
      <section className="auth-card" aria-labelledby="unlock-title">
        <div className="auth-brand">
          <div className="auth-brand-icon" aria-hidden="true">
            {mode === 'passphrase' ? <LockOpen size={22} /> : <KeyRound size={22} />}
          </div>
          <div>
            <h1 id="unlock-title" className="auth-title">
              {mode === 'passphrase' ? 'メモのロック解除' : 'リカバリーキーで復元'}
            </h1>
            <p className="auth-subtitle">
              {userEmail ? `${userEmail} でログイン中` : '暗号化キーを復号します'}
            </p>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {mode === 'passphrase' ? (
          <form onSubmit={handleUnlockSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {userEmail && (
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={userEmail}
                readOnly
                tabIndex={-1}
                aria-label="ログイン中のメールアドレス"
                className="visually-hidden"
              />
            )}

            <div className="field">
              <label htmlFor="unlock-passphrase">マスターパスフレーズ</label>
              <div className="input-row">
                <input
                  id="unlock-passphrase"
                  name="password"
                  type={showPassphrase ? 'text' : 'password'}
                  className="text-input"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  required
                  autoComplete="current-password"
                  data-error="unlock-passphrase-error"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  onClick={() => setShowPassphrase((v) => !v)}
                  aria-label={showPassphrase ? 'パスフレーズを隠す' : 'パスフレーズを表示'}
                >
                  {showPassphrase ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div id="unlock-passphrase-error" className="error-msg">
                <span role="img" aria-label="Error">❌</span> マスターパスフレーズを入力してください。
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                disabled={isProcessing}
              />
              <span>
                <strong>この端末では次回からパスフレーズを省略する</strong>
                <span className="hint">
                  個人用スマホ・PC 向け（共有端末ではオフにしてください）
                </span>
              </span>
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={18} className="spin" aria-hidden="true" />
                  <span>鍵を導出して復号中...</span>
                </>
              ) : (
                <>
                  <LockOpen size={18} aria-hidden="true" />
                  <span>ロック解除</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setError(null);
                setMode('recovery');
              }}
              disabled={isProcessing}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>リカバリーキーで復元する</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleRecoverySubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {userEmail && (
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={userEmail}
                readOnly
                tabIndex={-1}
                aria-label="ログイン中のメールアドレス"
                className="visually-hidden"
              />
            )}

            <div className="field">
              <label htmlFor="recovery-key-input">リカバリーキー</label>
              <span id="recovery-key-hint" className="hint">
                初回セットアップ時に控えた Base32 文字列（ハイフン有無・大小文字は問いません）
              </span>
              <input
                id="recovery-key-input"
                type="text"
                className="text-input"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                required
                autoComplete="off"
                aria-describedby="recovery-key-hint"
                data-error="recovery-key-error"
                autoFocus
              />
              <div id="recovery-key-error" className="error-msg">
                <span role="img" aria-label="Error">❌</span> リカバリーキーを入力してください。
              </div>
            </div>

            <div className="field">
              <label htmlFor="recovery-new-pass">新しいマスターパスフレーズ</label>
              <ul id="recovery-pass-rules" className="rules-list">
                <li>{MIN_PASSPHRASE_LENGTH}文字以上で入力してください</li>
              </ul>
              <input
                id="recovery-new-pass"
                name="password"
                type={showPassphrase ? 'text' : 'password'}
                className="text-input"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                required
                minLength={MIN_PASSPHRASE_LENGTH}
                autoComplete="new-password"
                aria-describedby="recovery-pass-rules"
                data-error="recovery-new-pass-error"
              />
              <div id="recovery-new-pass-error" className="error-msg">
                <span role="img" aria-label="Error">❌</span> {MIN_PASSPHRASE_LENGTH}文字以上の新しいパスフレーズを入力してください。
              </div>
            </div>

            <div className="field">
              <label htmlFor="recovery-confirm-pass">新しいマスターパスフレーズ（確認）</label>
              <input
                id="recovery-confirm-pass"
                type={showPassphrase ? 'text' : 'password'}
                className="text-input"
                value={confirmNewPassphrase}
                onChange={(e) => setConfirmNewPassphrase(e.target.value)}
                required
                minLength={MIN_PASSPHRASE_LENGTH}
                autoComplete="new-password"
                data-error="recovery-confirm-error"
              />
              <div id="recovery-confirm-error" className="error-msg">
                <span role="img" aria-label="Error">❌</span> 確認用の新しいパスフレーズを入力してください。
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                disabled={isProcessing}
              />
              <span>
                <strong>この端末では次回からパスフレーズを省略する</strong>
                <span className="hint">
                  個人用スマホ・PC 向け（共有端末ではオフにしてください）
                </span>
              </span>
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isProcessing}
            >
              {isProcessing ? '復元して再暗号化中...' : '復元してパスフレーズを再設定'}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setError(null);
                setMode('passphrase');
              }}
              disabled={isProcessing}
            >
              パスフレーズ入力に戻る
            </button>
          </form>
        )}

        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSignOut}
          disabled={isProcessing}
        >
          <LogOut size={16} aria-hidden="true" />
          <span>ログアウト（キャッシュ消去）</span>
        </button>
      </section>
    </main>
  );
}
