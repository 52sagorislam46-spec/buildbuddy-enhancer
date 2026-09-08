import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "./AuthContext";
import { toMillis } from "./chat";
import { getPrefs, subscribePrefs } from "./chatPrefs";
import { cacheReadAt, isConversationUnread, readAtFromData } from "./readState";

/**
 * True when any conversation has a newer incoming message than the last time
 * the user opened it on this device — drives the red dot on the Messages tab.
 */
export function useUnreadMessages(): boolean {
  const { user } = useAuth();
  const [hasUnread, setHasUnread] = useState(false);
  const [prefsVersion, setPrefsVersion] = useState(0);

  useEffect(() => {
    const unsub = subscribePrefs(() => setPrefsVersion((v) => v + 1));
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setHasUnread(false);
      return;
    }
    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid),
    );
    return onSnapshot(q, (snap) => {
      const any = snap.docs.some((d) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = d.data();
        const senderId: string = data.lastSenderId ?? "";
        if (!senderId || senderId === user.uid) return false;
        const at = toMillis(data.lastMessageAt);
        const readAt = readAtFromData(data, user.uid);
        if (readAt) cacheReadAt(d.id, readAt);
        if (
          !isConversationUnread({
            convId: d.id,
            lastSenderId: senderId,
            lastMessageAt: at,
            readAt,
            uid: user.uid,
          })
        )
          return false;
        // Respect muted conversations the same way notifications do.
        const prefKey = data.type === "group" ? d.id : senderId;
        if (getPrefs(prefKey).muted) return false;
        return true;
      });
      setHasUnread(any);
    });
    // prefsVersion re-runs this so opening a chat clears the dot immediately.
  }, [user, prefsVersion]);

  return hasUnread;
}
