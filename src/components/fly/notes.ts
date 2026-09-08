import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";

/** Messenger-style notes: a short text that disappears after 24 hours. */
export const NOTE_TTL = 24 * 60 * 60 * 1000;
export const NOTE_MAX = 60;

export interface UserNote {
  uid: string;
  text: string;
  authorName: string;
  authorPhoto: string;
  createdAt: number;
}

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in (value as object)) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === "number" ? value : Date.now();
}

export function subscribeNotes(cb: (notes: UserNote[]) => void) {
  return onSnapshot(
    collection(db, "notes"),
    (snap) => {
      const now = Date.now();
      cb(
        snap.docs
          .map((d) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: any = d.data();
            return {
              uid: d.id,
              text: String(data.text ?? ""),
              authorName: data.authorName ?? "",
              authorPhoto: data.authorPhoto ?? "",
              createdAt: toMillis(data.createdAt),
            } as UserNote;
          })
          .filter((n) => n.text && now - n.createdAt < NOTE_TTL),
      );
    },
    () => cb([]),
  );
}

export async function saveNote(
  uid: string,
  text: string,
  authorName: string,
  authorPhoto: string,
) {
  const clean = text.trim().slice(0, NOTE_MAX);
  if (!clean) return;
  await setDoc(doc(db, "notes", uid), {
    text: clean,
    authorName,
    authorPhoto,
    createdAt: serverTimestamp(),
  });
}

export async function deleteNote(uid: string) {
  await deleteDoc(doc(db, "notes", uid));
}
