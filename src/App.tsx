import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { Lock, RefreshCw, Settings } from 'lucide-react';
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog';
import { LoginScreen } from './components/LoginScreen';
import { NoteEditor } from './components/NoteEditor';
import { NoteList } from './components/NoteList';
import { SettingsDialog, type SyncMode } from './components/SettingsDialog';
import { SetupEncryptionScreen } from './components/SetupEncryptionScreen';
import { SyncStatusBadge } from './components/SyncStatusBadge';
import { UnlockScreen } from './components/UnlockScreen';
import { auth, secureSignOut } from './lib/firebase';
import { initFormValidationSync } from './lib/formValidation';
import {
  type NoteListItem,
  decryptNoteBody,
  refreshNotesOnce,
  saveNote,
  softDeleteNote,
  subscribeToNotes,
} from './lib/notes';
import { type UserKeyDocument, fetchUserKeyDoc } from './lib/userKey';

const SYNC_MODE_STORAGE_KEY = 'secure-sync-memo:sync-mode';

function loadInitialSyncMode(): SyncMode {
  try {
    const saved = localStorage.getItem(SYNC_MODE_STORAGE_KEY);
    return saved === 'auto' ? 'auto' : 'manual';
  } catch {
    return 'manual';
  }
}

export function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyDoc, setKeyDoc] = useState<UserKeyDocument | null>(null);
  const [dek, setDek] = useState<CryptoKey | null>(null);

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [syncMode, setSyncMode] = useState<SyncMode>(loadInitialSyncMode);

  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list');

  const [draftTitle, setDraftTitle] = useState('');
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftBody, setDraftBody] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const decryptSeqRef = useRef(0);

  const clearSessionState = useCallback(() => {
    setDek(null);
    setKeyDoc(null);
    setNotes([]);
    setSelectedNoteId(null);
    setIsNewDraft(false);
    setDraftTitle('');
    setDraftTags([]);
    setDraftBody('');
    setIsDirty(false);
    setDecryptError(null);
    setNotesError(null);
    setMobileView('list');
    setSettingsOpen(false);
    setDeleteDialogOpen(false);
  }, []);

  useEffect(() => {
    return initFormValidationSync(document.body);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      clearSessionState();
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        return;
      }

      setKeyLoading(true);
      setKeyError(null);
      try {
        const fetched = await fetchUserKeyDoc(nextUser.uid);
        setKeyDoc(fetched);
      } catch {
        setKeyError(
          '暗号化設定の読み込みに失敗しました。ネットワークまたは Firestore ルールを確認してください。',
        );
      } finally {
        setKeyLoading(false);
      }
    });

    return () => unsubscribe();
  }, [clearSessionState]);

  useEffect(() => {
    if (!user || !dek) {
      return;
    }

    setNotesError(null);
    const unsubscribe = subscribeToNotes(
      user.uid,
      (incomingNotes) => {
        setNotes(incomingNotes);
      },
      () => {
        setNotesError('メモの同期リスナーでエラーが発生しました。');
      },
    );

    return () => unsubscribe();
  }, [user, dek]);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  // Decrypt selected note whenever selection changes or remote update arrives while clean.
  useEffect(() => {
    if (!dek || !selectedNote || isNewDraft || isDirty) {
      return;
    }

    const currentSeq = ++decryptSeqRef.current;
    setIsDecrypting(true);
    setDecryptError(null);
    setDraftTitle(selectedNote.title);
    setDraftTags(selectedNote.tags);

    void decryptNoteBody(selectedNote, dek)
      .then((plainBody) => {
        if (decryptSeqRef.current !== currentSeq) return;
        setDraftBody(plainBody);
        setIsDecrypting(false);
      })
      .catch(() => {
        if (decryptSeqRef.current !== currentSeq) return;
        setDraftBody('');
        setDecryptError(
          'このメモの復号に失敗しました。暗号化鍵が異なるか、データが破損している可能性があります。',
        );
        setIsDecrypting(false);
      });
  }, [dek, selectedNote, isNewDraft, isDirty]);

  const handleSyncModeChange = (mode: SyncMode) => {
    setSyncMode(mode);
    try {
      localStorage.setItem(SYNC_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage quota errors.
    }
  };

  const handleSaveNote = useCallback(async () => {
    if (!user || !dek || (!selectedNoteId && !isNewDraft) || isSaving || isDecrypting) {
      return;
    }

    setIsSaving(true);
    setNotesError(null);
    try {
      const savedId = await saveNote(
        user.uid,
        {
          id: selectedNoteId ?? undefined,
          title: draftTitle,
          tags: draftTags,
          body: draftBody,
          existingCreatedAt: selectedNote?.createdAt ?? null,
        },
        dek,
      );
      setSelectedNoteId(savedId);
      setIsNewDraft(false);
      setIsDirty(false);
    } catch {
      setNotesError('メモの保存・暗号化に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  }, [
    user,
    dek,
    selectedNoteId,
    isNewDraft,
    isSaving,
    isDecrypting,
    draftTitle,
    draftTags,
    draftBody,
    selectedNote,
  ]);

  // Optional auto-save debounce when syncMode === 'auto'
  useEffect(() => {
    if (
      syncMode !== 'auto' ||
      !isDirty ||
      isSaving ||
      isDecrypting ||
      (!selectedNoteId && !isNewDraft)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void handleSaveNote();
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [syncMode, isDirty, isSaving, isDecrypting, selectedNoteId, isNewDraft, handleSaveNote]);

  const confirmLeaveDirtyIfNeeded = (): boolean => {
    if (!isDirty) return true;
    return window.confirm('未保存の変更があります。破棄して移動しますか？');
  };

  const handleSelectNote = (noteId: string) => {
    if (noteId === selectedNoteId && !isNewDraft) {
      setMobileView('editor');
      return;
    }
    if (!confirmLeaveDirtyIfNeeded()) return;

    setIsNewDraft(false);
    setIsDirty(false);
    setDecryptError(null);
    setSelectedNoteId(noteId);
    setMobileView('editor');
  };

  const handleCreateNew = () => {
    if (!confirmLeaveDirtyIfNeeded()) return;

    decryptSeqRef.current += 1;
    setSelectedNoteId(null);
    setIsNewDraft(true);
    setDraftTitle('');
    setDraftTags([]);
    setDraftBody('');
    setDecryptError(null);
    setIsDecrypting(false);
    setIsDirty(true);
    setMobileView('editor');
  };

  const handleConfirmDelete = useCallback(async () => {
    if (!user || !selectedNoteId) return;
    setNotesError(null);
    try {
      await softDeleteNote(user.uid, selectedNoteId);
      setSelectedNoteId(null);
      setIsNewDraft(false);
      setDraftTitle('');
      setDraftTags([]);
      setDraftBody('');
      setIsDirty(false);
      setMobileView('list');
    } catch {
      setNotesError('メモの削除に失敗しました。');
    }
  }, [user, selectedNoteId]);

  const handleManualRefresh = async () => {
    if (!user || isRefreshing) return;
    setIsRefreshing(true);
    setNotesError(null);
    try {
      const latest = await refreshNotesOnce(user.uid);
      setNotes(latest);
    } catch {
      setNotesError('最新の同期取得に失敗しました。');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLockNow = () => {
    setDek(null);
    setNotes([]);
    setSelectedNoteId(null);
    setIsNewDraft(false);
    setDraftTitle('');
    setDraftTags([]);
    setDraftBody('');
    setIsDirty(false);
    setMobileView('list');
  };

  const handleSignOut = () => {
    void secureSignOut(clearSessionState);
  };

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const note of notes) {
      for (const tag of note.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes.filter((note) => {
      if (selectedTag && !note.tags.includes(selectedTag)) {
        return false;
      }
      if (!q) return true;
      const titleMatch = note.title.toLowerCase().includes(q);
      const tagMatch = note.tags.some((t) => t.toLowerCase().includes(q));
      return titleMatch || tagMatch;
    });
  }, [notes, searchQuery, selectedTag]);

  const anyPendingWrites = useMemo(
    () => notes.some((n) => n.hasPendingWrites),
    [notes],
  );

  if (!authReady || keyLoading) {
    return (
      <main className="center-screen">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0 }}>読み込み中...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (keyError) {
    return (
      <main className="center-screen">
        <section className="auth-card">
          <div className="alert alert-error" role="alert">
            <span>{keyError}</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            再読み込み
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleSignOut}>
            ログアウト
          </button>
        </section>
      </main>
    );
  }

  if (!keyDoc) {
    return (
      <SetupEncryptionScreen
        uid={user.uid}
        userEmail={user.email}
        onComplete={(sessionDek, createdDoc) => {
          setKeyDoc(createdDoc);
          setDek(sessionDek);
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  if (!dek) {
    return (
      <UnlockScreen
        uid={user.uid}
        userEmail={user.email}
        keyDoc={keyDoc}
        onUnlock={(unlockedDek, updatedDoc) => {
          if (updatedDoc) setKeyDoc(updatedDoc);
          setDek(unlockedDek);
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  const hasSelection = Boolean(selectedNoteId || isNewDraft);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <Lock size={18} aria-hidden="true" style={{ color: 'var(--color-brand)', flexShrink: 0 }} />
          <span className="app-logo-text">Secure Sync Memo</span>
          <SyncStatusBadge
            isOnline={isOnline}
            isDirty={isDirty}
            isSaving={isSaving}
            hasPendingWrites={anyPendingWrites}
          />
        </div>

        <div className="app-header-right">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={handleManualRefresh}
            disabled={isRefreshing || !isOnline}
            aria-label="手動で最新を取得"
            title="手動で最新を取得"
          >
            <RefreshCw size={17} className={isRefreshing ? 'spin' : undefined} />
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={handleLockNow}
            aria-label="ロック"
            title="今すぐロック"
          >
            <Lock size={17} />
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="設定"
            title="設定・セキュリティ"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {notesError && (
        <div className="alert alert-error" role="alert" style={{ margin: '0.5rem 1rem 0' }}>
          <span>{notesError}</span>
        </div>
      )}

      <main className="workspace" data-mobile-view={mobileView}>
        <NoteList
          notes={filteredNotes}
          selectedNoteId={selectedNoteId}
          searchQuery={searchQuery}
          selectedTag={selectedTag}
          allTags={allTags}
          onSearchChange={setSearchQuery}
          onSelectTag={setSelectedTag}
          onSelectNote={handleSelectNote}
          onCreateNew={handleCreateNew}
        />

        <NoteEditor
          hasSelection={hasSelection}
          isNewDraft={isNewDraft}
          title={draftTitle}
          tags={draftTags}
          body={draftBody}
          isDirty={isDirty}
          isSaving={isSaving}
          isDecrypting={isDecrypting}
          decryptError={decryptError}
          onTitleChange={(value) => {
            setDraftTitle(value);
            setIsDirty(true);
          }}
          onTagsChange={(nextTags) => {
            setDraftTags(nextTags);
            setIsDirty(true);
          }}
          onBodyChange={(value) => {
            setDraftBody(value);
            setIsDirty(true);
          }}
          onSave={() => void handleSaveNote()}
          onDeleteRequest={() => setDeleteDialogOpen(true)}
          onBackToList={() => setMobileView('list')}
          onCreateNew={handleCreateNew}
        />
      </main>

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        noteTitle={draftTitle}
        onConfirm={() => void handleConfirmDelete()}
        onClose={() => setDeleteDialogOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        uid={user.uid}
        userEmail={user.email}
        keyDoc={keyDoc}
        syncMode={syncMode}
        onSyncModeChange={handleSyncModeChange}
        onKeyDocUpdated={(updated) => setKeyDoc(updated)}
        onLockNow={handleLockNow}
        onSignOut={handleSignOut}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export default App;
