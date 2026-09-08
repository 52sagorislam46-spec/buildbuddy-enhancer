import { useEffect, useRef } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "./AuthContext";
import { fetchProfile, markConversationDelivered, toMillis } from "./chat";
import { getPrefs } from "./chatPrefs";
import {
  bindAudioUnlock,
  showNotification,
} from "../../lib/notify";
import { ensureCallPushRegistered, initializePush, logoutOneSignal } from "../../lib/push";

/**
 * Watches the current user's conversations and fires a sound + phone
 * notification whenever the other person sends something new.
 */
export function useMessageNotifications() {
  const { user } = useAuth();
  const seenRef = useRef<Map<string, number>>(new Map());
  const primedRef = useRef(false);

  useEffect(() => {
    bindAudioUnlock();
  }, []);

  // Associate this browser with the signed-in user without prompting. The
  // explicit permission prompt lives in Notification settings.
  useEffect(() => {
    if (!user) {
      void logoutOneSignal();
      return;
    }
    void initializePush(user.uid);
    ensureCallPushRegistered(user.uid);
    return () => {
      void logoutOneSignal();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    seenRef.current = new Map();
    primedRef.current = false;

    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid),
    );

    return onSnapshot(q, (snap) => {
      const first = !primedRef.current;
      primedRef.current = true;

      snap.docs.forEach((d) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = d.data();
        const at = toMillis(data.lastMessageAt);
        // App is open (data on) — receipts become "Delivered" right away,
        // even if this thread is not the one being viewed.
        if ((data.lastSenderId ?? "") !== user.uid) {
          void markConversationDelivered(d.id, user.uid);
        }
        const prev = seenRef.current.get(d.id);
        seenRef.current.set(d.id, at);
        if (first || prev === undefined || at <= prev) return;
        const senderId: string = data.lastSenderId ?? "";
        if (!senderId || senderId === user.uid) return;
        const isGroup = data.type === "group";
        if (getPrefs(isGroup ? d.id : senderId).muted) return;

        void (async () => {
          const profile = await fetchProfile(senderId);
          const groupName = String(data.groupName ?? "Group chat");
          showNotification(
            isGroup
              ? `${groupName} · ${profile?.displayName || "New message"}`
              : profile?.displayName || "New message",
            data.lastMessage || "Sent you a message",
            { icon: profile?.photoURL || "" },
          );
        })();
      });
    });
  }, [user]);
}
