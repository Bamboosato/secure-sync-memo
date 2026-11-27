import { useCallback, useId, useMemo, useRef, useState } from 'react';
import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pin, Plus, Search, X } from 'lucide-react';
import type { NoteListItem } from '../lib/notes';

type NoteSectionKind = 'pinned' | 'unpinned';

interface NoteListProps {
  pinnedNotes: NoteListItem[];
  unpinnedNotes: NoteListItem[];
  selectedNoteId: string | null;
  searchQuery: string;
  selectedTag: string | null;
  allTags: string[];
  canReorder: boolean;
  onSearchChange: (value: string) => void;
  onSelectTag: (tag: string | null) => void;
  onSelectNote: (noteId: string) => void;
  onCreateNew: () => void;
  onTogglePin: (noteId: string) => void;
  onReorderNotes: (section: NoteSectionKind, activeId: string, overId: string) => void;
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

function noteLabel(note: NoteListItem | undefined): string {
  return note?.title || '無題のメモ';
}

interface SortableNoteCardProps {
  note: NoteListItem;
  isSelected: boolean;
  showReorderControls: boolean;
  onSelectNote: (noteId: string) => void;
  onTogglePin: (note: NoteListItem) => void;
}

function SortableNoteCard({
  note,
  isSelected,
  showReorderControls,
  onSelectNote,
  onTogglePin,
}: SortableNoteCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: note.id,
    disabled: !showReorderControls,
  });

  const title = noteLabel(note);
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'note-card',
        isSelected ? 'selected' : '',
        isDragging ? 'is-dragging' : '',
        !showReorderControls ? 'no-reorder' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showReorderControls && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="note-drag-handle"
          {...attributes}
          {...listeners}
          aria-label={`「${title}」をドラッグして並び替え`}
          title="ドラッグして並び替え"
        >
          <GripVertical size={15} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        className="note-card-main"
        onClick={() => onSelectNote(note.id)}
        aria-current={isSelected ? 'true' : undefined}
      >
        <div className="note-card-title">{title}</div>
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

      <div className="note-card-actions">
        <button
          type="button"
          className={`note-action-btn note-pin-btn ${note.isPinned ? 'pinned' : ''}`}
          aria-pressed={note.isPinned}
          aria-label={note.isPinned ? `「${title}」のピン止めを解除` : `「${title}」をピン止め`}
          title={note.isPinned ? 'ピン止めを解除' : 'ピン止め'}
          onClick={() => onTogglePin(note)}
        >
          <Pin
            size={14}
            aria-hidden="true"
            className={note.isPinned ? 'pin-icon-filled' : undefined}
          />
        </button>
      </div>
    </li>
  );
}

interface SortableNoteSectionProps {
  section: NoteSectionKind;
  headingText: string;
  hideHeadingVisually?: boolean;
  notes: NoteListItem[];
  selectedNoteId: string | null;
  canReorder: boolean;
  onSelectNote: (noteId: string) => void;
  onTogglePin: (note: NoteListItem) => void;
  onReorderNotes: (section: NoteSectionKind, activeId: string, overId: string) => void;
}

function SortableNoteSection({
  section,
  headingText,
  hideHeadingVisually = false,
  notes,
  selectedNoteId,
  canReorder,
  onSelectNote,
  onTogglePin,
  onReorderNotes,
}: SortableNoteSectionProps) {
  const headingId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const noteIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const indexById = useMemo(() => new Map(notes.map((n, idx) => [n.id, idx])), [notes]);

  const showReorderControls = canReorder && notes.length > 1;

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart({ active }) {
        const title = noteLabel(noteById.get(String(active.id)));
        return `「${title}」の移動を開始しました。上下矢印キーで位置を変更し、SpaceキーまたはEnterキーで確定、Escapeキーでキャンセルします。`;
      },
      onDragOver({ active, over }) {
        const title = noteLabel(noteById.get(String(active.id)));
        if (!over) {
          return `「${title}」を移動中`;
        }
        const overIndex = indexById.get(String(over.id));
        if (overIndex === undefined) {
          return undefined;
        }
        return `「${title}」は ${overIndex + 1} 番目の位置です`;
      },
      onDragEnd({ active, over }) {
        const title = noteLabel(noteById.get(String(active.id)));
        if (!over || active.id === over.id) {
          return `「${title}」の位置は変更されませんでした`;
        }
        const overIndex = indexById.get(String(over.id));
        if (overIndex === undefined) {
          return `「${title}」の移動を確定しました`;
        }
        return `「${title}」を ${overIndex + 1} 番目に移動しました`;
      },
      onDragCancel({ active }) {
        const title = noteLabel(noteById.get(String(active.id)));
        return `「${title}」の移動をキャンセルしました`;
      },
    }),
    [noteById, indexById],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !showReorderControls) {
      return;
    }
    onReorderNotes(section, String(active.id), String(over.id));
  };

  return (
    <section
      className={`note-section ${section === 'pinned' ? 'note-section-pinned' : ''}`}
      aria-labelledby={headingId}
    >
      <h2
        id={headingId}
        className={hideHeadingVisually ? 'visually-hidden' : 'note-section-heading'}
      >
        {section === 'pinned' && <Pin size={13} aria-hidden="true" className="pin-icon-filled" />}
        <span>{headingText}</span>
        {!hideHeadingVisually && <span className="note-section-count">{notes.length}</span>}
      </h2>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'SpaceキーまたはEnterキーでメモの移動を開始し、上下矢印キーで移動、もう一度SpaceキーまたはEnterキーで確定します。',
          },
        }}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={noteIds} strategy={verticalListSortingStrategy}>
          <ol className="note-section-list" role="list">
            {notes.map((note) => (
              <SortableNoteCard
                key={note.id}
                note={note}
                isSelected={selectedNoteId === note.id}
                showReorderControls={showReorderControls}
                onSelectNote={onSelectNote}
                onTogglePin={onTogglePin}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  );
}

export function NoteList({
  pinnedNotes,
  unpinnedNotes,
  selectedNoteId,
  searchQuery,
  selectedTag,
  allTags,
  canReorder,
  onSearchChange,
  onSelectTag,
  onSelectNote,
  onCreateNew,
  onTogglePin,
  onReorderNotes,
}: NoteListProps) {
  const [announcement, setAnnouncement] = useState('');
  const announceTimerRef = useRef<number | null>(null);

  const announce = useCallback((message: string) => {
    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current);
    }
    setAnnouncement('');
    announceTimerRef.current = window.setTimeout(() => {
      setAnnouncement(message);
      announceTimerRef.current = null;
    }, 60);
  }, []);

  const handleTogglePinWithAnnouncement = useCallback(
    (note: NoteListItem) => {
      const title = noteLabel(note);
      onTogglePin(note.id);
      announce(
        note.isPinned
          ? `「${title}」のピン止めを解除し、通常メモの先頭へ移動しました`
          : `「${title}」をピン止めし、ピン止めエリアの先頭へ移動しました`,
      );
    },
    [onTogglePin, announce],
  );

  const totalCount = pinnedNotes.length + unpinnedNotes.length;

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

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div className="notes-scroll">
        {!canReorder && totalCount > 1 && (
          <p className="reorder-disabled-hint">
            検索・タグ絞り込み中は並び替えできません（ピン止めは操作可能）
          </p>
        )}

        {totalCount === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center' }} className="hint">
            {searchQuery || selectedTag
              ? '一致するメモが見つかりません。'
              : 'メモがまだありません。「新規メモ」から作成できます。'}
          </div>
        ) : (
          <>
            {pinnedNotes.length > 0 && (
              <SortableNoteSection
                section="pinned"
                headingText="ピン止め"
                notes={pinnedNotes}
                selectedNoteId={selectedNoteId}
                canReorder={canReorder}
                onSelectNote={onSelectNote}
                onTogglePin={handleTogglePinWithAnnouncement}
                onReorderNotes={onReorderNotes}
              />
            )}

            {unpinnedNotes.length > 0 && (
              <SortableNoteSection
                section="unpinned"
                headingText="その他のメモ"
                hideHeadingVisually={pinnedNotes.length === 0}
                notes={unpinnedNotes}
                selectedNoteId={selectedNoteId}
                canReorder={canReorder}
                onSelectNote={onSelectNote}
                onTogglePin={handleTogglePinWithAnnouncement}
                onReorderNotes={onReorderNotes}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}
