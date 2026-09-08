/**
 * Shares the signed-in user's refresh token with the push service worker so
 * background pushes can mark the device reachable and messages delivered even
 * while the app is closed. Stored in IndexedDB (same origin, never sent
 * anywhere except Google's own token endpoint).
 */
const DB_NAME = "fly-sw";
const STORE = "auth";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put(value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      if (value === null) tx.objectStore(STORE).delete("current");
      else tx.objectStore(STORE).put(value, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* best effort */
  }
}

/** Saves the credentials the service worker needs. */
export async function saveSwAuth(uid: string, refreshToken: string) {
  if (!uid || !refreshToken) return;
  await put({ uid, refreshToken, savedAt: Date.now() });
}

/** Clears them on sign-out. */
export async function clearSwAuth() {
  await put(null);
}
