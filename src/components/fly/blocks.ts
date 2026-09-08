/**
 * Two-way block state for a conversation.
 * Stored on the conversation document as `blockedBy: string[]`,
 * so both devices see it and the blocked person cannot send messages.
 */
import {
  arrayRemove,
  arrayUnion,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { conversationId, ensureConversation } from "./chat";

export interface BlockState {
  /** I blocked the other person */
  iBlocked: boolean;
  /** The other person blocked me */
  blockedMe: boolean;
}

export const noBlock: BlockState = { iBlocked: false, blockedMe: false };

export function subscribeBlock(
  meId: string,
  otherId: string,
  cb: (state: BlockState) => void,
) {
  const ref = doc(db, "conversations", conversationId(meId, otherId));
  return onSnapshot(
    ref,
    (snap) => {
      const list = ((snap.data()?.["blockedBy"] as string[]) ?? []);
      cb({
        iBlocked: list.includes(meId),
        blockedMe: list.includes(otherId),
      });
    },
    () => cb(noBlock),
  );
}

export async function getBlockState(
  meId: string,
  otherId: string,
): Promise<BlockState> {
  try {
    const snap = await getDoc(
      doc(db, "conversations", conversationId(meId, otherId)),
    );
    const list = ((snap.data()?.["blockedBy"] as string[]) ?? []);
    return {
      iBlocked: list.includes(meId),
      blockedMe: list.includes(otherId),
    };
  } catch {
    return noBlock;
  }
}

export async function setBlocked(
  meId: string,
  otherId: string,
  blocked: boolean,
) {
  const id = await ensureConversation(meId, otherId);
  await setDoc(
    doc(db, "conversations", id),
    { blockedBy: blocked ? arrayUnion(meId) : arrayRemove(meId) },
    { merge: true },
  );
}
