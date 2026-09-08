import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";

/**
 * Per-conversation "quick reaction" emoji, stored locally on the device so no
 * existing Firestore data or rules change.
 */

const KEY = "fly_quick_reactions";

export const DEFAULT_QUICK_REACTION = "👍";

export const QUICK_REACTION_CHOICES = [
  "👍",
  "❤️",
  "😂",
  "🥹",
  "😮",
  "😢",
  "😡",
  "🔥",
  "🎉",
  "💯",
];

function read(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function loadQuickReaction(id: string): string {
  return read()[id] || DEFAULT_QUICK_REACTION;
}

export function saveQuickReaction(id: string, emoji: string): string {
  const store = read();
  store[id] = emoji;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
  return emoji;
}

/* ------------- shared (both sides) quick reaction ------------- */
/**
 * The quick reaction is mirrored on the conversation document so a change made
 * by either side (1:1 chat or group) shows up for everyone. Local storage stays
 * as the offline fallback and is kept in sync.
 */

export async function saveSharedQuickReaction(
  conversation: string,
  emoji: string,
): Promise<string> {
  saveQuickReaction(conversation, emoji);
  try {
    await setDoc(
      doc(db, "conversations", conversation),
      { quickReaction: emoji },
      { merge: true },
    );
  } catch {
    /* offline or rules: local value still applies */
  }
  return emoji;
}

export function subscribeQuickReaction(
  conversation: string,
  onChange: (emoji: string) => void,
) {
  return onSnapshot(
    doc(db, "conversations", conversation),
    (snap) => {
      const value = (snap.data() as Record<string, unknown> | undefined)?.[
        "quickReaction"
      ];
      if (typeof value === "string" && value) {
        saveQuickReaction(conversation, value);
        onChange(value);
      }
    },
    () => {
      /* keep local value on error */
    },
  );
}
