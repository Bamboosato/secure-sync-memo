import { useEffect, useRef } from 'react';
import { attachDialogLightDismissFallback } from '../lib/formValidation';

interface ConfirmDeleteDialogProps {
  open: boolean;
  noteTitle: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDeleteDialog({
  open,
  noteTitle,
  onConfirm,
  onClose,
}: ConfirmDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, true);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      const result = dialog.returnValue;
      dialog.returnValue = '';
      if (result === 'delete') {
        onConfirm();
      }
      onClose();
    };

    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose, onConfirm]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-delete-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <h1 id="confirm-delete-title" className="dialog-title">
          メモを削除しますか？
        </h1>
      </div>
      <div className="dialog-body">
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          「<strong>{noteTitle || '無題のメモ'}</strong>」を削除します。削除は同期中の全端末に反映されます。
        </p>
      </div>
      <form method="dialog" className="dialog-footer">
        <button type="submit" value="cancel" className="btn btn-secondary" autoFocus>
          キャンセル
        </button>
        <button type="submit" value="delete" className="btn btn-danger">
          削除する
        </button>
      </form>
    </dialog>
  );
}
