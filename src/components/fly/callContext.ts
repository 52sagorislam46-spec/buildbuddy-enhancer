import { createContext, useContext } from "react";
import type { UserProfile } from "./types";
import type { CallType } from "./calls";

export interface CallContextValue {
  startCall: (other: UserProfile, type: CallType) => Promise<void>;
  busy: boolean;
}

/**
 * Kept on globalThis so hot-module reloads reuse the same context object
 * (otherwise provider and consumer can end up with two different contexts).
 */
const globalStore = globalThis as unknown as {
  __flyCallContext?: React.Context<CallContextValue | undefined>;
};

export const CallContext =
  globalStore.__flyCallContext ??
  (globalStore.__flyCallContext = createContext<CallContextValue | undefined>(
    undefined,
  ));

export function useCalls() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCalls must be used within CallProvider");
  return ctx;
}
