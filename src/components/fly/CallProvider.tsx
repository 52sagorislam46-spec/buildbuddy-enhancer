import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  collection,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MoreVertical,
  Phone,
  PhoneOff,
  RefreshCw,
  Wand2,
  UserPlus,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";

import { db, DEFAULT_AVATAR } from "../../lib/firebase";
import {
  BACKGROUND_OPTIONS,
  COLOR_FILTER_OPTIONS,
  DEFAULT_EFFECTS,
  EFFECT_OPTIONS,
  TOUCH_UP_OPTIONS,
  VideoEffectProcessor,
  isEffectsActive,
  type EffectSettings,
} from "./videoEffects";
import { Avatar } from "./Avatar";

import { useAuth } from "./AuthContext";
import {
  addCandidate,
  callRef,
  candidatesRef,
  cleanupCall,
  createCallDoc,
  createRingback,
  createRingtone,
  RTC_CONFIG,
  setCallStatus,
  watchCall,
  waitForIceGathering,
  type CallDoc,
  type CallType,
} from "./calls";
import { saveCallLog } from "./chat";
import { saveCallHistory } from "./callHistory";
import { CallContext, useCalls } from "./callContext";
import {
  bindAudioUnlock,
  showNotification,
} from "../../lib/notify";
import type { UserProfile } from "./types";
import { pushToUsers } from "../../lib/push";
import { subscribePresence, type PresenceState } from "./presence";

type Phase = "outgoing" | "incoming" | "connecting" | "connected";

/** Error thrown when mic/cam access is unavailable, blocked or rejected. */
export class MediaPermissionError extends Error {
  blocked: boolean;
  constructor(message: string, blocked: boolean) {
    super(message);
    this.name = "MediaPermissionError";
    this.blocked = blocked;
  }
}

/** Reads the browser permission state without triggering a prompt. */
async function readPermissionState(
  name: "microphone" | "camera",
): Promise<PermissionState | null> {
  try {
    const perms = navigator.permissions as Navigator["permissions"] | undefined;
    if (!perms?.query) return null;
    const status = await perms.query({
      name: name as PermissionName,
    });
    return status.state;
  } catch {
    return null;
  }
}

/** Requests mic/cam with clear, human-readable permission errors. */
async function getLocalMedia(type: CallType): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MediaPermissionError(
      "This browser cannot access the microphone or camera. Try a modern browser over HTTPS.",
      true,
    );
  }

  // If a previous prompt was permanently denied the browser will not ask
  // again — detect it up-front and explain how to re-enable it.
  const needed: Array<"microphone" | "camera"> =
    type === "video" ? ["microphone", "camera"] : ["microphone"];
  const states = await Promise.all(needed.map(readPermissionState));
  if (states.some((s) => s === "denied")) {
    throw new MediaPermissionError(
      type === "video"
        ? "Camera and microphone access is blocked for this site. Allow it in your browser settings, then try the call again."
        : "Microphone access is blocked for this site. Allow it in your browser settings, then try the call again.",
      true,
    );
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video:
        type === "video"
          ? {
              facingMode: { ideal: "user" },
              // A moderate capture size keeps mobile CPUs and mobile data
              // links comfortable, which is what stops the freeze / resume
              // stutter during a live call.
              width: { ideal: 960, max: 1280 },
              height: { ideal: 540, max: 720 },
              frameRate: { ideal: 24, max: 30 },
            }
          : false,

    });
  } catch (err) {
    const name = (err as DOMException)?.name ?? "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MediaPermissionError(
        type === "video"
          ? "You denied camera and microphone access, so the call cannot start. Tap the lock icon in the address bar to allow it."
          : "You denied microphone access, so the call cannot start. Tap the lock icon in the address bar to allow it.",
        true,
      );
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new MediaPermissionError(
        type === "video"
          ? "No camera or microphone was found on this device."
          : "No microphone was found on this device.",
        false,
      );
    }
    if (name === "NotReadableError" || name === "AbortError") {
      throw new MediaPermissionError(
        "Your microphone or camera is being used by another app. Close it and try again.",
        false,
      );
    }
    throw new MediaPermissionError(
      "Could not access your microphone or camera.",
      false,
    );
  }
}




export function CallProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();

  const [call, setCall] = useState<CallDoc | null>(null);
  const [phase, setPhase] = useState<Phase>("outgoing");
  const [role, setRole] = useState<"caller" | "callee">("caller");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [minimized, setMinimized] = useState(false);
  /** Messenger-style: tap the small tile to swap self/remote views. */
  const [swapped, setSwapped] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped whenever the local camera stream/track changes. */
  const [localPreviewTick, setLocalPreviewTick] = useState(0);
  /** Live video effects (touch up / effects / backgrounds / color filters). */
  const [effects, setEffects] = useState<EffectSettings>(DEFAULT_EFFECTS);
  const [effectPanel, setEffectPanel] = useState<
    "touchup" | "effects" | "backgrounds" | "color" | null
  >(null);
  const processorRef = useRef<VideoEffectProcessor | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);


  const [error, setError] = useState<string | null>(null);
  const [permissionIssue, setPermissionIssue] = useState<string | null>(null);


  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  const ringtoneRef = useRef<ReturnType<typeof createRingtone> | null>(null);
  const ringbackRef = useRef<ReturnType<typeof createRingback> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const callIdRef = useRef<string | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [remoteReady, setRemoteReady] = useState(false);
  /**
   * Bumped when the remote video track arrives or starts producing frames.
   * Forces the <video> element to re-bind so it never stays black.
   */
  const [remoteVideoTick, setRemoteVideoTick] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef = useRef(false);
  const camOffRef = useRef(false);
  const teardownRef = useRef<
    ((notifyStatus?: "ended" | "rejected") => void) | null
  >(null);
  const appliedOfferRef = useRef<string | null>(null);
  const appliedAnswerRef = useRef<string | null>(null);
  /**
   * ICE candidates that arrived before the remote description was set.
   * Adding them too early throws and the call ends up with no audio, so they
   * are queued here and flushed as soon as the description is in place.
   */
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  /** Applies every queued remote candidate once negotiation allows it. */
  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const data of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data));
      } catch {
        /* ignore individual bad candidates */
      }
    }
  }, []);

  /** Info needed to write a call log after the call is over. */
  const logInfoRef = useRef<{
    role: "caller" | "callee";
    meId: string;
    otherId: string;
    otherName: string;
    otherPhoto: string;
    type: CallType;
    connectedAt: number | null;
  } | null>(null);

  if (!ringtoneRef.current && typeof window !== "undefined") {
    ringtoneRef.current = createRingtone();
  }
  if (!ringbackRef.current && typeof window !== "undefined") {
    ringbackRef.current = createRingback();
  }

  useEffect(() => {
    bindAudioUnlock();
  }, []);

  const writeCallLog = useCallback(
    (outcome: "ended" | "rejected" | "missed") => {
      const info = logInfoRef.current;
      logInfoRef.current = null;
      if (!info) return;
      const label = info.type === "video" ? "Video call" : "Audio call";
      const secs = info.connectedAt
        ? Math.max(1, Math.round((Date.now() - info.connectedAt) / 1000))
        : 0;

      // Every participant stores their own call-history row.
      void saveCallHistory({
        userId: info.meId,
        otherId: info.otherId,
        otherName: info.otherName,
        otherPhoto: info.otherPhoto,
        direction: info.role === "caller" ? "outgoing" : "incoming",
        type: info.type,
        outcome: info.connectedAt
          ? "completed"
          : outcome === "rejected"
            ? "declined"
            : info.role === "callee"
              ? "missed"
              : "no-answer",
        durationSec: secs,
      });

      // Only the caller writes the chat-thread log so it never duplicates.
      if (info.role !== "caller") return;
      let text: string;
      if (info.connectedAt) {
        const mins = Math.floor(secs / 60);
        const rest = secs % 60;
        const dur = mins ? `${mins}m ${rest}s` : `${rest}s`;
        text = `${label} · ${dur}`;
      } else {
        text = outcome === "rejected" ? `${label} declined` : `${label} · No answer`;
      }
      void saveCallLog(info.meId, info.otherId, text).catch(() => {});
    },
    [],
  );


  const teardown = useCallback(
    (
      notifyStatus?: "ended" | "rejected",
      outcome: "ended" | "rejected" | "missed" = notifyStatus ?? "ended",
    ) => {
      const id = callIdRef.current;
      ringtoneRef.current?.stop();
      ringbackRef.current?.stop();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
      retryTimerRef.current = null;
      dropTimerRef.current = null;
      appliedOfferRef.current = null;
      appliedAnswerRef.current = null;
      pendingCandidatesRef.current = [];
      setReconnecting(false);
      unsubsRef.current.forEach((u) => {
        try {
          u();
        } catch {
          /* noop */
        }
      });
      unsubsRef.current = [];
      processorRef.current?.stop();
      processorRef.current = null;
      processedStreamRef.current = null;
      setEffects(DEFAULT_EFFECTS);
      setEffectPanel(null);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;

      remoteStreamRef.current = null;
      setRemoteReady(false);
      setRemoteVideoTick(0);
      try {
        pcRef.current?.close();
      } catch {
        /* noop */
      }
      pcRef.current = null;
      callIdRef.current = null;
      setCall(null);
      setMuted(false);
      setCamOff(false);
      mutedRef.current = false;
      camOffRef.current = false;
      writeCallLog(outcome);
      if (id) {
        void (async () => {
          if (notifyStatus) {
            try {
              await setCallStatus(id, notifyStatus);
            } catch {
              /* noop */
            }
          }
          setTimeout(() => void cleanupCall(id), 1500);
        })();
      }
    },
    [writeCallLog],
  );

  teardownRef.current = teardown;


  const attachRemote = useCallback((stream: MediaStream) => {
    remoteStreamRef.current = stream;
    setRemoteReady(true);
  }, []);

  /** Keep media elements bound to the remote stream and force playback. */
  useEffect(() => {
    const stream = remoteStreamRef.current;
    if (!stream) return;
    const audio = remoteAudioRef.current;
    const video = remoteVideoRef.current;
    if (audio && audio.srcObject !== stream) {
      audio.srcObject = stream;
      audio.muted = false;
      audio.volume = 1;
    }
    // Always re-assign: the video track can be added to the same stream
    // after the first bind, and some mobile browsers need a fresh srcObject
    // to start rendering frames instead of a black box.
    if (video) video.srcObject = stream;
    // The <video> element only shows the picture — all audio comes from the
    // dedicated <audio> element so the two never play the same sound twice.
    if (video) video.muted = true;
    void audio?.play().catch(() => {
      // Autoplay was blocked: retry on the next user interaction.
      const retry = () => {
        void audio?.play().catch(() => {});
        window.removeEventListener("pointerdown", retry);
      };
      window.addEventListener("pointerdown", retry, { once: true });
    });
    void video?.play().catch(() => {
      // Autoplay was blocked: retry on the next user interaction.
      const retry = () => {
        void video?.play().catch(() => {});
        window.removeEventListener("pointerdown", retry);
      };
      window.addEventListener("pointerdown", retry, { once: true });
    });
  }, [remoteReady, remoteVideoTick, phase, call, swapped]);

  /**
   * Keep the local preview bound to our own camera stream. The preview
   * <video> element is remounted when the phase changes, so re-binding here
   * makes sure we always see ourselves during the call.
   */
  useEffect(() => {
    const stream = processedStreamRef.current ?? localStreamRef.current;
    const video = localVideoRef.current;
    if (!stream || !video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = true;
    void video.play().catch(() => {});
  }, [phase, call, camOff, localPreviewTick]);

  /**
   * Callback ref: whenever the preview <video> is (re)mounted we bind the
   * current camera stream straight away, so the small self-view is never a
   * blank rectangle.
   */
  const bindLocalVideo = useCallback((el: HTMLVideoElement | null) => {
    (localVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current =
      el;
    if (!el) return;
    const stream = processedStreamRef.current ?? localStreamRef.current;
    if (!stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.muted = true;
    el.playsInline = true;
    void el.play().catch(() => {});
  }, []);

  /**
   * Some phones silently pause the preview/remote <video> (tab switch, camera
   * flip, effect pipeline restart). Nudge them back to playing so the call
   * never shows a frozen black rectangle.
   */
  useEffect(() => {
    if (!call) return;
    const kick = () => {
      const local = localVideoRef.current;
      const stream = processedStreamRef.current ?? localStreamRef.current;
      if (local && stream) {
        if (local.srcObject !== stream) local.srcObject = stream;
        if (local.paused) void local.play().catch(() => {});
      }
      const remote = remoteVideoRef.current;
      if (remote && remote.srcObject && remote.paused) {
        void remote.play().catch(() => {});
      }
    };
    const timer = setInterval(kick, 1500);
    document.addEventListener("visibilitychange", kick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [call]);






  const buildPeer = useCallback(
    async (type: CallType, side: "caller" | "callee", callId: string) => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      const stream = await getLocalMedia(type);
      localStreamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      // Tell the encoder this is live motion and let it lower resolution
      // instead of freezing when the network or CPU gets tight.
      try {
        stream.getVideoTracks().forEach((t) => (t.contentHint = "motion"));
        stream.getAudioTracks().forEach((t) => (t.contentHint = "speech"));
        const videoSender = pc
          .getSenders()
          .find((s) => s.track?.kind === "video");
        if (videoSender) {
          const params = videoSender.getParameters();
          params.degradationPreference = "balanced";
          if (!params.encodings || !params.encodings.length) {
            params.encodings = [{}];
          }
          params.encodings[0] = {
            ...params.encodings[0],
            maxBitrate: 900_000,
            maxFramerate: 24,
          };
          await videoSender.setParameters(params);
        }
      } catch {
        /* not supported everywhere */
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setLocalPreviewTick((n) => n + 1);
      // Keep toggles applied across renegotiation.
      stream.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
      stream.getVideoTracks().forEach((t) => (t.enabled = !camOffRef.current));




      const remote = new MediaStream();
      pc.ontrack = (e) => {
        // Some mobile browsers emit a track event without e.streams[0].
        // Adding e.track directly prevents calls that ring but have no media.
        if (!remote.getTracks().some((t) => t.id === e.track.id)) {
          remote.addTrack(e.track);
        }
        if (e.track.kind === "video") {
          // The video track often arrives (or starts emitting frames) after
          // the element was first bound. Re-binding on arrival and on the
          // first frame ("unmute") is what keeps the remote picture from
          // staying a black rectangle.
          setRemoteVideoTick((n) => n + 1);
          e.track.onunmute = () => setRemoteVideoTick((n) => n + 1);
        }
        attachRemote(remote);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          void addCandidate(callId, side, e.candidate.toJSON()).catch(() => {
            if (pc === pcRef.current) {
              setNotice("Network is reconnecting…");
            }
          });
        }
      };

      const clearTimers = () => {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
        retryTimerRef.current = null;
        dropTimerRef.current = null;
      };

      const markConnected = () => {
        clearTimers();
        setReconnecting(false);
        setPhase("connected");
        if (logInfoRef.current && !logInfoRef.current.connectedAt) {
          logInfoRef.current.connectedAt = Date.now();
        }
      };

      const scheduleRecovery = () => {
        setReconnecting(true);
        setPhase("connecting");
        if (!retryTimerRef.current && side === "caller") {
          // Give the network a moment, then try an ICE restart.
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            void (async () => {
              const current = pcRef.current;
              if (!current || current.connectionState === "connected") return;
              try {
                const offer = await current.createOffer({ iceRestart: true });
                await current.setLocalDescription(offer);
                await waitForIceGathering(current);
                const localOffer = current.localDescription ?? offer;
                await updateDoc(callRef(callId), {
                  offer: { type: localOffer.type, sdp: localOffer.sdp },
                  restartAt: Date.now(),
                });
              } catch {
                /* will fall through to the drop timer */
              }
            })();
          }, 1500);
        }
        if (!dropTimerRef.current) {
          // Stop trying after 30s of no connection.
          dropTimerRef.current = setTimeout(() => {
            dropTimerRef.current = null;
            if (pcRef.current && pcRef.current.connectionState !== "connected") {
              setError("Call disconnected.");
              teardownRef.current?.("ended");
            }
          }, 30000);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc !== pcRef.current) return;
        if (pc.connectionState === "connected") {
          markConnected();
          return;
        }
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        ) {
          scheduleRecovery();
        }
      };
      pc.oniceconnectionstatechange = () => {
        if (pc !== pcRef.current) return;
        if (
          pc.iceConnectionState === "connected" ||
          pc.iceConnectionState === "completed"
        ) {
          markConnected();
        } else if (
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "disconnected"
        ) {
          scheduleRecovery();
        }
      };
      return pc;
    },
    [attachRemote],
  );

  const listenRemoteCandidates = useCallback(
    (callId: string, side: "caller" | "callee") => {
      const unsub = onSnapshot(candidatesRef(callId, side), (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const data = change.doc.data() as RTCIceCandidateInit;
          pendingCandidatesRef.current.push(data);
        });
        void flushCandidates();
      });
      unsubsRef.current.push(unsub);
    },
    [flushCandidates],
  );

  /* ---------------- outgoing ---------------- */
  const startCall = useCallback(
    async (other: UserProfile, type: CallType) => {
      if (!user || callIdRef.current) return;
      setError(null);
      try {
        const callId = await createCallDoc({
          callerId: user.uid,
          callerName: profile?.displayName ?? user.displayName ?? "Someone",
          callerPhoto: profile?.photoURL ?? DEFAULT_AVATAR,
          calleeId: other.uid,
          calleeName: other.displayName,
          calleePhoto: other.photoURL,
          type,
        });
        callIdRef.current = callId;
        logInfoRef.current = {
          role: "caller",
          meId: user.uid,
          otherId: other.uid,
          otherName: other.displayName,
          otherPhoto: other.photoURL,
          type,
          connectedAt: null,
        };
        setRole("caller");
        setPhase("outgoing");
        ringbackRef.current?.start();
        setCall({
          id: callId,
          callerId: user.uid,
          callerName: profile?.displayName ?? "You",
          callerPhoto: profile?.photoURL ?? DEFAULT_AVATAR,
          calleeId: other.uid,
          calleeName: other.displayName,
          calleePhoto: other.photoURL,
          type,
          status: "ringing",
        });

        // Fire the push right away so a closed app starts ringing while the
        // WebRTC offer is still being prepared.
        void pushToUsers({
          uids: [other.uid],
          title: `Incoming ${type} call`,
          body: `${profile?.displayName ?? user.displayName ?? "Someone"} is calling you`,
          icon: profile?.photoURL ?? DEFAULT_AVATAR,
          link: `/?call=${encodeURIComponent(callId)}`,
          tag: `call_${callId}`,
          event: "calls",
        });

        const pc = await buildPeer(type, "caller", callId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        const localOffer = pc.localDescription ?? offer;
        await updateDoc(callRef(callId), {
          offer: { type: localOffer.type, sdp: localOffer.sdp },
        });
        listenRemoteCandidates(callId, "callee");

        unsubsRef.current.push(
          watchCall(callId, (data) => {
            if (!data) return;
            if (data.status === "rejected" || data.status === "ended") {
              ringbackRef.current?.stop();
              setError(data.status === "rejected" ? "Call declined" : null);
              teardown();
              return;
            }
            const pcNow = pcRef.current;
            if (
              data.status === "accepted" &&
              data.answer?.sdp &&
              pcNow &&
              data.answer.sdp !== appliedAnswerRef.current &&
              pcNow.signalingState === "have-local-offer"
            ) {
              setPhase("connecting");
              ringbackRef.current?.stop();
              appliedAnswerRef.current = data.answer.sdp;
              void (async () => {
                try {
                  await pcNow.setRemoteDescription(
                    new RTCSessionDescription(data.answer!),
                  );
                  await flushCandidates();
                } catch {
                  /* noop */
                }
              })();
            }
          }),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not start the call.";
        setError(msg);
        if (e instanceof MediaPermissionError) setPermissionIssue(msg);
        teardown("ended");
      }

    },
    [user, profile, buildPeer, listenRemoteCandidates, teardown],
  );

  /* ---------------- incoming listener ---------------- */
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!user) return;
    // Keep this query to one equality filter so incoming calls still work
    // before a composite Firestore index has been created.
    const q = query(
      collection(db, "calls"),
      where("calleeId", "==", user.uid),
    );
    return onSnapshot(q, (snap) => {
      if (callIdRef.current) return;
      const candidates = snap.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<CallDoc, "id">),
        }))
        .filter(
          (item) =>
            item.status === "ringing" &&
            !!item.offer &&
            (!item.expiresAt || item.expiresAt > Date.now()),
        )
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      const first = candidates[0];
      if (!first) return;
      const data = first;
      callIdRef.current = data.id;
      logInfoRef.current = {
        role: "callee",
        meId: user.uid,
        otherId: data.callerId,
        otherName: data.callerName,
        otherPhoto: data.callerPhoto,
        type: data.type,
        connectedAt: null,
      };
      setRole("callee");
      setPhase("incoming");
      setCall(data);
      ringtoneRef.current?.start();
      showNotification(
        `Incoming ${data.type} call`,
        `${data.callerName} is calling you`,
        { icon: data.callerPhoto, event: "calls" },
      );
      unsubsRef.current.push(
          watchCall(data.id, (live) => {
          if (!live || live.status === "ended" || live.status === "rejected") {
            if (phaseRef.current === "incoming") teardown();
          }
        }),
      );
    }, () => setNotice("Call notifications are temporarily unavailable."));
  }, [user, teardown]);

  const accept = useCallback(async () => {
    if (!call || !call.offer) return;
    ringtoneRef.current?.stop();
    setPhase("connecting");
    try {
      const pc = await buildPeer(call.type, "callee", call.id);
      await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
      appliedOfferRef.current = call.offer.sdp ?? null;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);
      const localAnswer = pc.localDescription ?? answer;
      await updateDoc(callRef(call.id), {
        answer: { type: localAnswer.type, sdp: localAnswer.sdp },
        status: "accepted",
      });
      listenRemoteCandidates(call.id, "caller");
      await flushCandidates();
      unsubsRef.current.push(
        watchCall(call.id, (live) => {
          if (!live || live.status === "ended") {
            teardown();
            return;
          }
          // Caller performed an ICE restart: answer the fresh offer.
          const current = pcRef.current;
          if (
            live.offer?.sdp &&
            current &&
            live.offer.sdp !== appliedOfferRef.current
          ) {
            appliedOfferRef.current = live.offer.sdp;
            void (async () => {
              try {
                await current.setRemoteDescription(
                  new RTCSessionDescription(live.offer!),
                );
                const fresh = await current.createAnswer();
                await current.setLocalDescription(fresh);
                await waitForIceGathering(current);
                const localAnswer = current.localDescription ?? fresh;
                await updateDoc(callRef(call.id), {
                  answer: { type: localAnswer.type, sdp: localAnswer.sdp },
                });
                await flushCandidates();
              } catch {
                /* noop */
              }
            })();
          }
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not accept the call.";
      setError(msg);
      if (e instanceof MediaPermissionError) setPermissionIssue(msg);
      teardown("ended");
    }

  }, [call, buildPeer, listenRemoteCandidates, teardown, flushCandidates]);

  const reject = useCallback(() => teardown("rejected"), [teardown]);
  const hangUp = useCallback(() => teardown("ended"), [teardown]);

  useEffect(() => () => teardown(), [teardown]);

  /** Auto-hides the small in-call notice pill. */
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(id);
  }, [notice]);

  /** Closes the options sheet whenever the call ends. */
  useEffect(() => {
    if (!call) {
      setMenuOpen(false);
      setNotice(null);
    }
  }, [call]);

  /** Live call timer, restarted for every new call. */
  useEffect(() => {
    if (!call) {
      setElapsed(0);
      setMinimized(false);
      setSpeakerOn(true);
      setFacing("user");
      setSwapped(false);
      return;
    }
    if (phase !== "connected") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [call, phase]);


  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    if (!tracks.length) return;
    const next = !mutedRef.current;
    tracks.forEach((t) => (t.enabled = !next));
    mutedRef.current = next;
    setMuted(next);
  };
  const toggleCam = () => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const next = !camOffRef.current;
    tracks.forEach((t) => (t.enabled = !next));
    // When effects are on, the sent track is the processed canvas track —
    // it has to follow the camera toggle too.
    processedStreamRef.current
      ?.getVideoTracks()
      .forEach((t) => (t.enabled = !next));
    camOffRef.current = next;
    setCamOff(next);
  };


  /** Loudspeaker on/off for the incoming audio. */
  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    const audio = remoteAudioRef.current as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (!audio) return;
    audio.volume = next ? 1 : 0.35;
    try {
      void audio.setSinkId?.(next ? "" : "default")?.catch(() => {});
    } catch {
      /* not supported everywhere */
    }
  };

  /**
   * Applies the chosen live effects to the outgoing video track and the local
   * preview. When nothing is selected the raw camera track is restored.
   */
  const applyEffects = useCallback(
    async (next: EffectSettings) => {
      setEffects(next);
      const stream = localStreamRef.current;
      const rawTrack = stream?.getVideoTracks()[0];
      const sender = pcRef.current
        ?.getSenders()
        .find((s) => s.track?.kind === "video");

      if (!stream || !rawTrack) return;

      if (!isEffectsActive(next)) {
        processorRef.current?.stop();
        processorRef.current = null;
        processedStreamRef.current = null;
        try {
          if (sender) await sender.replaceTrack(rawTrack);
        } catch {
          /* noop */
        }
        setLocalPreviewTick((n) => n + 1);
        return;
      }

      if (processorRef.current && processedStreamRef.current) {
        processorRef.current.setSettings(next);
        return;
      }

      const processor = new VideoEffectProcessor();
      const out = processor.start(rawTrack, next);
      if (!out) {
        processor.stop();
        setNotice("Effects are not supported on this device.");
        return;
      }
      processorRef.current = processor;
      processedStreamRef.current = out;
      const outTrack = out.getVideoTracks()[0];
      try {
        if (outTrack) {
          outTrack.contentHint = "motion";
          outTrack.enabled = !camOffRef.current;
        }
        if (sender && outTrack) await sender.replaceTrack(outTrack);
      } catch {
        /* noop */
      }

      setLocalPreviewTick((n) => n + 1);
    },
    [],
  );

  /** Re-processes the feed after a camera switch so effects keep working. */
  useEffect(() => {
    if (!processorRef.current) return;
    const rawTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!rawTrack) return;
    const current = effects;
    processorRef.current.stop();
    processorRef.current = null;
    processedStreamRef.current = null;
    void applyEffects(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);


  /** Flips between the front and back camera during a video call. */
  const switchCamera = async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = facing === "user" ? "environment" : "user";
    const current = stream.getVideoTracks()[0];

    const applyTrack = async (track: MediaStreamTrack) => {
      const pc = pcRef.current;
      const sender = pc?.getSenders().find((s) => s.track?.kind === "video");
      try {
        track.contentHint = "motion";
      } catch {
        /* noop */
      }
      if (sender) await sender.replaceTrack(track);

      if (current && current !== track) {
        current.stop();
        stream.removeTrack(current);
      }
      track.enabled = !camOffRef.current;
      if (!stream.getVideoTracks().includes(track)) stream.addTrack(track);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => {});
      }
      setFacing(next);
      setLocalPreviewTick((n) => n + 1);
    };

    // Releasing the current camera first is required on most Android
    // browsers — otherwise opening the other lens fails or silently returns
    // the same front camera.
    const releaseCurrent = () => {
      try {
        current?.stop();
      } catch {
        /* noop */
      }
    };

    // Some phones silently hand back the SAME front camera even when the
    // back one was requested — verify what we actually got before accepting.
    const matchesRequest = (track: MediaStreamTrack) => {
      const actual = track.getSettings().facingMode;
      if (!actual) return true; // browser does not report it — trust the request
      if (next === "environment") return actual === "environment";
      return actual === "user";
    };

    // 1) Ask explicitly for the other lens.
    for (const constraint of [
      { facingMode: { exact: next } },
      { facingMode: next },
    ] as MediaTrackConstraints[]) {
      try {
        releaseCurrent();
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: {
            ...constraint,
            width: { ideal: 960, max: 1280 },
            height: { ideal: 540, max: 720 },
            frameRate: { ideal: 24, max: 30 },

          },
          audio: false,
        });
        const track = fresh.getVideoTracks()[0];
        if (track && matchesRequest(track)) {
          await applyTrack(track);
          return;
        }
        // Wrong lens came back — release it and keep trying.
        track?.stop();
      } catch {
        /* try the next strategy */
      }
    }

    // 2) Some browsers only expose multiple deviceIds — try EVERY other
    // camera, not just the first, until one gives the lens we asked for.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput" && d.deviceId);
      const currentId = current?.getSettings().deviceId;
      for (const cam of cams) {
        if (cam.deviceId === currentId) continue;
        try {
          releaseCurrent();
          const fresh = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cam.deviceId } },
            audio: false,
          });
          const track = fresh.getVideoTracks()[0];
          if (track && matchesRequest(track)) {
            await applyTrack(track);
            return;
          }
          track?.stop();
        } catch {
          /* try the next camera */
        }
      }
    } catch {
      /* fall through */
    }

    // 3) Last resort: change facing mode on the existing track.
    try {
      await current?.applyConstraints({ facingMode: next });
      if (current && current.readyState === "live") {
        current.enabled = !camOffRef.current;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setFacing(next);
        setLocalPreviewTick((n) => n + 1);
        return;
      }
    } catch {
      /* nothing worked */
    }

    // Nothing worked — restore a working camera so the preview is not dead.
    if (!current || current.readyState !== "live") {
      try {
        const restore = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        const track = restore.getVideoTracks()[0];
        if (track) {
          const pc = pcRef.current;
          const sender = pc?.getSenders().find((s) => s.track?.kind === "video");
          if (sender) await sender.replaceTrack(track);
          if (current) stream.removeTrack(current);
          track.enabled = !camOffRef.current;
          stream.addTrack(track);
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
          setLocalPreviewTick((n) => n + 1);
        }
      } catch {
        /* noop */
      }
    }

    setNotice("No second camera available on this device.");
  };

  /** Shares an invite link so someone else can join the conversation. */
  const addPeople = async () => {
    setMenuOpen(false);
    const link =
      typeof window !== "undefined"
        ? `${window.location.origin}/?call=${call?.id ?? ""}`
        : "";
    const shareData = {
      title: "Join my Fly call",
      text: `${profile?.displayName ?? "A friend"} invited you to a call on Fly.`,
      url: link,
    };
    try {
      const nav = navigator as Navigator & {
        share?: (d: typeof shareData) => Promise<void>;
      };
      if (nav.share) {
        await nav.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(link);
      setNotice("Invite link copied.");
    } catch {
      setNotice("Could not share the invite link.");
    }
  };


  const value = useMemo(
    () => ({ startCall, busy: !!call }),
    [startCall, call],
  );

  const peerName =
    call && (role === "caller" ? call.calleeName : call.callerName);
  const peerPhoto =
    call && (role === "caller" ? call.calleePhoto : call.callerPhoto);
  const peerUid = call ? (role === "caller" ? call.calleeId : call.callerId) : null;
  const durationLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60,
  ).padStart(2, "0")}`;

  /** Live online/offline state of the other person during a call. */
  const [peerPresence, setPeerPresence] = useState<PresenceState | null>(null);
  useEffect(() => {
    if (!peerUid) {
      setPeerPresence(null);
      return;
    }
    return subscribePresence(peerUid, setPeerPresence);
  }, [peerUid]);

  /** Short status label for me and for the other person. */
  const myStatus =
    phase === "connected"
      ? reconnecting
        ? "Reconnecting"
        : "Online"
      : phase === "connecting"
        ? "Connecting"
        : phase === "outgoing"
          ? "Calling"
          : "Standby";
  const peerStatus =
    phase === "connected"
      ? remoteReady
        ? "Online"
        : "Connecting"
      : phase === "connecting"
        ? "Connecting"
        : phase === "incoming"
          ? "Calling"
          : peerPresence?.online || peerPresence?.reachable
            ? "Ringing"
            : "Standby";
  const statusDot = (status: string) =>
    status === "Online"
      ? "bg-emerald-400"
      : status === "Standby"
        ? "bg-white/40"
        : "bg-amber-400";



  return (
    <CallContext.Provider value={value}>
      {children}

      {error && !call && !permissionIssue && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-full bg-gray-900 text-white text-sm shadow-lg">
          {error}
        </div>
      )}

      {permissionIssue && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-6">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
              <MicOff size={22} />
            </div>
            <h3 className="text-base font-semibold text-gray-900">
              Permission needed
            </h3>
            <p className="mt-2 text-sm text-gray-600">{permissionIssue}</p>
            <button
              onClick={() => {
                setPermissionIssue(null);
                setError(null);
              }}
              className="mt-4 w-full h-10 rounded-full bg-sky-500 text-white text-sm font-semibold active:scale-95 transition-transform"
            >
              Got it
            </button>
          </div>
        </div>
      )}


      {call && (
        <div
          className={
            minimized
              ? "fixed bottom-24 right-3 z-[60] w-36 rounded-2xl overflow-hidden bg-slate-900 text-white shadow-2xl border border-white/15 flex flex-col"
              : "fixed inset-0 h-[100dvh] z-[60] bg-gradient-to-b from-slate-900 to-slate-800 text-white flex flex-col overflow-hidden"
          }
        >
          <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

          {!minimized && (
            <div className="absolute top-0 left-0 right-0 z-20 flex items-center px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
              <button
                onClick={() => setMinimized(true)}
                aria-label="Minimize call"
                className="w-11 h-11 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-white active:scale-90 transition-transform"
              >
                <Minimize2 size={20} />
              </button>
              <div className="flex-1 min-w-0 px-2 text-center">
                <p className="truncate text-lg font-semibold text-white drop-shadow">
                  {peerName ?? "Peer"}
                </p>
                <p className="text-sm text-white/80 drop-shadow">
                  {phase === "connected"
                    ? durationLabel
                    : phase === "incoming"
                      ? `Incoming ${call.type} call…`
                      : phase === "outgoing"
                        ? "Calling…"
                        : reconnecting
                          ? "Reconnecting…"
                          : "Connecting…"}
                </p>
              </div>
              <button
                onClick={() => void addPeople()}
                aria-label="Add people"
                className="w-11 h-11 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-white active:scale-90 transition-transform"
              >
                <UserPlus size={20} />
              </button>
            </div>
          )}


          {notice && !minimized && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-black/70 text-white text-xs shadow-lg">
              {notice}
            </div>
          )}

          {menuOpen && !minimized && (
            <div
              className="absolute inset-0 z-30 bg-black/50 flex items-end"
              onClick={() => setMenuOpen(false)}
            >
              <div
                className="w-full rounded-t-3xl bg-slate-900 border-t border-white/10 p-4 pb-8"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/25" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void addPeople();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm text-white/90 active:bg-white/10"
                >
                  <UserPlus size={18} /> Share invite link
                </button>
                <button
                  onClick={() => {
                    toggleSpeaker();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm text-white/90 active:bg-white/10"
                >
                  {speakerOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
                  {speakerOn ? "Speaker off" : "Speaker on"}
                </button>
                <button
                  onClick={() => {
                    toggleMute();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm text-white/90 active:bg-white/10"
                >
                  {muted ? <Mic size={18} /> : <MicOff size={18} />}
                  {muted ? "Unmute" : "Mute"}
                </button>
                {call.type === "video" && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      void switchCamera();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm text-white/90 active:bg-white/10"
                  >
                    <RefreshCw size={18} /> Switch camera
                  </button>
                )}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setMinimized(true);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm text-white/90 active:bg-white/10"
                >
                  <Minimize2 size={18} /> Minimize call
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    hangUp();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm text-red-400 active:bg-white/10"
                >
                  <PhoneOff size={18} /> End call
                </button>
              </div>
            </div>
          )}

          {call.type === "video" && (phase === "connected" || remoteReady) ? (
            <div
              className={
                minimized
                  ? "relative flex-1 min-h-0 bg-black"
                  : "absolute inset-0 z-0 bg-black"
              }
            >
              {/* Big screen: remote by default, own camera after a tap-swap. */}
              {swapped && !minimized ? (
                <video
                  ref={bindLocalVideo}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${
                    facing === "user" ? "scale-x-[-1]" : ""
                  }`}
                />
              ) : (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              )}


              {!minimized ? (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Swap big and small video"
                  onClick={() => setSwapped((s) => !s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSwapped((s) => !s);
                    }
                  }}
                  className="absolute top-[calc(4.5rem+env(safe-area-inset-top))] right-4 z-10 w-32 h-48 rounded-3xl overflow-hidden border border-white/15 shadow-2xl bg-slate-800 cursor-pointer"
                >
                  {/* Small tile: own camera by default, remote after swap. */}
                  {swapped ? (
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <video
                      ref={bindLocalVideo}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${
                        facing === "user" ? "scale-x-[-1]" : ""
                      }`}
                    />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void switchCamera();
                    }}
                    aria-label="Switch camera"
                    className="absolute top-2 right-2 w-10 h-10 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-white active:scale-90 transition-transform"
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEffectPanel(effectPanel ? null : "effects");
                    }}
                    aria-label="Video effects"
                    className={`absolute top-14 right-2 w-10 h-10 rounded-full backdrop-blur flex items-center justify-center active:scale-90 transition-transform ${
                      effectPanel ? "bg-white text-slate-900" : "bg-white text-slate-900"
                    }`}
                  >
                    <Wand2 size={18} />
                  </button>
                </div>
              ) : (
                <video
                  ref={bindLocalVideo}
                  autoPlay
                  playsInline
                  muted
                  className="hidden"
                />
              )}
            </div>

          ) : (
            <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center gap-4">
              {call.type === "video" && (
                <video
                  ref={bindLocalVideo}
                  autoPlay
                  playsInline
                  muted
                  className={`absolute inset-0 w-full h-full object-cover ${
                    facing === "user" ? "scale-x-[-1]" : ""
                  }`}
                />
              )}
              <div
                className={`relative flex flex-col items-center gap-3 ${
                  call.type === "video"
                    ? "pt-6 pb-8 self-stretch bg-gradient-to-b from-black/50 to-transparent"
                    : ""
                } ${minimized ? "scale-75" : ""}`}
              >
                <Avatar
                  src={peerPhoto ?? ""}
                  alt={peerName ?? "Caller"}
                  size={minimized ? 48 : 110}
                  className="ring-4 ring-white/20"
                />
                <p
                  className={
                    minimized ? "text-sm font-semibold" : "text-2xl font-semibold"
                  }
                >
                  {peerName}
                </p>
                <p className="text-sm text-white/70">
                  {phase === "incoming"
                    ? `Incoming ${call.type} call…`
                    : phase === "outgoing"
                      ? "Calling…"
                      : phase === "connecting"
                        ? reconnecting
                          ? "Reconnecting…"
                          : "Connecting…"
                        : durationLabel}
                </p>
                {error && call && !minimized && (
                  <p className="text-xs text-red-300 px-8 text-center">{error}</p>
                )}
              </div>
            </div>
          )}

          {minimized && (
            <div className="flex items-center justify-between px-2 py-2 bg-slate-900">
              <span className="text-[11px] text-white/70 pl-1">
                {phase === "connected" ? durationLabel : "Calling…"}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMinimized(false)}
                  aria-label="Expand call"
                  className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center"
                >
                  <Maximize2 size={14} />
                </button>
                <button
                  onClick={hangUp}
                  aria-label="End call"
                  className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center"
                >
                  <PhoneOff size={14} />
                </button>
              </div>
            </div>
          )}

          {call.type === "video" && !minimized && phase !== "incoming" && (
            <div className="absolute bottom-28 left-0 right-0 z-20 px-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-white/90">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot(myStatus)}`} />
                  You · {myStatus}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-white/90">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot(peerStatus)}`} />
                  {peerName ?? "Peer"} · {peerStatus}
                </span>
              </div>


              {effectPanel && (
                <div className="mb-2 flex gap-2 overflow-x-auto pb-1 pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {(effectPanel === "touchup"
                    ? TOUCH_UP_OPTIONS
                    : effectPanel === "effects"
                      ? EFFECT_OPTIONS
                      : effectPanel === "color"
                        ? COLOR_FILTER_OPTIONS
                        : BACKGROUND_OPTIONS
                  ).map((opt) => {
                    const key =
                      effectPanel === "touchup"
                        ? "touchUp"
                        : effectPanel === "effects"
                          ? "effect"
                          : effectPanel === "color"
                            ? "color"
                            : "background";
                    const active = effects[key as keyof EffectSettings] === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() =>
                          void applyEffects({ ...effects, [key]: opt.id })
                        }
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? "bg-white text-slate-900"
                            : "bg-black/50 text-white/90"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2 overflow-x-auto pb-1 pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {(
                  [
                    ["touchup", "Touch up"],
                    ["effects", "Effects"],
                    ["backgrounds", "Backgrounds"],
                    ["color", "Color filters"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setEffectPanel(effectPanel === id ? null : id)}
                    className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                      effectPanel === id
                        ? "bg-white text-slate-900"
                        : "bg-black/50 text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            className={
              minimized
                ? "hidden"
                : "absolute bottom-0 left-0 right-0 z-20 pt-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            }
          >


            {phase === "incoming" ? (
              <div className="flex items-start justify-around">
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={reject}
                    aria-label="Decline call"
                    className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                  >
                    <PhoneOff size={26} />
                  </button>
                  <span className="text-xs text-white/70">Decline</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={() => void accept()}
                    aria-label="Accept call"
                    className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg animate-pulse active:scale-90 transition-transform"
                  >
                    {call.type === "video" ? <Video size={26} /> : <Phone size={26} />}
                  </button>
                  <span className="text-xs text-white/70">Accept</span>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-sm items-center justify-between gap-2 rounded-full bg-black/55 backdrop-blur px-3 py-3 shadow-2xl">
                <button
                  onClick={() => setMenuOpen(true)}
                  aria-label="More options"
                  className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center text-white active:scale-90 transition-transform"
                >
                  <MoreVertical size={22} />
                </button>
                {call.type === "video" && (
                  <button
                    onClick={toggleCam}
                    aria-label={camOff ? "Turn camera on" : "Turn camera off"}
                    className={`w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform ${
                      camOff ? "bg-white/15 text-white" : "bg-white text-slate-900"
                    }`}
                  >
                    {camOff ? <VideoOff size={22} /> : <Video size={22} />}
                  </button>
                )}
                <button
                  onClick={toggleSpeaker}
                  aria-label={speakerOn ? "Speaker off" : "Speaker on"}
                  className={`w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform ${
                    speakerOn ? "bg-white text-slate-900" : "bg-white/15 text-white"
                  }`}
                >
                  {speakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
                </button>
                <button
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                  className={`w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform ${
                    muted ? "bg-white text-slate-900" : "bg-white/15 text-white"
                  }`}
                >
                  {muted ? <MicOff size={22} /> : <Mic size={22} />}
                </button>
                <button
                  onClick={hangUp}
                  aria-label="End call"
                  className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                >
                  <PhoneOff size={26} />
                </button>
              </div>


            )}
            {error && (
              <p className="text-center text-sm text-red-300 mt-4">{error}</p>
            )}
          </div>
        </div>
      )}
    </CallContext.Provider>
  );
}

export { useCalls };
