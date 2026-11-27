import { useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, Loader2, RefreshCw } from 'lucide-react';

export interface SyncStatusBadgeProps {
  isOnline: boolean;
  isDirty: boolean;
  isSaving: boolean;
  hasPendingWrites: boolean;
}

export function SyncStatusBadge({
  isOnline,
  isDirty,
  isSaving,
  hasPendingWrites,
}: SyncStatusBadgeProps) {
  const [showOnlinePending, setShowOnlinePending] = useState(false);

  useEffect(() => {
    if (!isOnline || isSaving || isDirty || !hasPendingWrites) {
      setShowOnlinePending(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowOnlinePending(true);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [isOnline, isSaving, isDirty, hasPendingWrites]);

  if (!isOnline) {
    const label =
      isDirty || hasPendingWrites ? 'オフライン（同期待ち）' : 'オフライン';
    return (
      <span className="sync-badge offline" role="status" aria-live="polite">
        <CloudOff size={14} aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }

  if (isSaving) {
    return (
      <span className="sync-badge pending" role="status" aria-live="polite">
        <Loader2 size={14} className="spin" aria-hidden="true" />
        <span>保存・暗号化中...</span>
      </span>
    );
  }

  if (isDirty) {
    return (
      <span className="sync-badge dirty" role="status" aria-live="polite">
        <RefreshCw size={14} aria-hidden="true" />
        <span>未保存の変更あり</span>
      </span>
    );
  }

  if (showOnlinePending) {
    return (
      <span className="sync-badge pending" role="status" aria-live="polite">
        <Loader2 size={14} className="spin" aria-hidden="true" />
        <span>同期待ち...</span>
      </span>
    );
  }

  return (
    <span className="sync-badge synced" role="status" aria-live="polite">
      <CheckCircle2 size={14} aria-hidden="true" />
      <span>同期済み</span>
    </span>
  );
}
