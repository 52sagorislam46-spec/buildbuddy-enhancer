/**
 * Per-conversation preferences (pin / archive / mute / unread / nickname / hide).
 * Stored locally on the device so no existing data or Firestore rules change.
 */

export interface ChatPrefs {
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  unread: boolean;
  hidden: boolean;
  blocked: boolean;
  nickname: string;
}

export const emptyPrefs: ChatPrefs = {
  pinned: false,
  archived: false,
  muted: false,
  unread: false,
  hidden: false,
  blocked: false,
  nickname: "",
};

const KEY = "fly_chat_prefs";

type Store = Record<string, Partial<ChatPrefs>>;

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

function write(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

const listeners = new Set<() => void>();

export function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadAllPrefs(): Store {
  return read();
}

export function getPrefs(id: string): ChatPrefs {
  return { ...emptyPrefs, ...(read()[id] ?? {}) };
}

export function setPrefs(id: string, patch: Partial<ChatPrefs>) {
  const store = read();
  store[id] = { ...emptyPrefs, ...(store[id] ?? {}), ...patch };
  write(store);
  listeners.forEach((fn) => fn());
}

export function togglePref(id: string, key: keyof ChatPrefs) {
  const current = getPrefs(id);
  setPrefs(id, { [key]: !current[key] } as Partial<ChatPrefs>);
}

/**
 * When each conversation was last opened on this device. Used to show an
 * unread red dot on the Messages tab without touching Firestore rules.
 */

const OPENED_KEY = "fly_chat_opened";

function readOpened(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(OPENED_KEY) ?? "{}") as Record<
      string,
      number
    >;
  } catch {
    return {};
  }
}

export function getLastOpened(id: string): number {
  return readOpened()[id] ?? 0;
}

export function markOpened(id: string) {
  try {
    const store = readOpened();
    store[id] = Date.now();
    localStorage.setItem(OPENED_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}
