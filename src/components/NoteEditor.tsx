import { type KeyboardEvent, useEffect, useState } from 'react';
import { ArrowLeft, Pin, Plus, Save, Tag, Trash2, X } from 'lucide-react';
import { MarkdownPreview } from './MarkdownPreview';

interface NoteEditorProps {
  hasSelection: boolean;
  isNewDraft: boolean;
  isPinned: boolean;
  title: string;
  tags: string[];
  body: string;
  isDirty: boolean;
  isSaving: boolean;
  isDecrypting: boolean;
  decryptError: string | null;
  onTitleChange: (value: string) => void;
  onTagsChange: (tags: string[]) => void;
  onBodyChange: (value: string) => void;
  onTogglePin: () => void;
  onSave: () => void;
  onDeleteRequest: () => void;
  onBackToList: () => void;
  onCreateNew: () => void;
}

export function NoteEditor({
  hasSelection,
  isNewDraft,
  isPinned,
  title,
  tags,
  body,
  isDirty,
  isSaving,
  isDecrypting,
  decryptError,
  onTitleChange,
  onTagsChange,
  onBodyChange,
  onTogglePin,
  onSave,
  onDeleteRequest,
  onBackToList,
  onCreateNew,
}: NoteEditorProps) {
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (!hasSelection) return;
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasSelection, onSave]);

  const addTag = () => {
    const trimmed = tagDraft.trim().slice(0, 64);
    if (!trimmed) return;
    if (!tags.includes(trimmed) && tags.length < 20) {
      onTagsChange([...tags, trimmed]);
    }
    setTagDraft('');
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  };

  if (!hasSelection) {
    return (
      <section className="editor-pane" aria-label="メモ詳細">
        <div className="editor-empty">
          <p>左の一覧からメモを選択するか、新しく作成してください。</p>
          <button type="button" className="btn btn-primary" onClick={onCreateNew}>
            <Plus size={18} aria-hidden="true" />
            <span>新規メモを作成</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="editor-pane" aria-label="メモ編集">
      <div className="editor-topbar">
        <button
          type="button"
          className="btn btn-secondary mobile-only"
          onClick={onBackToList}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>一覧</span>
        </button>

        <div className="editor-tabs" role="tablist" aria-label="表示切り替え">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'edit'}
            className={`editor-tab ${viewMode === 'edit' ? 'active' : ''}`}
            onClick={() => setViewMode('edit')}
          >
            編集
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'preview'}
            className={`editor-tab ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => setViewMode('preview')}
          >
            プレビュー
          </button>
        </div>

        <div className="editor-topbar-actions">
          <button
            type="button"
            className={`btn btn-secondary btn-pin-toggle ${isPinned ? 'active' : ''}`}
            aria-pressed={isPinned}
            onClick={onTogglePin}
            disabled={isSaving}
            aria-label={isPinned ? 'ピン止めを解除' : 'このメモをピン止め'}
            title={isPinned ? 'ピン止めを解除' : 'このメモをピン止め'}
          >
            <Pin size={15} aria-hidden="true" className={isPinned ? 'pin-icon-filled' : undefined} />
            <span>{isPinned ? 'ピン止め中' : 'ピン止め'}</span>
          </button>

          <span className="hint editor-shortcut-hint" style={{ fontSize: '0.75rem' }}>
            Ctrl / Cmd + S で保存
          </span>
        </div>
      </div>

      <div className="editor-body-wrap">
        {decryptError && (
          <div className="alert alert-error" role="alert">
            <span>{decryptError}</span>
          </div>
        )}

        <input
          type="text"
          className="editor-title-input"
          placeholder="タイトル（一覧検索用に平文保存されます）"
          aria-label="メモのタイトル"
          maxLength={500}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />

        <div className="editor-tags-bar" aria-label="タグ">
          <Tag size={15} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />
          {tags.map((tag) => (
            <span key={tag} className="tag-chip">
              <span>#{tag}</span>
              <button
                type="button"
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  display: 'inline-flex',
                }}
                onClick={() => onTagsChange(tags.filter((t) => t !== tag))}
                aria-label={`タグ ${tag} を削除`}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          {tags.length < 20 && (
            <input
              type="text"
              className="text-input tag-add-input"
              placeholder="タグを追加 (Enter)"
              aria-label="タグを追加"
              maxLength={64}
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={addTag}
            />
          )}
        </div>

        {isDecrypting ? (
          <div className="editor-empty">
            <p>メモ本文を復号中...</p>
          </div>
        ) : viewMode === 'edit' ? (
          <textarea
            className="text-area editor-textarea"
            placeholder="ここにメモを入力（この本文は AES-256-GCM で暗号化されて保存されます）..."
            aria-label="メモ本文"
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
          />
        ) : (
          <MarkdownPreview content={body} />
        )}
      </div>

      <div className="editor-actionbar">
        <button
          type="button"
          className="btn btn-danger-outline"
          onClick={onDeleteRequest}
          disabled={isNewDraft || isSaving}
        >
          <Trash2 size={17} aria-hidden="true" />
          <span>削除</span>
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={isSaving || isDecrypting || (!isDirty && !isNewDraft)}
        >
          <Save size={17} aria-hidden="true" />
          <span>{isSaving ? '暗号化・保存中...' : '保存・同期'}</span>
        </button>
      </div>
    </section>
  );
}
