import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react';
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
  onKeyboardSelectNote: (noteId: string) => void;
  onCreateNew: () => void;
  onTogglePin: (noteId: string) => void;
  onDeleteRequestNote: (note: NoteListItem) => void;
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

const needsScrollInitialTargetFallback =
  typeof globalThis.CSS?.supports === 'function'
    ? !globalThis.CSS.supports('scroll-initial-target', 'nearest')
    : true;

interface SortableNoteCardProps {
  note: NoteListItem;
  isSelected: boolean;
  showReorderControls: boolean;
  shouldIgnoreClick: () => boolean;
  onSelectNote: (noteId: string) => void;
  onTogglePin: (note: NoteListItem) => void;
  onDeleteRequestNote: (note: NoteListItem) => void;
  onRegisterMainBtnRef: (noteId: string, el: HTMLButtonElement | null) => void;
  onMainKeyDown: (noteId: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  onRegisterSwipeCloser: (
    noteId: string,
    closeFn: ((behavior?: 'instant' | 'smooth') => void) | null,
  ) => void;
  onSwipeOpened: (noteId: string) => void;
  onCloseAllSwipes: (behavior?: 'instant' | 'smooth') => void;
}

function SortableNoteCard({
  note,
  isSelected,
  showReorderControls,
  shouldIgnoreClick,
  onSelectNote,
  onTogglePin,
  onDeleteRequestNote,
  onRegisterMainBtnRef,
  onMainKeyDown,
  onRegisterSwipeCloser,
  onSwipeOpened,
  onCloseAllSwipes,
}: SortableNoteCardProps) {
  const {
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: note.id,
    disabled: !showReorderControls,
  });

  const trackRef = useRef<HTMLDivElement | null>(null);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const [swipeOpenSide, setSwipeOpenSide] = useState<'left' | 'right' | null>(null);
  const swipeOpenSideRef = useRef<'left' | 'right' | null>(null);
  const prevRestLeftRef = useRef(0);

  const resetTrackToCenter = useCallback((behavior: 'instant' | 'smooth' = 'instant') => {
    const track = trackRef.current;
    const leftPanel = leftPanelRef.current;
    if (!track || !leftPanel) return;

    const restLeft = leftPanel.offsetWidth;
    swipeOpenSideRef.current = null;
    setSwipeOpenSide(null);

    if (restLeft > 0) {
      track.scrollTo({ left: restLeft, behavior });
    }
  }, []);

  useEffect(() => {
    onRegisterSwipeCloser(note.id, resetTrackToCenter);
    return () => {
      onRegisterSwipeCloser(note.id, null);
    };
  }, [note.id, resetTrackToCenter, onRegisterSwipeCloser]);

  useLayoutEffect(() => {
    const leftPanel = leftPanelRef.current;
    if (leftPanel) {
      prevRestLeftRef.current = leftPanel.offsetWidth;
    }
    resetTrackToCenter('instant');
  }, [resetTrackToCenter]);

  useEffect(() => {
    const track = trackRef.current;
    const leftPanel = leftPanelRef.current;
    if (!track || !leftPanel || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      const restLeft = leftPanel.offsetWidth;
      const wasDesktop = prevRestLeftRef.current === 0;
      prevRestLeftRef.current = restLeft;

      if (restLeft === 0) {
        if (swipeOpenSideRef.current !== null) {
          swipeOpenSideRef.current = null;
          setSwipeOpenSide(null);
        }
        return;
      }

      if (
        (wasDesktop || needsScrollInitialTargetFallback) &&
        swipeOpenSideRef.current === null
      ) {
        track.scrollTo({ left: restLeft, behavior: 'instant' });
      }
    });

    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isDragging) {
      resetTrackToCenter('instant');
    }
  }, [isDragging, resetTrackToCenter]);

  const handleTrackScroll = () => {
    const track = trackRef.current;
    const leftPanel = leftPanelRef.current;
    if (!track || !leftPanel) return;

    const restLeft = leftPanel.offsetWidth;
    if (restLeft === 0) return;

    const delta = track.scrollLeft - restLeft;
    let nextSide: 'left' | 'right' | null = null;
    if (delta < -12) {
      nextSide = 'left';
    } else if (delta > 12) {
      nextSide = 'right';
    }

    if (nextSide !== swipeOpenSideRef.current) {
      swipeOpenSideRef.current = nextSide;
      setSwipeOpenSide(nextSide);
      if (nextSide !== null) {
        onSwipeOpened(note.id);
      }
    }
  };

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
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        ref={trackRef}
        className="note-swipe-track"
        onScroll={handleTrackScroll}
      >
        <div
          ref={leftPanelRef}
          className="note-swipe-panel note-swipe-panel-pin"
          aria-hidden={swipeOpenSide !== 'left'}
        >
          <button
            type="button"
            className={`note-swipe-btn ${note.isPinned ? 'note-swipe-btn-unpin' : 'note-swipe-btn-pin'}`}
            tabIndex={swipeOpenSide === 'left' ? 0 : -1}
            aria-label={note.isPinned ? `「${title}」のピン止めを解除` : `「${title}」をピン止め`}
            onClick={() => {
              resetTrackToCenter('smooth');
              onTogglePin(note);
            }}
          >
            {note.isPinned ? (
              <>
                <PinOff size={18} aria-hidden="true" />
                <span>解除</span>
              </>
            ) : (
              <>
                <Pin size={18} aria-hidden="true" />
                <span>ピン</span>
              </>
            )}
          </button>
        </div>

        <div className="note-card-body">
          <button
            ref={(el) => onRegisterMainBtnRef(note.id, el)}
            type="button"
            className="note-card-main"
            {...(showReorderControls ? listeners : undefined)}
            onClick={() => {
              if (shouldIgnoreClick()) return;
              if (swipeOpenSideRef.current !== null) {
                resetTrackToCenter('smooth');
                return;
              }
              onCloseAllSwipes('smooth');
              onSelectNote(note.id);
            }}
            onKeyDown={(e) => onMainKeyDown(note.id, e)}
            aria-current={isSelected ? 'true' : undefined}
            title={showReorderControls ? '長押しドラッグまたは Shift + ↑↓ で並び替え' : undefined}
          >
            <div className="note-card-title">{title}</div>
            <div className="note-card-meta">
              <span>{formatUpdatedAt(note)}</span>
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
        </div>

        <div
          className="note-swipe-panel note-swipe-panel-delete"
          aria-hidden={swipeOpenSide !== 'right'}
        >
          <button
            type="button"
            className="note-swipe-btn note-swipe-btn-delete"
            tabIndex={swipeOpenSide === 'right' ? 0 : -1}
            aria-label={`「${title}」を削除`}
            onClick={() => {
              resetTrackToCenter('smooth');
              onDeleteRequestNote(note);
            }}
          >
            <Trash2 size={18} aria-hidden="true" />
            <span>削除</span>
          </button>
        </div>
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
  onDeleteRequestNote: (note: NoteListItem) => void;
  onReorderNotes: (section: NoteSectionKind, activeId: string, overId: string) => void;
  onRegisterMainBtnRef: (noteId: string, el: HTMLButtonElement | null) => void;
  onMainKeyDown: (noteId: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  onRegisterSwipeCloser: (
    noteId: string,
    closeFn: ((behavior?: 'instant' | 'smooth') => void) | null,
  ) => void;
  onSwipeOpened: (noteId: string) => void;
  onCloseAllSwipes: (behavior?: 'instant' | 'smooth') => void;
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
  onDeleteRequestNote,
  onReorderNotes,
  onRegisterMainBtnRef,
  onMainKeyDown,
  onRegisterSwipeCloser,
  onSwipeOpened,
  onCloseAllSwipes,
}: SortableNoteSectionProps) {
  const headingId = useId();
  const justDraggedRef = useRef(false);
  const resetDragFlagTimerRef = useRef<number | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 6 },
    }),
  );

  const noteIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const indexById = useMemo(() => new Map(notes.map((n, idx) => [n.id, idx])), [notes]);

  const showReorderControls = canReorder && notes.length > 1;

  const scheduleResetJustDragged = useCallback(() => {
    if (resetDragFlagTimerRef.current !== null) {
      window.clearTimeout(resetDragFlagTimerRef.current);
    }
    resetDragFlagTimerRef.current = window.setTimeout(() => {
      justDraggedRef.current = false;
      resetDragFlagTimerRef.current = null;
    }, 120);
  }, []);

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart({ active }) {
        const title = noteLabel(noteById.get(String(active.id)));
        return `「${title}」の移動を開始しました`;
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

  const handleDragStart = () => {
    if (resetDragFlagTimerRef.current !== null) {
      window.clearTimeout(resetDragFlagTimerRef.current);
      resetDragFlagTimerRef.current = null;
    }
    justDraggedRef.current = true;
    onCloseAllSwipes('instant');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    scheduleResetJustDragged();
    const { active, over } = event;
    if (!over || active.id === over.id || !showReorderControls) {
      return;
    }
    onReorderNotes(section, String(active.id), String(over.id));
  };

  const handleDragCancel = () => {
    scheduleResetJustDragged();
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
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={noteIds} strategy={verticalListSortingStrategy}>
          <ol className="note-section-list" role="list">
            {notes.map((note) => (
              <SortableNoteCard
                key={note.id}
                note={note}
                isSelected={selectedNoteId === note.id}
                showReorderControls={showReorderControls}
                shouldIgnoreClick={() => justDraggedRef.current}
                onSelectNote={onSelectNote}
                onTogglePin={onTogglePin}
                onDeleteRequestNote={onDeleteRequestNote}
                onRegisterMainBtnRef={onRegisterMainBtnRef}
                onMainKeyDown={onMainKeyDown}
                onRegisterSwipeCloser={onRegisterSwipeCloser}
                onSwipeOpened={onSwipeOpened}
                onCloseAllSwipes={onCloseAllSwipes}
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
  onKeyboardSelectNote,
  onCreateNew,
  onTogglePin,
  onDeleteRequestNote,
  onReorderNotes,
}: NoteListProps) {
  const [announcement, setAnnouncement] = useState('');
  const announceTimerRef = useRef<number | null>(null);
  const mainBtnRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const swipeClosersRef = useRef<Map<string, (behavior?: 'instant' | 'smooth') => void>>(
    new Map(),
  );
  const activeSwipeIdRef = useRef<string | null>(null);

  const registerMainBtnRef = useCallback((noteId: string, el: HTMLButtonElement | null) => {
    if (el) {
      mainBtnRefs.current.set(noteId, el);
    } else {
      mainBtnRefs.current.delete(noteId);
    }
  }, []);

  const registerSwipeCloser = useCallback(
    (noteId: string, closeFn: ((behavior?: 'instant' | 'smooth') => void) | null) => {
      if (closeFn) {
        swipeClosersRef.current.set(noteId, closeFn);
      } else {
        swipeClosersRef.current.delete(noteId);
        if (activeSwipeIdRef.current === noteId) {
          activeSwipeIdRef.current = null;
        }
      }
    },
    [],
  );

  const handleSwipeOpened = useCallback((openedNoteId: string) => {
    const prevId = activeSwipeIdRef.current;
    if (prevId && prevId !== openedNoteId) {
      swipeClosersRef.current.get(prevId)?.('smooth');
    }
    activeSwipeIdRef.current = openedNoteId;
  }, []);

  const handleCloseAllSwipes = useCallback((behavior: 'instant' | 'smooth' = 'smooth') => {
    const activeId = activeSwipeIdRef.current;
    if (activeId) {
      swipeClosersRef.current.get(activeId)?.(behavior);
      activeSwipeIdRef.current = null;
    }
  }, []);

  const orderedVisibleNotes = useMemo(
    () => [...pinnedNotes, ...unpinnedNotes],
    [pinnedNotes, unpinnedNotes],
  );

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

  const handleMainKeyDown = useCallback(
    (noteId: string, event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.shiftKey) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
          return;
        }
        event.preventDefault();

        if (!canReorder) {
          return;
        }

        const pinnedIndex = pinnedNotes.findIndex((n) => n.id === noteId);
        const isPinnedSection = pinnedIndex !== -1;
        const section: NoteSectionKind = isPinnedSection ? 'pinned' : 'unpinned';
        const sectionNotes = isPinnedSection ? pinnedNotes : unpinnedNotes;
        const currentIndex = isPinnedSection
          ? pinnedIndex
          : unpinnedNotes.findIndex((n) => n.id === noteId);

        if (currentIndex === -1 || sectionNotes.length <= 1) {
          return;
        }

        const targetIndex = event.key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= sectionNotes.length) {
          return;
        }

        const currentNote = sectionNotes[currentIndex];
        const targetNote = sectionNotes[targetIndex];
        if (!currentNote || !targetNote) {
          return;
        }

        onReorderNotes(section, noteId, targetNote.id);
        const sectionLabel = isPinnedSection ? 'ピン止め' : 'その他のメモ';
        announce(
          `「${noteLabel(currentNote)}」を${sectionLabel}の ${targetIndex + 1} 番目に移動しました`,
        );

        window.requestAnimationFrame(() => {
          const btn = mainBtnRefs.current.get(noteId);
          if (btn) {
            btn.focus({ preventScroll: true });
            btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        });
        return;
      }

      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }

      const currentIndex = orderedVisibleNotes.findIndex((note) => note.id === noteId);
      if (currentIndex === -1 || orderedVisibleNotes.length === 0) {
        return;
      }

      event.preventDefault();

      let nextIndex = currentIndex;
      if (event.key === 'ArrowDown') {
        nextIndex = Math.min(orderedVisibleNotes.length - 1, currentIndex + 1);
      } else if (event.key === 'ArrowUp') {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = orderedVisibleNotes.length - 1;
      }

      if (nextIndex === currentIndex) {
        return;
      }

      const nextNote = orderedVisibleNotes[nextIndex];
      if (!nextNote) {
        return;
      }

      const nextButton = mainBtnRefs.current.get(nextNote.id);
      if (nextButton) {
        nextButton.focus({ preventScroll: true });
        nextButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      onKeyboardSelectNote(nextNote.id);
    },
    [
      canReorder,
      pinnedNotes,
      unpinnedNotes,
      orderedVisibleNotes,
      onReorderNotes,
      onKeyboardSelectNote,
      announce,
    ],
  );

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
  const hasReorderableSection = canReorder && (pinnedNotes.length > 1 || unpinnedNotes.length > 1);

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
                onDeleteRequestNote={onDeleteRequestNote}
                onReorderNotes={onReorderNotes}
                onRegisterMainBtnRef={registerMainBtnRef}
                onMainKeyDown={handleMainKeyDown}
                onRegisterSwipeCloser={registerSwipeCloser}
                onSwipeOpened={handleSwipeOpened}
                onCloseAllSwipes={handleCloseAllSwipes}
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
                onDeleteRequestNote={onDeleteRequestNote}
                onReorderNotes={onReorderNotes}
                onRegisterMainBtnRef={registerMainBtnRef}
                onMainKeyDown={handleMainKeyDown}
                onRegisterSwipeCloser={registerSwipeCloser}
                onSwipeOpened={handleSwipeOpened}
                onCloseAllSwipes={handleCloseAllSwipes}
              />
            )}
          </>
        )}
      </div>

      {hasReorderableSection && (
        <div className="sidebar-footer-hint">
          長押しドラッグ / Shift + ↑↓ でエリア内を並び替え
        </div>
      )}
    </aside>
  );
}
