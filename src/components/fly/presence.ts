import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";

export interface PresenceState {
  online: boolean;
  /** Device can still receive push notifications (app closed but data on). */
  reachable: boolean;
  /** When the device last confirmed it can receive notifications. */
  reachableAt: number;
  lastSeen: number;
}

const HEARTBEAT_MS = 60_000;

/**
 * Keeps the current user's presence doc (presence/{uid}) fresh:
 * online=true while the app is running (even when the tab is only in the
 * background), lastSeen updated on a heartbeat, and online=false when the app
 * is closed. `reachable` stays true for devices that accepted notifications,
 * so calls and messages can still reach them while the app is closed.
 * Returns a cleanup function.
 */
export function startPresence(uid: string): () => void {
  const ref = doc(db, "presence", uid);

  const beat = (online: boolean) => {
    setDoc(
      ref,
      { online, lastSeen: serverTimestamp() },
      { merge: true },
    ).catch(() => {});
  };

  beat(true);

  // Heartbeat keeps running when the app is only in the background, so a user
  // who switched apps but still has data on is not shown as offline.
  const interval = setInterval(() => beat(true), HEARTBEAT_MS);

  const onVisibility = () => {
    if (document.visibilityState === "visible") beat(true);
  };
  // Leaving the app only means "not in the foreground". If this phone accepted
  // notifications, it can still receive messages and calls, so refresh the
  // reachable stamp on the way out instead of going fully dark.
  const onLeave = () => {
    const canPush =
      typeof Notification !== "undefined" && Notification.permission === "granted";
    setDoc(
      ref,
      canPush
        ? {
            online: false,
            reachable: true,
            reachableAt: serverTimestamp(),
            lastSeen: serverTimestamp(),
          }
        : { online: false, lastSeen: serverTimestamp() },
      { merge: true },
    ).catch(() => {});
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("beforeunload", onLeave);

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onLeave);
    window.removeEventListener("beforeunload", onLeave);
    beat(false);
  };
}

/**
 * Records whether this user's phone can receive notifications while the app is
 * closed. Written once notifications are registered (or turned off).
 */
export function setPushReachable(uid: string, reachable: boolean): void {
  setDoc(
    doc(db, "presence", uid),
    { reachable, reachableAt: serverTimestamp() },
    { merge: true },
  ).catch(() => {});
}

/** Subscribes to another user's presence doc. */
export function subscribePresence(
  uid: string,
  cb: (state: PresenceState | null) => void,
): () => void {
  return onSnapshot(
    doc(db, "presence", uid),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = snap.data();
      cb({
        online: !!data.online,
        reachable: !!data.reachable,
        reachableAt: data.reachableAt?.toMillis?.() ?? 0,
        lastSeen: data.lastSeen?.toMillis?.() ?? 0,
      });
    },
    () => cb(null),
  );
}
