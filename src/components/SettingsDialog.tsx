import { type FormEvent, useEffect, useRef, useState } from 'react';
import { KeyRound, Lock, LogOut, X } from 'lucide-react';
import { MIN_PASSPHRASE_LENGTH } from '../lib/crypto';
import { attachDialogLightDismissFallback } from '../lib/formValidation';
import { type UserKeyDocument, changeMasterPassphrase } from '../lib/userKey';

export type SyncMode = 'manual' | 'auto';

interface SettingsDialogProps {
  open: boolean;
  uid: string;
  userEmail: string | null;
  keyDoc: UserKeyDocument;
  syncMode: SyncMode;
  rememberDevice: boolean;
  onSyncModeChange: (mode: SyncMode) => void;
  onRememberDeviceChange: (enabled: boolean) => void;
  onKeyDocUpdated: (updated: UserKeyDocument) => void;
  onLockNow: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

export function SettingsDialog({
  open,
  uid,
  userEmail,
  keyDoc,
  syncMode,
  rememberDevice,
  onSyncModeChange,
  onRememberDeviceChange,
  onKeyDocUpdated,
  onLockNow,
  onSignOut,
  onClose,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [discardNotice, setDiscardNotice] = useState(false);

  const isFormDirty = Boolean(
    currentPassphrase || newPassphrase || confirmPassphrase,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setError(null);
      setSuccessMsg(null);
      setDiscardNotice(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, !isFormDirty);
  }, [isFormDirty]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      if (isFormDirty) {
        e.preventDefault();
        setDiscardNotice(true);
      }
    };

    const handleClose = () => {
      dialog.returnValue = '';
      setCurrentPassphrase('');
      setNewPassphrase('');
      setConfirmPassphrase('');
      setDiscardNotice(false);
      onClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, [isFormDirty, onClose]);

  const handlePassphraseSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      setError(`新しいパスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上で入力してください。`);
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      setError('新しいパスフレーズ（確認）が一致しません。');
      return;
    }

    setIsUpdating(true);
    try {
      const updated = await changeMasterPassphrase(
        uid,
        keyDoc,
        currentPassphrase,
        newPassphrase,
      );
      onKeyDocUpdated(updated);
      setCurrentPassphrase('');
      setNewPassphrase('');
      setConfirmPassphrase('');
      setDiscardNotice(false);
      setSuccessMsg('マスターパスフレーズを更新しました（DEK を新しい鍵で再ラップしました）。');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'パスフレーズの変更に失敗しました。',
      );
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="settings-title"
      {...({ closedby: isFormDirty ? 'none' : 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <h1 id="settings-title" className="dialog-title">
          設定・セキュリティ
        </h1>
        <button
          type="button"
          className="btn btn-secondary btn-icon"
          onClick={() => dialogRef.current?.close()}
          aria-label="設定を閉じる"
        >
          <X size={18} />
        </button>
      </div>

      <div className="dialog-body">
        {userEmail && (
          <div className="hint">
            ログイン中のアカウント: <strong>{userEmail}</strong>
          </div>
        )}

        <div className="field">
          <label htmlFor="sync-mode-select">同期モード</label>
          <span className="hint">
            手動保存は Spark 無料枠の書き込み回数を節約できます。
          </span>
          <select
            id="sync-mode-select"
            className="text-input"
            value={syncMode}
            onChange={(e) => onSyncModeChange(e.target.value as SyncMode)}
          >
            <option value="manual">手動保存（「保存・同期」ボタン / Ctrl+S）</option>
            <option value="auto">自動保存（入力停止 2 秒後に暗号化同期）</option>
          </select>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(e) => onRememberDeviceChange(e.target.checked)}
          />
          <span>
            <strong>この端末では次回からパスフレーズを省略する</strong>
            <span className="hint">
              非抽出型の暗号化鍵のみを端末内（IndexedDB）に保持します。共有端末ではオフにしてください。
            </span>
          </span>
        </label>

        <hr style={{ width: '100%', border: 'none', borderTop: '1px solid var(--border-color)' }} />

        <form
          onSubmit={handlePassphraseSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}>
            <KeyRound size={17} aria-hidden="true" />
            <span>マスターパスフレーズの変更</span>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="alert alert-success" role="status">
              <span>{successMsg}</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="settings-current-pass">現在のマスターパスフレーズ</label>
            <input
              id="settings-current-pass"
              type="password"
              className="text-input"
              value={currentPassphrase}
              onChange={(e) => setCurrentPassphrase(e.target.value)}
              required
              autoComplete="current-password"
              data-error="settings-current-error"
            />
            <div id="settings-current-error" className="error-msg">
              <span role="img" aria-label="Error">❌</span> 現在のマスターパスフレーズを入力してください。
            </div>
          </div>

          <div className="field">
            <label htmlFor="settings-new-pass">新しいマスターパスフレーズ</label>
            <ul id="settings-new-pass-rules" className="rules-list">
              <li>{MIN_PASSPHRASE_LENGTH}文字以上で入力してください</li>
            </ul>
            <input
              id="settings-new-pass"
              type="password"
              className="text-input"
              value={newPassphrase}
              onChange={(e) => setNewPassphrase(e.target.value)}
              required
              minLength={MIN_PASSPHRASE_LENGTH}
              autoComplete="new-password"
              aria-describedby="settings-new-pass-rules"
              data-error="settings-new-error"
            />
            <div id="settings-new-error" className="error-msg">
              <span role="img" aria-label="Error">❌</span> {MIN_PASSPHRASE_LENGTH}文字以上の新しいパスフレーズを入力してください。
            </div>
          </div>

          <div className="field">
            <label htmlFor="settings-confirm-pass">新しいマスターパスフレーズ（確認）</label>
            <input
              id="settings-confirm-pass"
              type="password"
              className="text-input"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              required
              minLength={MIN_PASSPHRASE_LENGTH}
              autoComplete="new-password"
              data-error="settings-confirm-error"
            />
            <div id="settings-confirm-error" className="error-msg">
              <span role="img" aria-label="Error">❌</span> 同じ新しいパスフレーズを再入力してください。
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={isUpdating}>
            {isUpdating ? '再ラップして保存中...' : 'パスフレーズを変更'}
          </button>
        </form>

        <div
          id="settings-dirty-warning"
          className="alert alert-warn"
          style={{ visibility: discardNotice ? 'visible' : 'hidden' }}
        >
          <span>入力中のパスフレーズ変更が未保存です。閉じる場合は × ボタンを押してください。</span>
        </div>

        <hr style={{ width: '100%', border: 'none', borderTop: '1px solid var(--border-color)' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              dialogRef.current?.close();
              onLockNow();
            }}
          >
            <Lock size={16} aria-hidden="true" />
            <span>今すぐロック（メモリ・端末キャッシュの鍵を破棄）</span>
          </button>

          <button
            type="button"
            className="btn btn-danger-outline"
            onClick={onSignOut}
          >
            <LogOut size={16} aria-hidden="true" />
            <span>ログアウト（ローカルキャッシュを消去）</span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
