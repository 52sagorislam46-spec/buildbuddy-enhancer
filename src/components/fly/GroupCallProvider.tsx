/**
 * Group call provider (Messenger-style, up to 5 people).
 *
 * Purely additive: the existing 1:1 `CallProvider` is untouched and keeps
 * working exactly as before. This provider only handles `groupCalls/*`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Mic, MicOff, PhoneOff, SwitchCamera, Users, Video, VideoOff } from "lucide-react";

import { db, DEFAULT_AVATAR } from "../../lib/firebase";
import { useAuth } from "./AuthContext";
import { Avatar } from "./Avatar";
import { bindAudioUnlock } from "../../lib/notify";
import { pushToUsers } from "../../lib/push";
import {
  RTC_CONFIG,
  createRingback,
  createRingtone,
  waitForIceGathering,
  type CallType,
} from "./calls";
import {
  MAX_GROUP_CALL_PARTICIPANTS,
  MESH_COMFORT_SIZE,
  addPeerCandidate,
  candidateSide,
  cleanupGroupCall,
  createGroupCallDoc,
  isOfferer,
  pairId,
  peerCandidatesRef,
  savePeerAnswer,
  savePeerOffer,
  setGroupCallStatus,
  setParticipantState,
  watchGroupCall,
  watchParticipants,
  watchPeer,
  type GroupCallDoc,
  type GroupParticipantDoc,
} from "./groupCalls";
import { GroupCallContext, useGroupCalls } from "./groupCallContext";
import { saveGroupCallLog } from "./chat";
import type { GroupConversation } from "./types";

type Phase = "incoming" | "outgoing" | "joined";

interface RemoteEntry {
  uid: string;
  stream: MediaStream;
}

async function getMedia(type: CallType): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video:
      type === "video"
        ? {
            facingMode: { ideal: "user" },
            width: { ideal: 640, max: 960 },
            height: { ideal: 360, max: 540 },
            frameRate: { ideal: 24, max: 30 },
          }
        : false,
  });
}

export function GroupCallProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();

  const [call, setCall] = useState<GroupCallDoc | null>(null);
  const [phase, setPhase] = useState<Phase>("outgoing");
  const [participants, setParticipants] = useState<GroupParticipantDoc[]>([]);
  const [remotes, setRemotes] = useState<RemoteEntry[]>([]);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const callIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerUnsubsRef = useRef<Map<string, Array<() => void>>>(new Map());
  const unsubsRef = useRef<Array<() => void>>([]);
  const ringtoneRef = useRef<ReturnType<typeof createRingtone> | null>(null);
  const ringbackRef = useRef<ReturnType<typeof createRingback> | null>(null);
  const mutedRef = useRef(false);
  const camOffRef = useRef(false);
  const joinedRef = useRef(false);
  /** Latest call doc + timer, read when writing the chat log on hang-up. */
  const callRef = useRef<GroupCallDoc | null>(null);
  const elapsedRef = useRef(0);
  const loggedRef = useRef(false);
  callRef.current = call;
  elapsedRef.current = elapsed;


  if (typeof window !== "undefined") {
    if (!ringtoneRef.current) ringtoneRef.current = createRingtone();
    if (!ringbackRef.current) ringbackRef.current = createRingback();
  }

  useEffect(() => {
    bindAudioUnlock();
  }, []);

  /* ---------------- teardown ---------------- */
  const closePeer = useCallback((uid: string) => {
    const pc = peersRef.current.get(uid);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* noop */
      }
    }
    peersRef.current.delete(uid);
    peerUnsubsRef.current.get(uid)?.forEach((u) => {
      try {
        u();
      } catch {
        /* noop */
      }
    });
    peerUnsubsRef.current.delete(uid);
    setRemotes((list) => list.filter((r) => r.uid !== uid));
  }, []);

  const leave = useCallback(
    (opts: { declined?: boolean; endForAll?: boolean } = {}) => {
      const id = callIdRef.current;
      const me = user?.uid;
      const endedCall = callRef.current;
      const secs = elapsedRef.current;
      const wasJoined = joinedRef.current;

      // Only the host writes the group-thread log, so it never duplicates.
      if (id && me && endedCall && endedCall.hostId === me && !loggedRef.current) {
        loggedRef.current = true;
        const label = endedCall.type === "video" ? "Group video call" : "Group audio call";
        const mins = Math.floor(secs / 60);
        const rest = secs % 60;
        const text =
          wasJoined && secs > 0
            ? `${label} · ${mins ? `${mins}m ${rest}s` : `${rest}s`}`
            : `${label} · No answer`;
        void saveGroupCallLog(
          {
            id: endedCall.groupId,
            type: "group",
            name: endedCall.groupName,
            photoURL: endedCall.groupPhoto,
            participantIds: endedCall.invitedIds,
            members: endedCall.members,
            createdAt: Date.now(),
          },
          me,
          text,
        ).catch(() => {});
      }

      ringtoneRef.current?.stop();
      ringbackRef.current?.stop();
      unsubsRef.current.forEach((u) => {
        try {
          u();
        } catch {
          /* noop */
        }
      });
      unsubsRef.current = [];
      Array.from(peersRef.current.keys()).forEach(closePeer);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      joinedRef.current = false;
      callIdRef.current = null;
      setRemotes([]);
      setParticipants([]);
      setCall(null);
      setMuted(false);
      setCamOff(false);
      setElapsed(0);
      mutedRef.current = false;
      camOffRef.current = false;

      if (id && me) {
        void setParticipantState(id, {
          uid: me,
          displayName: profile?.displayName ?? "Someone",
          photoURL: profile?.photoURL ?? DEFAULT_AVATAR,
          state: opts.declined ? "declined" : "left",
        }).catch(() => {});
      }
      if (id && opts.endForAll) {
        void setGroupCallStatus(id, "ended");
        setTimeout(() => void cleanupGroupCall(id), 2000);
      }
    },
    [closePeer, profile, user],
  );

  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  /* ---------------- mesh ---------------- */
  /**
   * Unlimited members: the more people are connected, the smaller/lighter the
   * video we send to each of them, so the mesh keeps working past 5 people.
   */
  const applyMeshQuality = useCallback(() => {
    const peers = Array.from(peersRef.current.values());
    const n = peers.length;
    if (!n) return;
    const extra = Math.max(0, n + 1 - MESH_COMFORT_SIZE);
    const maxBitrate = extra === 0 ? 900_000 : Math.max(90_000, 900_000 / (1 + extra));
    const scale = extra === 0 ? 1 : Math.min(4, 1 + extra * 0.5);
    peers.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind !== "video") return;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) {
          params.encodings = [{}];
        }
        params.encodings.forEach((enc) => {
          enc.maxBitrate = maxBitrate;
          enc.scaleResolutionDownBy = scale;
        });
        void sender.setParameters(params).catch(() => {});
      });
    });
  }, []);

  const ensurePeer = useCallback(
    async (callId: string, type: CallType, otherUid: string) => {
      const me = user?.uid;
      if (!me || peersRef.current.has(otherUid)) return;
      const local = localStreamRef.current;
      if (!local) return;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current.set(otherUid, pc);
      const unsubs: Array<() => void> = [];
      peerUnsubsRef.current.set(otherUid, unsubs);
      // Big calls: scale outgoing video down so a large mesh stays usable.
      setTimeout(() => applyMeshQuality(), 0);

      local.getTracks().forEach((t) => pc.addTrack(t, local));

      const remote = new MediaStream();
      pc.ontrack = (e) => {
        if (!remote.getTracks().some((t) => t.id === e.track.id)) {
          remote.addTrack(e.track);
        }
        setRemotes((list) =>
          list.some((r) => r.uid === otherUid)
            ? list.map((r) => (r.uid === otherUid ? { uid: otherUid, stream: remote } : r))
            : [...list, { uid: otherUid, stream: remote }],
        );
      };

      const pair = pairId(me, otherUid);
      const mySide = candidateSide(me, otherUid);
      const theirSide = mySide === "a" ? "b" : "a";

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          void addPeerCandidate(callId, pair, mySide, e.candidate.toJSON());
        }
      };

      const pending: RTCIceCandidateInit[] = [];
      const flush = async () => {
        if (!pc.remoteDescription) return;
        while (pending.length) {
          const data = pending.shift()!;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data));
          } catch {
            /* ignore bad candidate */
          }
        }
      };

      unsubs.push(
        onSnapshot(peerCandidatesRef(callId, pair, theirSide), (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            pending.push(change.doc.data() as RTCIceCandidateInit);
          });
          void flush();
        }),
      );

      let appliedOffer: string | null = null;
      let appliedAnswer: string | null = null;

      if (isOfferer(me, otherUid)) {
        unsubs.push(
          watchPeer(callId, pair, (data) => {
            const sdp = data.answer?.sdp;
            if (!sdp || sdp === appliedAnswer) return;
            if (pc.signalingState !== "have-local-offer") return;
            appliedAnswer = sdp;
            void (async () => {
              try {
                await pc.setRemoteDescription(
                  new RTCSessionDescription(data.answer!),
                );
                await flush();
              } catch {
                /* noop */
              }
            })();
          }),
        );
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await waitForIceGathering(pc);
          await savePeerOffer(callId, pair, pc.localDescription ?? offer);
        } catch {
          /* noop */
        }
      } else {
        unsubs.push(
          watchPeer(callId, pair, (data) => {
            const sdp = data.offer?.sdp;
            if (!sdp || sdp === appliedOffer) return;
            appliedOffer = sdp;
            void (async () => {
              try {
                await pc.setRemoteDescription(
                  new RTCSessionDescription(data.offer!),
                );
                await flush();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await waitForIceGathering(pc);
                await savePeerAnswer(callId, pair, pc.localDescription ?? answer);
              } catch {
                /* noop */
              }
            })();
          }),
        );
      }

      void type;
    },
    [user],
  );

  /** Joins the call: opens media and starts watching everyone else. */
  const join = useCallback(
    async (data: GroupCallDoc) => {
      const me = user?.uid;
      if (!me || joinedRef.current) return;
      try {
        const stream = await getMedia(data.type);
        localStreamRef.current = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
        stream.getVideoTracks().forEach((t) => (t.enabled = !camOffRef.current));
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          void localVideoRef.current.play().catch(() => {});
        }
      } catch {
        setError("Could not access your microphone or camera.");
        leaveRef.current({ declined: true });
        return;
      }
      joinedRef.current = true;
      ringtoneRef.current?.stop();
      // The caller keeps hearing the ringback until somebody actually answers.
      if (data.hostId !== me) ringbackRef.current?.stop();
      setPhase("joined");

      await setParticipantState(data.id, {
        uid: me,
        displayName: profile?.displayName ?? "Someone",
        photoURL: profile?.photoURL ?? DEFAULT_AVATAR,
        state: "joined",
      });
      await setGroupCallStatus(data.id, "active");

      unsubsRef.current.push(
        watchParticipants(data.id, (list) => {
          setParticipants(list);
          const joined = list.filter(
            (p) => p.state === "joined" && p.uid !== me,
          );
          joined.forEach((p) => void ensurePeer(data.id, data.type, p.uid));
          list
            .filter((p) => p.state !== "joined")
            .forEach((p) => {
              if (peersRef.current.has(p.uid)) closePeer(p.uid);
            });
        }),
      );
    },
    [closePeer, ensurePeer, profile, user],
  );

  /* ---------------- outgoing ---------------- */
  const startGroupCall = useCallback(
    async (group: GroupConversation, type: CallType) => {
      if (!user || callIdRef.current) return;
      setError(null);
      loggedRef.current = false;
      const others = group.participantIds.filter((uid) => uid !== user.uid);
      if (!others.length) {
        setError("This group has no other members to call.");
        return;
      }
      if (group.participantIds.length > MAX_GROUP_CALL_PARTICIPANTS) {
        setError(
          `Group calls support up to ${MAX_GROUP_CALL_PARTICIPANTS} people.`,
        );
        return;
      }
      try {
        const callId = await createGroupCallDoc({
          groupId: group.id,
          groupName: group.name,
          groupPhoto: group.photoURL,
          hostId: user.uid,
          hostName: profile?.displayName ?? user.displayName ?? "Someone",
          hostPhoto: profile?.photoURL ?? DEFAULT_AVATAR,
          type,
          invitedIds: group.participantIds,
          members: group.members,
        });
        callIdRef.current = callId;
        setPhase("outgoing");
        const doc: GroupCallDoc = {
          id: callId,
          groupId: group.id,
          groupName: group.name,
          groupPhoto: group.photoURL,
          hostId: user.uid,
          hostName: profile?.displayName ?? "You",
          hostPhoto: profile?.photoURL ?? DEFAULT_AVATAR,
          type,
          status: "ringing",
          invitedIds: group.participantIds,
          members: group.members,
        };
        setCall(doc);
        ringbackRef.current?.start();

        void pushToUsers({
          uids: others,
          title: `Group ${type} call · ${group.name}`,
          body: `${profile?.displayName ?? "Someone"} started a group call`,
          icon: profile?.photoURL ?? DEFAULT_AVATAR,
          link: `/?groupCall=${encodeURIComponent(callId)}`,
          tag: `groupcall_${callId}`,
          event: "calls",
        });

        // Ring every invited member.
        await Promise.all(
          group.members
            .filter((m) => m.uid !== user.uid)
            .map((m) =>
              setParticipantState(callId, {
                uid: m.uid,
                displayName: m.displayName,
                photoURL: m.photoURL,
                state: "ringing",
              }).catch(() => {}),
            ),
        );

        unsubsRef.current.push(
          watchGroupCall(callId, (data) => {
            if (!data || data.status === "ended") {
              leaveRef.current();
              return;
            }
            setCall(data);
          }),
        );

        await join(doc);
      } catch {
        setError("Could not start the group call.");
        leaveRef.current({ endForAll: true });
      }
    },
    [join, profile, user],
  );

  /* ---------------- incoming listener ---------------- */
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "groupCalls"),
      where("invitedIds", "array-contains", user.uid),
    );
    return onSnapshot(q, (snap) => {
      if (callIdRef.current) return;
      const found = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<GroupCallDoc, "id">) }))
        .filter(
          (item) =>
            item.hostId !== user.uid &&
            (item.status === "ringing" || item.status === "active") &&
            (!item.expiresAt || item.expiresAt > Date.now()),
        )
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
      if (!found) return;
      callIdRef.current = found.id;
      loggedRef.current = false;
      setCall(found);
      setPhase("incoming");
      ringtoneRef.current?.start();
      unsubsRef.current.push(
        watchGroupCall(found.id, (data) => {
          if (!data || data.status === "ended") {
            leaveRef.current();
            return;
          }
          setCall(data);
        }),
      );
    });
  }, [user]);

  /** Auto-drop a ringing invite that nobody answered. */
  useEffect(() => {
    if (phase !== "incoming" || !call) return;
    const timer = setTimeout(() => leaveRef.current(), 90_000);
    return () => clearTimeout(timer);
  }, [phase, call]);

  /**
   * Caller side: keep ringing until somebody in the group actually answers,
   * then stop the ringback. Gives up after 90s if nobody picks up.
   */
  useEffect(() => {
    const me = user?.uid;
    if (!call || !me || call.hostId !== me) return;
    if (phase !== "outgoing" && phase !== "joined") return;
    const someoneJoined = participants.some(
      (p) => p.uid !== me && p.state === "joined",
    );
    if (someoneJoined) {
      ringbackRef.current?.stop();
      return;
    }
    ringbackRef.current?.start();
    const timer = setTimeout(() => leaveRef.current({ endForAll: true }), 90_000);
    return () => clearTimeout(timer);
  }, [call, participants, phase, user]);



  /* ---------------- timer ---------------- */
  /** Counts only real talk time: starts when a second person has joined. */
  const connected =
    phase === "joined" &&
    participants.filter((p) => p.state === "joined").length > 1;

  useEffect(() => {
    if (!connected || !call) return;
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [connected, call?.id]);

  useEffect(() => {
    setElapsed(0);
  }, [call?.id]);


  useEffect(() => () => leaveRef.current(), []);

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
  };

  const toggleCam = () => {
    const next = !camOffRef.current;
    camOffRef.current = next;
    setCamOff(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
  };

  /** Flips between front and back camera during a group video call. */
  const switchCamera = async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = facing === "user" ? "environment" : "user";
    const current = stream.getVideoTracks()[0];

    const applyTrack = async (track: MediaStreamTrack) => {
      try {
        track.contentHint = "motion";
      } catch {
        /* noop */
      }
      for (const pc of peersRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          try {
            await sender.replaceTrack(track);
          } catch {
            /* noop */
          }
        }
      }
      if (current && current !== track) {
        try {
          current.stop();
        } catch {
          /* noop */
        }
        stream.removeTrack(current);
      }
      track.enabled = !camOffRef.current;
      if (!stream.getVideoTracks().includes(track)) stream.addTrack(track);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => {});
      }
      setFacing(next);
    };

    const releaseCurrent = () => {
      try {
        current?.stop();
      } catch {
        /* noop */
      }
    };

    for (const constraint of [
      { facingMode: { exact: next } },
      { facingMode: next },
    ] as MediaTrackConstraints[]) {
      try {
        releaseCurrent();
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: {
            ...constraint,
            width: { ideal: 640, max: 960 },
            height: { ideal: 360, max: 540 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        });
        const track = fresh.getVideoTracks()[0];
        if (track) {
          await applyTrack(track);
          return;
        }
      } catch {
        /* try next strategy */
      }
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      if (cams.length > 1) {
        const currentId = current?.getSettings().deviceId;
        const other = cams.find((c) => c.deviceId && c.deviceId !== currentId);
        if (other) {
          releaseCurrent();
          const fresh = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: other.deviceId } },
            audio: false,
          });
          const track = fresh.getVideoTracks()[0];
          if (track) {
            await applyTrack(track);
            return;
          }
        }
      }
    } catch {
      /* fall through */
    }

    try {
      await current?.applyConstraints({ facingMode: next });
      if (current && current.readyState === "live") {
        current.enabled = !camOffRef.current;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setFacing(next);
        return;
      }
    } catch {
      /* nothing worked */
    }

    // Restore a working camera so the preview is not dead.
    if (!current || current.readyState !== "live") {
      try {
        const restore = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        const track = restore.getVideoTracks()[0];
        if (track) await applyTrack(track);
      } catch {
        /* noop */
      }
    }
  };

  const value = useMemo(
    () => ({ startGroupCall, busy: !!call }),
    [startGroupCall, call],
  );

  const joinedList = participants.filter((p) => p.state === "joined");
  const memberOf = (uid: string) =>
    call?.members.find((m) => m.uid === uid) ??
    participants.find((p) => p.uid === uid);
  const durationLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60,
  ).padStart(2, "0")}`;
  const isHost = !!call && call.hostId === user?.uid;
  const isVideo = call?.type === "video";
  // Unlimited members: the tile grid gets denser as more people join.
  const tileCount = joinedList.length + 1;
  const gridCols =
    tileCount <= 1
      ? "grid-cols-1"
      : tileCount <= 4
        ? "grid-cols-2"
        : tileCount <= 9
          ? "grid-cols-3"
          : "grid-cols-4";
  const tileMin =
    tileCount <= 2
      ? "min-h-[34vh]"
      : tileCount <= 4
        ? "min-h-[26vh]"
        : tileCount <= 9
          ? "min-h-[18vh]"
          : "min-h-[13vh]";

  return (
    <GroupCallContext.Provider value={value}>
      {children}

      {error && !call && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full bg-gray-900 text-white text-sm shadow-lg">
          {error}
        </div>
      )}

      {call && phase === "incoming" && (
        <div className="fixed inset-0 z-[80] bg-gray-950 text-white flex flex-col items-center justify-center gap-6 px-6">
          <Avatar src={call.groupPhoto || call.hostPhoto} alt={call.groupName} size={92} />
          <div className="text-center">
            <p className="text-xl font-semibold">{call.groupName}</p>
            <p className="text-sm text-white/70 mt-1">
              {call.hostName} started a group {call.type} call
            </p>
          </div>
          <div className="flex items-center gap-6 mt-4">
            <button
              onClick={() => leaveRef.current({ declined: true })}
              aria-label="Decline"
              className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center"
            >
              <PhoneOff size={24} />
            </button>
            <button
              onClick={() => void join(call)}
              aria-label="Join call"
              className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center"
            >
              {isVideo ? <Video size={24} /> : <Mic size={24} />}
            </button>
          </div>
        </div>
      )}

      {call && phase !== "incoming" && (
        <div className="fixed inset-0 z-[80] bg-gray-950 text-white flex flex-col">
          <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b border-white/10">
            <Avatar src={call.groupPhoto || call.hostPhoto} alt={call.groupName} size={38} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{call.groupName}</p>
              <p className="text-xs text-white/60">
                {connected
                  ? `${joinedList.length} in call · ${durationLabel}`
                  : phase === "joined"
                    ? "Ringing…"
                    : "Calling group…"}
              </p>

            </div>
            <span className="flex items-center gap-1 text-xs text-white/60">
              <Users size={14} /> {joinedList.length}
              {Number.isFinite(MAX_GROUP_CALL_PARTICIPANTS) ? `/${MAX_GROUP_CALL_PARTICIPANTS}` : ""}
            </span>
          </div>

          <div className={`flex-1 overflow-y-auto p-3 grid ${gridCols} gap-3 auto-rows-fr`}>
            {/* Me */}
            <div className={`relative rounded-2xl overflow-hidden bg-white/5 flex items-center justify-center ${tileMin}`}>
              {isVideo && !camOff ? (
                <video
                  ref={(el) => {
                    localVideoRef.current = el;
                    const stream = localStreamRef.current;
                    if (el && stream && el.srcObject !== stream) {
                      el.srcObject = stream;
                      el.muted = true;
                      void el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  muted
                  playsInline
                  className={`w-full h-full object-cover ${
                    facing === "user" ? "scale-x-[-1]" : ""
                  }`}
                />
              ) : (
                <Avatar
                  src={profile?.photoURL ?? DEFAULT_AVATAR}
                  alt="You"
                  size={64}
                />
              )}
              <span className="absolute bottom-2 left-2 text-xs bg-black/50 px-2 py-0.5 rounded-full">
                You {muted && "· muted"}
              </span>
            </div>

            {/* Everyone else */}
            {remotes.map((entry) => (
              <div
                key={entry.uid}
                className={`relative rounded-2xl overflow-hidden bg-white/5 flex items-center justify-center ${tileMin}`}
              >
                <video
                  ref={(el) => {
                    if (el && el.srcObject !== entry.stream) {
                      el.srcObject = entry.stream;
                      void el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  className={
                    isVideo
                      ? "w-full h-full object-cover"
                      : "w-0 h-0 opacity-0 absolute"
                  }
                />
                {!isVideo && (
                  <Avatar
                    src={memberOf(entry.uid)?.photoURL ?? DEFAULT_AVATAR}
                    alt={memberOf(entry.uid)?.displayName ?? "Member"}
                    size={64}
                  />
                )}
                <span className="absolute bottom-2 left-2 text-xs bg-black/50 px-2 py-0.5 rounded-full">
                  {memberOf(entry.uid)?.displayName ?? "Member"}
                </span>
              </div>
            ))}

            {/* Still ringing */}
            {participants
              .filter((p) => p.state === "ringing")
              .map((p) => (
                <div
                  key={p.uid}
                  className={`relative rounded-2xl overflow-hidden bg-white/5 flex flex-col items-center justify-center gap-2 ${tileMin}`}
                >
                  <Avatar src={p.photoURL || DEFAULT_AVATAR} alt={p.displayName} size={56} />
                  <span className="text-xs text-white/60">
                    {p.displayName} · ringing
                  </span>
                </div>
              ))}
          </div>

          <div className="px-6 pb-8 pt-4 flex items-center justify-center gap-4 border-t border-white/10">
            {isVideo && (
              <button
                onClick={() => void switchCamera()}
                aria-label="Switch camera"
                className="w-14 h-14 rounded-full flex items-center justify-center bg-white/10"
              >
                <SwitchCamera size={22} />
              </button>
            )}
            <button
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className={`w-14 h-14 rounded-full flex items-center justify-center ${
                muted ? "bg-white text-gray-900" : "bg-white/10"
              }`}
            >
              {muted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
            {isVideo && (
              <button
                onClick={toggleCam}
                aria-label={camOff ? "Turn camera on" : "Turn camera off"}
                className={`w-14 h-14 rounded-full flex items-center justify-center ${
                  camOff ? "bg-white text-gray-900" : "bg-white/10"
                }`}
              >
                {camOff ? <VideoOff size={22} /> : <Video size={22} />}
              </button>
            )}
            <button
              onClick={() => leaveRef.current({ endForAll: isHost })}
              aria-label="Leave call"
              className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center"
            >
              <PhoneOff size={24} />
            </button>
          </div>
        </div>
      )}
    </GroupCallContext.Provider>
  );
}

export { useGroupCalls };
