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
import { getAudioContext, vibrate } from "../../lib/notify";
import { ringbackDataUri, ringtoneDataUri } from "../../lib/ringtone";
import { isNotifyEnabled } from "../../lib/notificationSettings";

export type CallType = "audio" | "video";
export type CallStatus = "ringing" | "accepted" | "rejected" | "ended";

export interface CallDoc {
  id: string;
  callerId: string;
  callerName: string;
  callerPhoto: string;
  calleeId: string;
  calleeName: string;
  calleePhoto: string;
  type: CallType;
  status: CallStatus;
  offer?: RTCSessionDescriptionInit | null;
  answer?: RTCSessionDescriptionInit | null;
  createdAt?: number;
  expiresAt?: number;
}

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:global.stun.twilio.com:3478",
      ],
    },
    // Free relay servers so the audio/video still flows when both sides are
    // behind mobile / carrier NAT where a direct connection is impossible.
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};

export const callRef = (callId: string) => doc(db, "calls", callId);

export const candidatesRef = (callId: string, side: "caller" | "callee") =>
  collection(db, "calls", callId, `${side}Candidates`);

export function watchCall(
  callId: string,
  cb: (call: CallDoc | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    callRef(callId),
    (snap) => {
      if (!snap.exists()) return cb(null);
      cb({ id: snap.id, ...(snap.data() as Omit<CallDoc, "id">) });
    },
    (error) => onError?.(error),
  );
}

export async function createCallDoc(
  data: Omit<CallDoc, "id" | "status" | "createdAt">,
): Promise<string> {
  const ref = doc(collection(db, "calls"));
  await setDoc(ref, {
    ...data,
    status: "ringing" as CallStatus,
    createdAt: serverTimestamp(),
    // Long enough that a callee woken by a push notification can open the app
    // and still find the call ringing.
    expiresAt: Date.now() + 90_000,
  });
  return ref.id;
}

export async function setCallStatus(callId: string, status: CallStatus) {
  await updateDoc(callRef(callId), { status });
}

export async function addCandidate(
  callId: string,
  side: "caller" | "callee",
  candidate: RTCIceCandidateInit,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await addDoc(candidatesRef(callId, side), candidate);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not publish an ICE candidate.");
}

/** Publishes a complete local SDP when possible, while never blocking forever. */
export async function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs = 3500,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      pc.removeEventListener("icegatheringstatechange", handleStateChange);
      clearTimeout(timer);
      resolve();
    };
    const handleStateChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener("icegatheringstatechange", handleStateChange);
    handleStateChange();
  });
}

/** Removes the call doc and its candidate subcollections. */
export async function cleanupCall(callId: string) {
  try {
    for (const side of ["caller", "callee"] as const) {
      const snap = await getDocs(candidatesRef(callId, side));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    await deleteDoc(callRef(callId));
  } catch {
    /* best effort */
  }
}

/**
 * Real looping ringtone.
 * Primary playback uses an <audio> element with a generated WAV loop so the
 * phone keeps ringing properly; if autoplay is blocked we fall back to the
 * WebAudio beep (which the shared unlocked AudioContext can still play).
 */
export function createRingtone() {
  return createTone({
    uri: ringtoneDataUri,
    volume: 1,
    vibration: [400, 200, 400],
    fallbackFreq: 660,
  });
}

/** Ringback the caller hears while the other side is ringing. */
export function createRingback() {
  return createTone({
    uri: ringbackDataUri,
    volume: 0.4,
    vibration: null,
    fallbackFreq: 440,
  });
}

function createTone(opts: {
  uri: () => string;
  volume: number;
  vibration: number[] | null;
  fallbackFreq: number;
}) {
  let audio: HTMLAudioElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let vibrateTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const beep = () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.4].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = opts.fallbackFreq;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.25 * opts.volume, now + offset + 0.05);
      gain.gain.linearRampToValueAtTime(0, now + offset + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.35);
    });
  };

  const startFallback = () => {
    if (timer || !running) return;
    beep();
    timer = setInterval(beep, 2000);
  };

  return {
    start() {
      if (running) return;
      running = true;
      try {
        if (isNotifyEnabled("calls", "sound")) {
          if (typeof Audio !== "undefined") {
            audio = new Audio(opts.uri());
            audio.loop = true;
            audio.volume = opts.volume;
            audio.play().catch(() => startFallback());
          } else {
            startFallback();
          }
        }
        if (opts.vibration && isNotifyEnabled("calls", "vibration")) {
          vibrate(opts.vibration);
          vibrateTimer = setInterval(() => vibrate(opts.vibration!), 2000);
        }
      } catch {
        startFallback();
      }
    },
    stop() {
      running = false;
      if (audio) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          /* noop */
        }
        audio = null;
      }
      if (timer) clearInterval(timer);
      timer = null;
      if (vibrateTimer) clearInterval(vibrateTimer);
      vibrateTimer = null;
      vibrate(0);
    },
  };
}


