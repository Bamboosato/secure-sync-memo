import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { Lock, RefreshCw, Settings } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog';
import { LoginScreen } from './components/LoginScreen';
import { NoteEditor } from './components/NoteEditor';
import { NoteList } from './components/NoteList';
import { SettingsDialog, type SyncMode } from './components/SettingsDialog';
import { SetupEncryptionScreen } from './components/SetupEncryptionScreen';
import { SyncStatusBadge } from './components/SyncStatusBadge';
import { UnlockScreen } from './components/UnlockScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { verifyKeyCheck } from './lib/crypto';
import { clearCachedDek, loadCachedDek, saveCachedDek } from './lib/dekCache';
import { auth, secureSignOut } from './lib/firebase';
import { initFormValidationSync } from './lib/formValidation';
import {
  type NoteListItem,
  decryptNoteBody,
  refreshNotesOnce,
  saveNote,
  softDeleteNote,
  subscribeToNotes,
  updateNotePinState,
  updateNoteSortOrders,
} from './lib/notes';
import {
  computeReorderUpdate,
  computeTopSortOrder,
  getEffectiveSortOrder,
  splitAndSortNotes,
} from './lib/noteOrdering';
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
  const [rememberDevice, setRememberDevice] = useState(false);

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
  const [draftIsPinned, setDraftIsPinned] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [isUpdatingApp, setIsUpdatingApp] = useState(false);

  const decryptSeqRef = useRef(0);
  const authSeqRef = useRef(0);
  const lastDecryptedRef = useRef<{ id: string; iv: string; ciphertext: string } | null>(null);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      swRegistrationRef.current = registration ?? null;
    },
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void swRegistrationRef.current?.update();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleApplyAppUpdate = useCallback(async () => {
    if (isUpdatingApp) return;
    if (isDirty && !window.confirm('未保存の変更があります。破棄してアプリを更新しますか？')) {
      return;
    }

    setIsUpdatingApp(true);
    try {
      await updateServiceWorker(true);
    } catch {
      setIsUpdatingApp(false);
    }
  }, [isUpdatingApp, isDirty, updateServiceWorker]);

  const clearSessionState = useCallback(() => {
    lastDecryptedRef.current = null;
    setDek(null);
    setRememberDevice(false);
    setKeyDoc(null);
    setNotes([]);
    setSelectedNoteId(null);
    setIsNewDraft(false);
    setDraftTitle('');
    setDraftTags([]);
    setDraftBody('');
    setDraftIsPinned(false);
    setIsDirty(false);
    setDecryptError(null);
    setNotesError(null);
    setMobileView('list');
    setSettingsOpen(false);
    setDeleteTarget(null);
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
      const currentAuthSeq = ++authSeqRef.current;
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
        if (authSeqRef.current !== currentAuthSeq) return;
        setKeyDoc(fetched);

        if (fetched) {
          const cachedDek = await loadCachedDek(nextUser.uid);
          if (authSeqRef.current !== currentAuthSeq) return;
          if (cachedDek) {
            const isValid = await verifyKeyCheck(fetched.keyCheck, cachedDek);
            if (authSeqRef.current !== currentAuthSeq) return;
            if (isValid) {
              setDek(cachedDek);
              setRememberDevice(true);
            } else {
              await clearCachedDek(nextUser.uid);
              setRememberDevice(false);
            }
          }
        }
      } catch {
        if (authSeqRef.current !== currentAuthSeq) return;
        setKeyError(
          '暗号化設定の読み込みに失敗しました。ネットワークまたは Firestore ルールを確認してください。',
        );
      } finally {
        if (authSeqRef.current === currentAuthSeq) {
          setKeyLoading(false);
        }
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

    setDraftTitle(selectedNote.title);
    setDraftTags(selectedNote.tags);
    setDraftIsPinned(selectedNote.isPinned);

    const prevDecrypted = lastDecryptedRef.current;
    if (
      prevDecrypted &&
      prevDecrypted.id === selectedNote.id &&
      prevDecrypted.iv === selectedNote.iv &&
      prevDecrypted.ciphertext === selectedNote.ciphertext
    ) {
      return;
    }

    const currentSeq = ++decryptSeqRef.current;
    setIsDecrypting(true);
    setDecryptError(null);

    void decryptNoteBody(selectedNote, dek)
      .then((plainBody) => {
        if (decryptSeqRef.current !== currentSeq) return;
        lastDecryptedRef.current = {
          id: selectedNote.id,
          iv: selectedNote.iv,
          ciphertext: selectedNote.ciphertext,
        };
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

  const { pinnedNotes: allPinnedNotes, unpinnedNotes: allUnpinnedNotes } = useMemo(
    () => splitAndSortNotes(notes),
    [notes],
  );

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

    const targetIsPinned = isNewDraft ? draftIsPinned : (selectedNote?.isPinned ?? draftIsPinned);
    const targetSortOrder =
      !isNewDraft && selectedNote
        ? getEffectiveSortOrder(selectedNote)
        : computeTopSortOrder(targetIsPinned ? allPinnedNotes : allUnpinnedNotes);

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
          isPinned: targetIsPinned,
          sortOrder: targetSortOrder,
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
    draftIsPinned,
    selectedNote,
    allPinnedNotes,
    allUnpinnedNotes,
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

    lastDecryptedRef.current = null;
    setIsNewDraft(false);
    setIsDirty(false);
    setDecryptError(null);
    setSelectedNoteId(noteId);
    setMobileView('editor');
  };

  const handleKeyboardSelectNote = useCallback(
    (noteId: string) => {
      if (isDirty) return;
      if (noteId === selectedNoteId && !isNewDraft) return;

      lastDecryptedRef.current = null;
      setIsNewDraft(false);
      setDecryptError(null);
      setSelectedNoteId(noteId);
    },
    [isDirty, selectedNoteId, isNewDraft],
  );

  const handleCreateNew = () => {
    if (!confirmLeaveDirtyIfNeeded()) return;

    decryptSeqRef.current += 1;
    lastDecryptedRef.current = null;
    setSelectedNoteId(null);
    setIsNewDraft(true);
    setDraftTitle('');
    setDraftTags([]);
    setDraftBody('');
    setDraftIsPinned(false);
    setDecryptError(null);
    setIsDecrypting(false);
    setIsDirty(true);
    setMobileView('editor');
  };

  const handleConfirmDelete = useCallback(async () => {
    if (!user || !deleteTarget) return;
    const deletingId = deleteTarget.id;
    setNotesError(null);
    try {
      await softDeleteNote(user.uid, deletingId);
      setDeleteTarget(null);
      if (deletingId === selectedNoteId) {
        lastDecryptedRef.current = null;
        setSelectedNoteId(null);
        setIsNewDraft(false);
        setDraftTitle('');
        setDraftTags([]);
        setDraftBody('');
        setDraftIsPinned(false);
        setIsDirty(false);
        setMobileView('list');
      }
    } catch {
      setNotesError('メモの削除に失敗しました。');
    }
  }, [user, deleteTarget, selectedNoteId]);

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
    void clearCachedDek(user?.uid);
    lastDecryptedRef.current = null;
    setDek(null);
    setRememberDevice(false);
    setNotes([]);
    setSelectedNoteId(null);
    setIsNewDraft(false);
    setDraftTitle('');
    setDraftTags([]);
    setDraftBody('');
    setDraftIsPinned(false);
    setIsDirty(false);
    setMobileView('list');
  };

  const handleRememberDeviceChange = useCallback(
    async (enabled: boolean) => {
      if (!user) return;
      if (enabled) {
        if (!dek) return;
        const ok = await saveCachedDek(user.uid, dek);
        setRememberDevice(ok);
      } else {
        await clearCachedDek(user.uid);
        setRememberDevice(false);
      }
    },
    [user, dek],
  );

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

  const isFiltering = Boolean(searchQuery.trim() || selectedTag);

  const filterNote = useCallback(
    (note: NoteListItem) => {
      if (selectedTag && !note.tags.includes(selectedTag)) {
        return false;
      }
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const titleMatch = note.title.toLowerCase().includes(q);
      const tagMatch = note.tags.some((t) => t.toLowerCase().includes(q));
      return titleMatch || tagMatch;
    },
    [searchQuery, selectedTag],
  );

  const filteredPinnedNotes = useMemo(
    () => allPinnedNotes.filter(filterNote),
    [allPinnedNotes, filterNote],
  );

  const filteredUnpinnedNotes = useMemo(
    () => allUnpinnedNotes.filter(filterNote),
    [allUnpinnedNotes, filterNote],
  );

  const handleTogglePinNote = useCallback(
    async (noteId: string) => {
      if (!user) return;
      const target = notes.find((n) => n.id === noteId);
      if (!target) return;

      const nextPinned = !target.isPinned;
      const destinationSection = nextPinned ? allPinnedNotes : allUnpinnedNotes;
      const nextSortOrder = computeTopSortOrder(destinationSection);

      if (noteId === selectedNoteId && !isNewDraft) {
        setDraftIsPinned(nextPinned);
      }

      setNotesError(null);
      try {
        await updateNotePinState(user.uid, noteId, nextPinned, nextSortOrder);
      } catch {
        if (noteId === selectedNoteId && !isNewDraft) {
          setDraftIsPinned(target.isPinned);
        }
        setNotesError('ピン止め状態の更新に失敗しました。');
      }
    },
    [user, notes, allPinnedNotes, allUnpinnedNotes, selectedNoteId, isNewDraft],
  );

  const handleToggleEditorPin = useCallback(() => {
    if (isNewDraft) {
      setDraftIsPinned((prev) => !prev);
      return;
    }
    if (selectedNoteId) {
      void handleTogglePinNote(selectedNoteId);
    }
  }, [isNewDraft, selectedNoteId, handleTogglePinNote]);

  const handleReorderNotes = useCallback(
    async (section: 'pinned' | 'unpinned', activeId: string, overId: string) => {
      if (!user || isFiltering) return;
      const sectionNotes = section === 'pinned' ? allPinnedNotes : allUnpinnedNotes;
      const plan = computeReorderUpdate(sectionNotes, activeId, overId);
      if (!plan) return;

      setNotesError(null);
      try {
        await updateNoteSortOrders(user.uid, plan.updates);
      } catch {
        setNotesError('メモの並び替えの保存に失敗しました。');
      }
    },
    [user, isFiltering, allPinnedNotes, allUnpinnedNotes],
  );

  const anyPendingWrites = useMemo(
    () => notes.some((n) => n.hasPendingWrites),
    [notes],
  );

  const renderWithUpdateBanner = (content: ReactNode) => (
    <>
      {content}
      <UpdateBanner
        visible={needRefresh}
        isUpdating={isUpdatingApp}
        onUpdate={() => void handleApplyAppUpdate()}
        onDismiss={() => setNeedRefresh(false)}
      />
    </>
  );

  if (!authReady || keyLoading) {
    return renderWithUpdateBanner(
      <main className="center-screen">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0 }}>読み込み中...</p>
        </div>
      </main>,
    );
  }

  if (!user) {
    return renderWithUpdateBanner(<LoginScreen />);
  }

  if (keyError) {
    return renderWithUpdateBanner(
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
      </main>,
    );
  }

  if (!keyDoc) {
    return renderWithUpdateBanner(
      <SetupEncryptionScreen
        uid={user.uid}
        userEmail={user.email}
        onComplete={(sessionDek, createdDoc) => {
          setKeyDoc(createdDoc);
          setDek(sessionDek);
        }}
        onSignOut={handleSignOut}
      />,
    );
  }

  if (!dek) {
    return renderWithUpdateBanner(
      <UnlockScreen
        uid={user.uid}
        userEmail={user.email}
        keyDoc={keyDoc}
        onUnlock={(unlockedDek, { rememberDevice: nextRemember, updatedKeyDoc }) => {
          if (updatedKeyDoc) setKeyDoc(updatedKeyDoc);
          setDek(unlockedDek);
          if (nextRemember) {
            setRememberDevice(true);
            void saveCachedDek(user.uid, unlockedDek).then((ok) => {
              if (!ok) setRememberDevice(false);
            });
          } else {
            setRememberDevice(false);
            void clearCachedDek(user.uid);
          }
        }}
        onSignOut={handleSignOut}
      />,
    );
  }

  const hasSelection = Boolean(selectedNoteId || isNewDraft);

  return renderWithUpdateBanner(
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
          pinnedNotes={filteredPinnedNotes}
          unpinnedNotes={filteredUnpinnedNotes}
          selectedNoteId={selectedNoteId}
          searchQuery={searchQuery}
          selectedTag={selectedTag}
          allTags={allTags}
          canReorder={!isFiltering}
          onSearchChange={setSearchQuery}
          onSelectTag={setSelectedTag}
          onSelectNote={handleSelectNote}
          onKeyboardSelectNote={handleKeyboardSelectNote}
          onCreateNew={handleCreateNew}
          onTogglePin={(noteId) => void handleTogglePinNote(noteId)}
          onDeleteRequestNote={(note) => setDeleteTarget({ id: note.id, title: note.title })}
          onReorderNotes={(section, activeId, overId) =>
            void handleReorderNotes(section, activeId, overId)
          }
        />

        <NoteEditor
          hasSelection={hasSelection}
          noteId={selectedNoteId}
          isNewDraft={isNewDraft}
          isPinned={draftIsPinned}
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
          onTogglePin={handleToggleEditorPin}
          onSave={() => void handleSaveNote()}
          onDeleteRequest={() => {
            if (selectedNoteId) {
              setDeleteTarget({
                id: selectedNoteId,
                title: draftTitle || selectedNote?.title || '',
              });
            }
          }}
          onBackToList={() => setMobileView('list')}
          onCreateNew={handleCreateNew}
        />
      </main>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        noteTitle={deleteTarget?.title ?? ''}
        onConfirm={() => void handleConfirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />

      <SettingsDialog
        open={settingsOpen}
        uid={user.uid}
        userEmail={user.email}
        keyDoc={keyDoc}
        syncMode={syncMode}
        rememberDevice={rememberDevice}
        onSyncModeChange={handleSyncModeChange}
        onRememberDeviceChange={(enabled) => void handleRememberDeviceChange(enabled)}
        onKeyDocUpdated={(updated) => setKeyDoc(updated)}
        onLockNow={handleLockNow}
        onSignOut={handleSignOut}
        onClose={() => setSettingsOpen(false)}
      />
    </div>,
  );
}

export default App;
