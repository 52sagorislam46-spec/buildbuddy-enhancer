/**
 * Facebook-style in-app notifications.
 * A notification doc is created whenever a user uploads something
 * (post, reel or story) and is delivered to their followers – or to
 * everyone else when they have no followers yet.
 */
import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { showNotification } from "./notify";
import { pushToUsers } from "./push";

export type AppNotificationType = "post" | "reel" | "story" | "admin";

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  actorId: string;
  actorName: string;
  actorPhoto: string;
  text: string;
  mediaUrl: string;
  readBy: string[];
  createdAt: number;
}

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in (value as object)) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === "number" ? value : Date.now();
}

/** Everyone who should receive an upload notification from this author. */
async function resolveRecipients(
  authorId: string,
  followers: string[] | undefined,
): Promise<string[]> {
  const list = (followers ?? []).filter((id) => id && id !== authorId);
  if (list.length) return Array.from(new Set(list));
  try {
    const snap = await getDocs(collection(db, "users"));
    return snap.docs.map((d) => d.id).filter((id) => id !== authorId);
  } catch {
    return [];
  }
}

export async function notifyUpload(input: {
  type: AppNotificationType;
  actorId: string;
  actorName: string;
  actorPhoto?: string;
  followers?: string[];
  text?: string;
  mediaUrl?: string;
}) {
  try {
    const recipients = await resolveRecipients(input.actorId, input.followers);
    if (!recipients.length) return;
    await addDoc(collection(db, "notifications"), {
      type: input.type,
      actorId: input.actorId,
      actorName: input.actorName,
      actorPhoto: input.actorPhoto ?? "",
      text: input.text ?? "",
      mediaUrl: input.mediaUrl ?? "",
      recipients,
      readBy: [],
      createdAt: serverTimestamp(),
    });
    const label =
      input.type === "story"
        ? "added a new story."
        : input.type === "reel"
          ? "shared a new reel."
          : "shared a new post.";
    await pushToUsers({
      uids: recipients,
      title: input.actorName,
      body: input.text ? `${label} ${input.text}` : label,
      icon: input.actorPhoto ?? "",
      link: "/",
      tag: `upload_${input.actorId}_${Date.now()}`,
    });
  } catch {
    /* notifications are best effort */
  }
}

/**
 * Notice sent by the Fly admin to a single member (warning, suspension,
 * restore). Shows up in that member's notification list only.
 */
export async function notifyAdminNotice(input: {
  uid: string;
  title: string;
  text: string;
}) {
  try {
    await addDoc(collection(db, "notifications"), {
      type: "admin" as AppNotificationType,
      actorId: "fly-admin",
      actorName: `Fly Admin · ${input.title}`,
      actorPhoto: "",
      text: input.text,
      mediaUrl: "",
      recipients: [input.uid],
      readBy: [],
      createdAt: serverTimestamp(),
    });
    await pushToUsers({
      uids: [input.uid],
      title: `Fly Admin · ${input.title}`,
      body: input.text,
      icon: "",
      link: "/",
      tag: `admin_${input.uid}_${Date.now()}`,
    });
  } catch {
    /* notices are best effort */
  }
}

export function notificationLabel(n: AppNotification): string {
  if (n.type === "admin") return "sent you a notice.";
  if (n.type === "story") return "added a new story.";
  if (n.type === "reel") return "shared a new reel.";
  return "shared a new post.";
}

export async function markNotificationRead(id: string, uid: string) {
  try {
    await updateDoc(doc(db, "notifications", id), { readBy: arrayUnion(uid) });
  } catch {
    /* ignore */
  }
}

export async function markAllNotificationsRead(
  items: AppNotification[],
  uid: string,
) {
  await Promise.all(
    items
      .filter((n) => !n.readBy.includes(uid))
      .map((n) => markNotificationRead(n.id, uid)),
  );
}

/** Removes one notification from this user's list only (others keep theirs). */
export async function dismissNotification(id: string, uid: string) {
  try {
    await updateDoc(doc(db, "notifications", id), {
      recipients: arrayRemove(uid),
    });
  } catch {
    /* ignore */
  }
}

/**
 * Clears every notification for this user by removing them from the
 * recipient lists. No posts, reels, stories or other app data are touched.
 */
export async function clearAllNotifications(
  items: AppNotification[],
  uid: string,
) {
  await Promise.all(items.map((n) => dismissNotification(n.id, uid)));
}


/** Live list of notifications for the signed-in user. */
export function useAppNotifications(uid: string | undefined) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const primedRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) {
      setItems([]);
      return;
    }
    primedRef.current = false;
    seenRef.current = new Set();

    const handle = (snap: { docs: { id: string; data: () => unknown }[] }) => {
      const list: AppNotification[] = snap.docs
        .map((d) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data: any = d.data();
          return {
            id: d.id,
            type: (data.type ?? "post") as AppNotificationType,
            actorId: data.actorId ?? "",
            actorName: data.actorName ?? "Someone",
            actorPhoto: data.actorPhoto ?? "",
            text: data.text ?? "",
            mediaUrl: data.mediaUrl ?? "",
            readBy: Array.isArray(data.readBy) ? data.readBy : [],
            createdAt: toMillis(data.createdAt),
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50);

      if (primedRef.current) {
        list.forEach((n) => {
          if (seenRef.current.has(n.id)) return;
          showNotification(n.actorName, notificationLabel(n), {
            icon: n.actorPhoto,
          });
        });
      }
      list.forEach((n) => seenRef.current.add(n.id));
      primedRef.current = true;
      setItems(list);
    };

    let fallbackUnsub: (() => void) | null = null;

    const primaryUnsub = onSnapshot(
      query(
        collection(db, "notifications"),
        where("recipients", "array-contains", uid),
        orderBy("createdAt", "desc"),
        limit(50),
      ),
      handle,
      () => {
        // Missing composite index (or ordering issue): fall back to an
        // unordered live query so notifications still arrive instantly.
        fallbackUnsub = onSnapshot(
          query(
            collection(db, "notifications"),
            where("recipients", "array-contains", uid),
          ),
          handle,
          () => {
            /* permission errors are ignored */
          },
        );
      },
    );

    return () => {
      primaryUnsub();
      fallbackUnsub?.();
    };
  }, [uid]);


  const unread = uid
    ? items.filter((n) => !n.readBy.includes(uid)).length
    : 0;

  return { items, unread };
}
