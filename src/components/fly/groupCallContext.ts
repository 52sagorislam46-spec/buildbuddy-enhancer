import { createContext, useContext } from "react";
import type { CallType } from "./calls";
import type { GroupConversation } from "./types";

export interface GroupCallContextValue {
  /** Starts a group audio/video call and rings every other member. */
  startGroupCall: (group: GroupConversation, type: CallType) => Promise<void>;
  busy: boolean;
}

/** Kept on globalThis so HMR reuses the same context object. */
const globalStore = globalThis as unknown as {
  __flyGroupCallContext?: React.Context<GroupCallContextValue | undefined>;
};

export const GroupCallContext =
  globalStore.__flyGroupCallContext ??
  (globalStore.__flyGroupCallContext = createContext<
    GroupCallContextValue | undefined
  >(undefined));

export function useGroupCalls() {
  const ctx = useContext(GroupCallContext);
  if (!ctx) throw new Error("useGroupCalls must be used within GroupCallProvider");
  return ctx;
}
