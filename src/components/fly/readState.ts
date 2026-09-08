/**
 * Cross-device "seen" tracking for conversations.
 *
 * The device-local `markOpened` timestamps still work as before; this adds a
 * per-user `readAt` map on the conversation document so a thread that was read
 * on one device is no longer unread anywhere, and stays unread everywhere
 * until it is actually opened.
 */
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { getLastOpened } from "./chatPrefs";

/** In-memory mirror so the UI updates instantly after marking as read. */
const localReadAt = new Map<string, number>();

export function cacheReadAt(convId: string, at: number) {
  const prev = localReadAt.get(convId) ?? 0;
  if (at > prev) localReadAt.set(convId, at);
}

export function getReadAt(convId: string): number {
  return localReadAt.get(convId) ?? 0;
}

/** Records that the signed-in user has seen everything in this conversation. */
export async function markConversationRead(convId: string, uid: string) {
  if (!convId || !uid) return;
  const at = Date.now();
  cacheReadAt(convId, at);
  try {
    await setDoc(
      doc(db, "conversations", convId),
      { readAt: { [uid]: at } },
      { merge: true },
    );
  } catch {
    /* best effort — local tracking still applies */
  }
}

/** Reads the stored readAt value for a user out of a conversation document. */
export function readAtFromData(data: unknown, uid: string): number {
  const map = (data as { readAt?: Record<string, unknown> } | null)?.readAt;
  const value = map ? map[uid] : undefined;
  return typeof value === "number" ? value : 0;
}

/** True when the latest incoming message has not been seen yet. */
export function isConversationUnread(input: {
  convId: string;
  lastSenderId: string;
  lastMessageAt: number;
  readAt: number;
  uid: string;
}): boolean {
  const { convId, lastSenderId, lastMessageAt, readAt, uid } = input;
  if (!lastSenderId || lastSenderId === uid) return false;
  const seenAt = Math.max(readAt, getReadAt(convId), getLastOpened(convId));
  return lastMessageAt > seenAt;
}
