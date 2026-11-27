import {
  type QueryDocumentSnapshot,
  Timestamp,
  type Unsubscribe,
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { decryptText, encryptText } from './crypto';
import { db } from './firebase';

export interface EncryptedNoteDoc {
  title: string;
  tags: string[];
  iv: string;
  ciphertext: string;
  encVersion: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  isDeleted: boolean;
  isPinned: boolean;
  sortOrder: number | null;
}

export interface NoteListItem extends EncryptedNoteDoc {
  id: string;
  hasPendingWrites: boolean;
  fromCache: boolean;
}

interface DecryptedNotePayload {
  body: string;
}

function mapNoteDoc(snapshot: QueryDocumentSnapshot): NoteListItem {
  const data = snapshot.data();
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return {
    id: snapshot.id,
    title: typeof data.title === 'string' ? data.title : '',
    tags,
    iv: typeof data.iv === 'string' ? data.iv : '',
    ciphertext: typeof data.ciphertext === 'string' ? data.ciphertext : '',
    encVersion: typeof data.encVersion === 'number' ? data.encVersion : 1,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    isDeleted: Boolean(data.isDeleted),
    isPinned: Boolean(data.isPinned),
    sortOrder:
      typeof data.sortOrder === 'number' && Number.isFinite(data.sortOrder)
        ? data.sortOrder
        : null,
    hasPendingWrites: snapshot.metadata.hasPendingWrites,
    fromCache: snapshot.metadata.fromCache,
  };
}

export function subscribeToNotes(
  uid: string,
  onData: (notes: NoteListItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const notesQuery = query(
    collection(db, 'users', uid, 'notes'),
    orderBy('updatedAt', 'desc'),
  );

  return onSnapshot(
    notesQuery,
    { includeMetadataChanges: true },
    (snapshot) => {
      const activeNotes = snapshot.docs
        .map(mapNoteDoc)
        .filter((note) => !note.isDeleted);
      onData(activeNotes);
    },
    (error) => {
      onError(error);
    },
  );
}

export async function refreshNotesOnce(uid: string): Promise<NoteListItem[]> {
  const notesQuery = query(
    collection(db, 'users', uid, 'notes'),
    orderBy('updatedAt', 'desc'),
  );

  try {
    const serverSnapshot = await getDocsFromServer(notesQuery);
    return serverSnapshot.docs.map(mapNoteDoc).filter((note) => !note.isDeleted);
  } catch {
    const cachedSnapshot = await getDocs(notesQuery);
    return cachedSnapshot.docs.map(mapNoteDoc).filter((note) => !note.isDeleted);
  }
}

export async function decryptNoteBody(
  note: Pick<NoteListItem, 'ciphertext' | 'iv'>,
  dek: CryptoKey,
): Promise<string> {
  if (!note.ciphertext || !note.iv) {
    return '';
  }
  const plainJson = await decryptText(note.ciphertext, note.iv, dek);
  const parsed = JSON.parse(plainJson) as Partial<DecryptedNotePayload>;
  return typeof parsed.body === 'string' ? parsed.body : '';
}

export interface SaveNoteParams {
  id?: string;
  title: string;
  tags: string[];
  body: string;
  isPinned: boolean;
  sortOrder: number;
  existingCreatedAt?: Timestamp | null;
}

export async function saveNote(
  uid: string,
  params: SaveNoteParams,
  dek: CryptoKey,
): Promise<string> {
  const notesCollection = collection(db, 'users', uid, 'notes');
  const noteRef = params.id ? doc(notesCollection, params.id) : doc(notesCollection);
  const normalizedTitle = params.title.trim().slice(0, 500) || '無題のメモ';
  const normalizedTags = Array.from(
    new Set(
      params.tags
        .map((tag) => tag.trim().slice(0, 64))
        .filter((tag) => tag.length > 0),
    ),
  ).slice(0, 20);

  const payload: DecryptedNotePayload = { body: params.body };
  const { iv, ciphertext } = await encryptText(JSON.stringify(payload), dek);

  await setDoc(noteRef, {
    title: normalizedTitle,
    tags: normalizedTags,
    iv,
    ciphertext,
    encVersion: 1,
    createdAt: params.existingCreatedAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    isDeleted: false,
    isPinned: Boolean(params.isPinned),
    sortOrder: params.sortOrder,
  });

  return noteRef.id;
}

export async function updateNotePinState(
  uid: string,
  noteId: string,
  isPinned: boolean,
  sortOrder: number,
): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'notes', noteId), {
    isPinned: Boolean(isPinned),
    sortOrder,
  });
}

export async function updateNoteSortOrders(
  uid: string,
  updates: ReadonlyArray<{ id: string; sortOrder: number }>,
): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  if (updates.length === 1) {
    const single = updates[0]!;
    await updateDoc(doc(db, 'users', uid, 'notes', single.id), {
      sortOrder: single.sortOrder,
    });
    return;
  }

  const CHUNK_SIZE = 450;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const item of chunk) {
      batch.update(doc(db, 'users', uid, 'notes', item.id), {
        sortOrder: item.sortOrder,
      });
    }
    await batch.commit();
  }
}

export async function softDeleteNote(uid: string, noteId: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'notes', noteId), {
    isDeleted: true,
    updatedAt: serverTimestamp(),
  });
}
