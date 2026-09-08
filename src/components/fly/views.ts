import { doc, increment, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";

const STORAGE_KEY = "fly_viewed_posts";
const memory = new Set<string>();

function loadSeen(): Set<string> {
  if (memory.size > 0) return memory;
  if (typeof window === "undefined") return memory;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    ids.forEach((id) => memory.add(id));
  } catch {
    /* ignore */
  }
  return memory;
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...memory]));
  } catch {
    /* ignore */
  }
}

/** Count one view per post per device (no existing data is modified). */
export async function registerView(postId: string) {
  if (!postId) return;
  const seen = loadSeen();
  if (seen.has(postId)) return;
  seen.add(postId);
  persist();
  try {
    await updateDoc(doc(db, "posts", postId), { views: increment(1) });
  } catch {
    /* ignore */
  }
}

export function formatViews(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(count);
}
