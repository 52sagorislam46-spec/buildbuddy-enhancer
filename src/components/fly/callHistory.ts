import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { toMillis } from "./chat";

export type CallOutcome = "completed" | "missed" | "declined" | "no-answer";
export type CallDirection = "incoming" | "outgoing";

export interface CallLog {
  id: string;
  userId: string;
  otherId: string;
  otherName: string;
  otherPhoto: string;
  direction: CallDirection;
  type: "audio" | "video";
  outcome: CallOutcome;
  durationSec: number;
  createdAt: number;
}

const logsRef = () => collection(db, "callLogs");

/** Saves one call-history row for the current user (each side writes its own). */
export async function saveCallHistory(entry: {
  userId: string;
  otherId: string;
  otherName: string;
  otherPhoto: string;
  direction: CallDirection;
  type: "audio" | "video";
  outcome: CallOutcome;
  durationSec: number;
}) {
  try {
    await addDoc(logsRef(), { ...entry, createdAt: serverTimestamp() });
  } catch {
    /* best effort — a failed log must never break a call */
  }
}

/** Live call history for one user, newest first. */
export function watchCallHistory(
  uid: string,
  cb: (items: CallLog[]) => void,
): () => void {
  const q = query(logsRef(), where("userId", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          userId: String(data['userId'] ?? ""),
          otherId: String(data['otherId'] ?? ""),
          otherName: String(data['otherName'] ?? "Unknown"),
          otherPhoto: String(data['otherPhoto'] ?? ""),
          direction: (data['direction'] as CallDirection) ?? "outgoing",
          type: (data['type'] as "audio" | "video") ?? "audio",
          outcome: (data['outcome'] as CallOutcome) ?? "completed",
          durationSec: Number(data['durationSec'] ?? 0),
          createdAt: toMillis(data['createdAt']),
        } satisfies CallLog;
      });
      rows.sort((a, b) => b.createdAt - a.createdAt);
      cb(rows);
    },
    () => cb([]),
  );
}

export async function deleteCallHistoryItem(id: string) {
  try {
    await deleteDoc(doc(db, "callLogs", id));
  } catch {
    /* best effort */
  }
}

export async function clearCallHistory(uid: string) {
  try {
    const snap = await getDocs(query(logsRef(), where("userId", "==", uid)));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch {
    /* best effort */
  }
}

export function formatDuration(sec: number): string {
  if (sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function outcomeLabel(log: CallLog): string {
  const kind = log.type === "video" ? "Video call" : "Audio call";
  if (log.outcome === "completed") {
    return `${kind} · ${formatDuration(log.durationSec) || "0s"}`;
  }
  if (log.outcome === "declined") {
    return log.direction === "outgoing" ? `${kind} declined` : `${kind} you declined`;
  }
  if (log.outcome === "missed") return `Missed ${kind.toLowerCase()}`;
  return `${kind} · No answer`;
}
