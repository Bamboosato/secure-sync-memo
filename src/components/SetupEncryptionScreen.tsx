import { type FormEvent, useState } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldAlert } from 'lucide-react';
import { MIN_PASSPHRASE_LENGTH, evaluatePassphraseStrength } from '../lib/crypto';
import {
  type PendingEncryptionSetup,
  type UserKeyDocument,
  commitUserEncryption,
  prepareUserEncryption,
} from '../lib/userKey';

interface SetupEncryptionScreenProps {
  uid: string;
  userEmail: string | null;
  onComplete: (dek: CryptoKey, keyDoc: UserKeyDocument) => void;
  onSignOut: () => void;
}

export function SetupEncryptionScreen({
  uid,
  userEmail,
  onComplete,
  onSignOut,
}: SetupEncryptionScreenProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingSetup, setPendingSetup] = useState<PendingEncryptionSetup | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const strength = evaluatePassphraseStrength(passphrase);
  const matches = passphrase === confirmPassphrase;

  const handlePrepare = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!strength.isValid) {
      setError(`マスターパスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上で入力してください。`);
      return;
    }
    if (!matches) {
      setError('確認用パスフレーズが一致しません。');
      return;
    }

    setIsGenerating(true);
    try {
      const prepared = await prepareUserEncryption(passphrase);
      setPendingSetup(prepared);
      setSavedConfirmed(false);
      setCopied(false);
    } catch {
      setError('暗号化鍵の生成に失敗しました。ブラウザの Web Crypto API を確認してください。');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyRecoveryKey = async () => {
    if (!pendingSetup) return;
    try {
      await navigator.clipboard.writeText(pendingSetup.recoveryKey);
      setCopied(true);
    } catch {
      setError('クリップボードへのコピーに失敗しました。手動で選択してコピーしてください。');
    }
  };

  const handleCommit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pendingSetup || !savedConfirmed) return;
    setError(null);
    setIsCommitting(true);
    try {
      const keyDoc = await commitUserEncryption(uid, pendingSetup);
      onComplete(pendingSetup.sessionDek, keyDoc);
    } catch {
      setError('Firestore への鍵設定保存に失敗しました。通信状態と権限を確認してください。');
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <main className="center-screen">
      <section className="auth-card" aria-labelledby="setup-title">
        <div className="auth-brand">
          <div className="auth-brand-icon" aria-hidden="true">
            <KeyRound size={22} />
          </div>
          <div>
            <h1 id="setup-title" className="auth-title">
              初回暗号化セットアップ
            </h1>
            <p className="auth-subtitle">
              {userEmail ? `${userEmail} のデータ暗号化鍵を作成します` : 'データ暗号化鍵を作成します'}
            </p>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {!pendingSetup ? (
          <form onSubmit={handlePrepare} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
              <label htmlFor="setup-passphrase">マスターパスフレーズ</label>
              <ul id="setup-passphrase-rules" className="rules-list">
                <li>{MIN_PASSPHRASE_LENGTH}文字以上（12文字以上・記号混在を推奨）</li>
                <li>サーバーには保存されず、忘れるとメモを復号できません</li>
              </ul>
              <div className="input-row">
                <input
                  id="setup-passphrase"
                  type={showPassphrase ? 'text' : 'password'}
                  className="text-input"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  required
                  minLength={MIN_PASSPHRASE_LENGTH}
                  autoComplete="new-password"
                  aria-describedby="setup-passphrase-rules"
                  data-error="setup-passphrase-error"
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
              <div id="setup-passphrase-error" className="error-msg">
                <span role="img" aria-label="Error">❌</span> {MIN_PASSPHRASE_LENGTH}文字以上のマスターパスフレーズを入力してください。
              </div>

              <div className="strength-meter" aria-live="polite">
                <div className="strength-bars" aria-hidden="true">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`strength-bar ${
                        strength.score >= level ? `active-${strength.score}` : ''
                      }`}
                    />
                  ))}
                </div>
                <span className="hint">強度: {strength.label}</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="setup-confirm">マスターパスフレーズ（確認）</label>
              <input
                id="setup-confirm"
                type={showPassphrase ? 'text' : 'password'}
                className="text-input"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                required
                minLength={MIN_PASSPHRASE_LENGTH}
                autoComplete="new-password"
                data-error="setup-confirm-error"
              />
              <div id="setup-confirm-error" className="error-msg">
                <span role="img" aria-label="Error">❌</span> 同じパスフレーズを再入力してください。
              </div>
              {confirmPassphrase.length > 0 && !matches && (
                <span className="hint" style={{ color: 'var(--color-danger)' }}>
                  パスフレーズが一致していません。
                </span>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={18} className="spin" aria-hidden="true" />
                  <span>鍵を生成中（PBKDF2 600,000回）...</span>
                </>
              ) : (
                <span>暗号化鍵とリカバリーキーを生成</span>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCommit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="alert alert-warn">
              <ShieldAlert size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                以下の<strong>リカバリーキーはこの画面で 1 度だけ表示</strong>されます。
                パスフレーズを忘れた場合の唯一の復元手段となるため、パスワードマネージャー等に必ず控えてください。
              </div>
            </div>

            <div className="recovery-box" aria-label="リカバリーキー">
              {pendingSetup.recoveryKey}
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCopyRecoveryKey}
            >
              {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
              <span>{copied ? 'コピーしました' : 'リカバリーキーをコピー'}</span>
            </button>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={(e) => setSavedConfirmed(e.target.checked)}
              />
              <span>リカバリーキーを安全な場所に控えました</span>
            </label>

            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPendingSetup(null)}
                disabled={isCommitting}
              >
                戻る
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!savedConfirmed || isCommitting}
              >
                {isCommitting ? '登録中...' : 'セットアップを完了して開始'}
              </button>
            </div>
          </form>
        )}

        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSignOut}
          disabled={isGenerating || isCommitting}
        >
          <LogOut size={16} aria-hidden="true" />
          <span>別のアカウントに切り替え（ログアウト）</span>
        </button>
      </section>
    </main>
  );
}
