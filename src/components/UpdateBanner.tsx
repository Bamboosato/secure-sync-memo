import { RefreshCw, X } from 'lucide-react';

interface UpdateBannerProps {
  visible: boolean;
  isUpdating: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({
  visible,
  isUpdating,
  onUpdate,
  onDismiss,
}: UpdateBannerProps) {
  if (!visible) {
    return null;
  }

  return (
    <aside
      className="update-banner"
      role="status"
      aria-live="polite"
      aria-label="アプリの更新通知"
    >
      <div className="update-banner-message">
        <RefreshCw
          size={16}
          aria-hidden="true"
          className={isUpdating ? 'spin' : undefined}
        />
        <span>新しいバージョンが利用可能です</span>
      </div>

      <div className="update-banner-actions">
        <button
          type="button"
          className="btn btn-primary update-banner-btn"
          onClick={onUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? '更新中...' : '今すぐ更新'}
        </button>

        <button
          type="button"
          className="btn btn-secondary btn-icon update-banner-close"
          onClick={onDismiss}
          disabled={isUpdating}
          aria-label="更新通知を閉じる"
          title="閉じる"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
