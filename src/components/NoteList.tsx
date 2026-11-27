import { Plus, Search, X } from 'lucide-react';
import type { NoteListItem } from '../lib/notes';

interface NoteListProps {
  notes: NoteListItem[];
  selectedNoteId: string | null;
  searchQuery: string;
  selectedTag: string | null;
  allTags: string[];
  onSearchChange: (value: string) => void;
  onSelectTag: (tag: string | null) => void;
  onSelectNote: (noteId: string) => void;
  onCreateNew: () => void;
}

function formatUpdatedAt(note: NoteListItem): string {
  if (!note.updatedAt) {
    return note.hasPendingWrites ? 'ローカル保存済み' : 'たった今';
  }
  const date = note.updatedAt.toDate();
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function NoteList({
  notes,
  selectedNoteId,
  searchQuery,
  selectedTag,
  allTags,
  onSearchChange,
  onSelectTag,
  onSelectNote,
  onCreateNew,
}: NoteListProps) {
  return (
    <aside className="sidebar-pane" aria-label="メモ一覧">
      <div className="sidebar-controls">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onCreateNew}
        >
          <Plus size={18} aria-hidden="true" />
          <span>新規メモ</span>
        </button>

        <div className="search-box">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            className="text-input search-input"
            placeholder="タイトル・タグを検索..."
            aria-label="タイトル・タグを検索"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="btn btn-icon"
              style={{
                position: 'absolute',
                right: 2,
                background: 'transparent',
                minHeight: 34,
                minWidth: 34,
              }}
              onClick={() => onSearchChange('')}
              aria-label="検索をクリア"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="tag-filter-row" role="group" aria-label="タグで絞り込み">
            <button
              type="button"
              className={`tag-pill ${selectedTag === null ? 'active' : ''}`}
              onClick={() => onSelectTag(null)}
            >
              すべて
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`tag-pill ${selectedTag === tag ? 'active' : ''}`}
                onClick={() => onSelectTag(selectedTag === tag ? null : tag)}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="notes-scroll" role="list">
        {notes.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center' }} className="hint">
            {searchQuery || selectedTag
              ? '一致するメモが見つかりません。'
              : 'メモがまだありません。「新規メモ」から作成できます。'}
          </div>
        ) : (
          notes.map((note) => (
            <button
              key={note.id}
              type="button"
              role="listitem"
              className={`note-card ${selectedNoteId === note.id ? 'selected' : ''}`}
              onClick={() => onSelectNote(note.id)}
              aria-current={selectedNoteId === note.id ? 'true' : undefined}
            >
              <div className="note-card-title">{note.title || '無題のメモ'}</div>
              <div className="note-card-meta">
                <span>{formatUpdatedAt(note)}</span>
                {note.hasPendingWrites && (
                  <span style={{ color: 'var(--color-warn)', fontWeight: 600 }}>
                    同期待ち
                  </span>
                )}
              </div>
              {note.tags.length > 0 && (
                <div className="note-tags-inline">
                  {note.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="tag-chip">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
