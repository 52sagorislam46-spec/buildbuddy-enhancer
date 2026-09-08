/**
 * Messenger-style group calls (up to 5 people in one conversation).
 *
 * This is an additive layer that lives completely next to the existing 1:1
 * call flow in `calls.ts` / `CallProvider.tsx` — nothing there is changed.
 *
 * Topology: full mesh. Every joined participant keeps one RTCPeerConnection
 * per other joined participant, which is comfortable for 4–5 people.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { CallType } from "./calls";
import type { GroupMember } from "./types";

/**
 * Messenger-style: no hard cap — a group of any size can start a call and
 * everyone can join. Above `MESH_COMFORT_SIZE` joined people the sender
 * bitrate/resolution is scaled down so the mesh keeps up.
 */
export const MAX_GROUP_CALL_PARTICIPANTS = Number.POSITIVE_INFINITY;

/** Above this many people in one call we downscale outgoing media. */
export const MESH_COMFORT_SIZE = 5;

export type GroupCallStatus = "ringing" | "active" | "ended";
export type GroupParticipantState = "ringing" | "joined" | "left" | "declined";

export interface GroupCallDoc {
  id: string;
  groupId: string;
  groupName: string;
  groupPhoto: string;
  hostId: string;
  hostName: string;
  hostPhoto: string;
  type: CallType;
  status: GroupCallStatus;
  invitedIds: string[];
  members: GroupMember[];
  createdAt?: number;
  expiresAt?: number;
}

export interface GroupParticipantDoc {
  uid: string;
  displayName: string;
  photoURL: string;
  state: GroupParticipantState;
  updatedAt?: number;
}

export const groupCallRef = (callId: string) => doc(db, "groupCalls", callId);

export const participantsRef = (callId: string) =>
  collection(db, "groupCalls", callId, "participants");

export const participantRef = (callId: string, uid: string) =>
  doc(db, "groupCalls", callId, "participants", uid);

/** Stable id for a pair of peers, so both sides agree on one signaling doc. */
export function pairId(a: string, b: string) {
  return [a, b].sort().join("__");
}

/** The peer with the smaller uid always creates the offer. */
export function isOfferer(me: string, other: string) {
  return me < other;
}

export const peerRef = (callId: string, pair: string) =>
  doc(db, "groupCalls", callId, "peers", pair);

export const peerCandidatesRef = (
  callId: string,
  pair: string,
  side: "a" | "b",
) => collection(db, "groupCalls", callId, "peers", pair, `${side}Candidates`);

/** Which candidate bucket a given uid writes into for a pair. */
export function candidateSide(me: string, other: string): "a" | "b" {
  return [me, other].sort()[0] === me ? "a" : "b";
}

export async function createGroupCallDoc(
  data: Omit<GroupCallDoc, "id" | "status" | "createdAt" | "expiresAt">,
): Promise<string> {
  const ref = doc(collection(db, "groupCalls"));
  await setDoc(ref, {
    ...data,
    status: "ringing" as GroupCallStatus,
    createdAt: serverTimestamp(),
    expiresAt: Date.now() + 90_000,
  });
  return ref.id;
}

export async function setGroupCallStatus(
  callId: string,
  status: GroupCallStatus,
) {
  try {
    await updateDoc(groupCallRef(callId), { status });
  } catch {
    /* the call doc may already be gone */
  }
}

export async function setParticipantState(
  callId: string,
  participant: Omit<GroupParticipantDoc, "updatedAt">,
) {
  await setDoc(
    participantRef(callId, participant.uid),
    { ...participant, updatedAt: Date.now() },
    { merge: true },
  );
}

export function watchGroupCall(
  callId: string,
  cb: (call: GroupCallDoc | null) => void,
): () => void {
  return onSnapshot(
    groupCallRef(callId),
    (snap) => {
      if (!snap.exists()) return cb(null);
      cb({ id: snap.id, ...(snap.data() as Omit<GroupCallDoc, "id">) });
    },
    () => cb(null),
  );
}

export function watchParticipants(
  callId: string,
  cb: (list: GroupParticipantDoc[]) => void,
): () => void {
  return onSnapshot(
    participantsRef(callId),
    (snap) => cb(snap.docs.map((d) => d.data() as GroupParticipantDoc)),
    () => cb([]),
  );
}

export async function addPeerCandidate(
  callId: string,
  pair: string,
  side: "a" | "b",
  candidate: RTCIceCandidateInit,
) {
  try {
    await addDoc(peerCandidatesRef(callId, pair, side), candidate);
  } catch {
    /* best effort — ICE has other paths */
  }
}

export async function savePeerOffer(
  callId: string,
  pair: string,
  offer: RTCSessionDescriptionInit,
) {
  await setDoc(
    peerRef(callId, pair),
    { offer: { type: offer.type, sdp: offer.sdp }, offerAt: Date.now() },
    { merge: true },
  );
}

export async function savePeerAnswer(
  callId: string,
  pair: string,
  answer: RTCSessionDescriptionInit,
) {
  await setDoc(
    peerRef(callId, pair),
    { answer: { type: answer.type, sdp: answer.sdp }, answerAt: Date.now() },
    { merge: true },
  );
}

export function watchPeer(
  callId: string,
  pair: string,
  cb: (data: {
    offer?: RTCSessionDescriptionInit | null;
    answer?: RTCSessionDescriptionInit | null;
  }) => void,
): () => void {
  return onSnapshot(
    peerRef(callId, pair),
    (snap) => cb((snap.data() ?? {}) as never),
    () => cb({}),
  );
}

/** Removes a finished group call and its signaling data. */
export async function cleanupGroupCall(callId: string) {
  try {
    const peers = await getDocs(collection(db, "groupCalls", callId, "peers"));
    for (const peer of peers.docs) {
      for (const side of ["a", "b"] as const) {
        const cands = await getDocs(peerCandidatesRef(callId, peer.id, side));
        await Promise.all(cands.docs.map((c) => deleteDoc(c.ref)));
      }
      await deleteDoc(peer.ref);
    }
    const parts = await getDocs(participantsRef(callId));
    await Promise.all(parts.docs.map((p) => deleteDoc(p.ref)));
    await deleteDoc(groupCallRef(callId));
  } catch {
    /* best effort */
  }
}
