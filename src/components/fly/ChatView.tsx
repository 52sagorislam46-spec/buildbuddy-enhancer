import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CornerUpLeft,
  Forward,
  FileText,
  ImagePlus,
  Images,
  Info,
  Loader2,
  Mic,
  Ban,
  Palette,
  Paperclip,
  Pencil,
  Phone,
  Play,
  Scissors,
  PhoneOff,
  Search,
  Send,
  ShieldOff,
  Square,
  Trash2,
  User,
  Video,
  X,
} from "lucide-react";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, secureUrl, uploadToCloudinary } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { LinkText } from "./LinkText";
import { PostLinkPreview } from "./PostLinkPreview";
import { useAuth } from "./AuthContext";
import { useCalls } from "./callContext";
import {
  conversationId,
  deleteForEveryone,
  deleteForMe,
  editMessage,
  markDelivered,
  markSeen,
  sendMessage,
  toMillis,
  toggleMessageReaction,
  MESSAGE_REACTIONS,
} from "./chat";
import { timeAgo } from "../../lib/time";

import { getPrefs, setPrefs, markOpened } from "./chatPrefs";
import { markConversationRead } from "./readState";
import { noBlock, setBlocked, subscribeBlock } from "./blocks";
import {
  CHAT_THEMES,
  loadTheme,
  defaultTheme,
  CHAT_BACKGROUNDS,
  backgroundClass,
  saveSharedTheme,
  saveSharedBackground,
  subscribeAppearance,
  loadBackground,
  type ChatBackgroundChoice,
} from "./chatTheme";
import { ImageLightbox, ShareSheet, VideoLightbox } from "./ShareSheet";
import {
  DEFAULT_QUICK_REACTION,
  QUICK_REACTION_CHOICES,
  loadQuickReaction,
  saveSharedQuickReaction,
  subscribeQuickReaction,
} from "./quickReaction";
import type { ChatMessage, UserProfile } from "./types";

export function ChatView({
  other,
  onBack,
  onOpenProfile,
}: {
  other: UserProfile;
  onBack: () => void;
  onOpenProfile?: (uid: string) => void;
}) {
  const { user } = useAuth();
  const { startCall, busy } = useCalls();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(defaultTheme);
  const [bg, setBg] = useState<ChatBackgroundChoice>({ id: "default" });
  const [bgUploading, setBgUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRecordRef = useRef(false);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordStartRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // True while the user is near the bottom — new messages only auto-scroll then.
  const atBottomRef = useRef(true);
  const initialScrolledRef = useRef(false);
  const lastMsgIdRef = useRef("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const [block, setBlock] = useState(noBlock);
  const [blockBusy, setBlockBusy] = useState(false);
  const [lightbox, setLightbox] = useState("");
  const [imageView, setImageView] = useState<{
    url: string;
    name?: string;
    createdAt?: number;
  } | null>(null);
  const [shareFor, setShareFor] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editFor, setEditFor] = useState<ChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [quickReaction, setQuickReaction] = useState(DEFAULT_QUICK_REACTION);
  const [quickOpen, setQuickOpen] = useState(false);


  useEffect(() => {
    const p = getPrefs(other.uid);
    setQuickReaction(loadQuickReaction(other.uid));
    setNickname(p.nickname);
    setMuted(p.muted);
  }, [other.uid]);


  useEffect(() => {
    if (!user) return;
    const id = conversationId(user.uid, other.uid);
    const q = query(
      collection(db, "conversations", id, "messages"),
      orderBy("createdAt", "asc"),
    );
    return onSnapshot(q, (snap) => {
      setMessages(
        snap.docs.map((d) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data: any = d.data();
          return {
            id: d.id,
            senderId: data.senderId ?? "",
            text: data.text ?? "",
            kind: data.kind === "call" ? "call" : "text",
            mediaUrl: secureUrl(data.mediaUrl),
            mediaType: data.mediaType ?? "",
            mediaName: data.mediaName ?? "",
            postId: data.postId ?? "",
            replyToId: data.replyToId ?? "",
            replyToText: data.replyToText ?? "",
            replyToSenderId: data.replyToSenderId ?? "",
            editedAt: data.editedAt ? toMillis(data.editedAt) : 0,
            createdAt: toMillis(data.createdAt),

            deliveredTo: data.deliveredTo ?? [],
            seenBy: data.seenBy ?? [],
            deletedFor: data.deletedFor ?? [],
            deleted: Boolean(data.deleted),
            reactions: data.reactions ?? {},
          } as ChatMessage;
        }),
      );
    });
  }, [user, other.uid]);

  useEffect(() => {
    if (!user) return;
    return subscribeBlock(user.uid, other.uid, setBlock);
  }, [user, other.uid]);

  useEffect(() => {
    setPrefs(other.uid, { blocked: block.iBlocked });
  }, [other.uid, block.iBlocked]);

  useEffect(() => {
    if (!user) return;
    void markDelivered(user.uid, other.uid);
  }, [user, other.uid]);

  const visible = useMemo(
    () => messages.filter((m) => !m.deletedFor.includes(user?.uid ?? "")),
    [messages, user],
  );

  /** Reset scroll anchoring when switching to a different conversation. */
  useEffect(() => {
    initialScrolledRef.current = false;
    lastMsgIdRef.current = "";
    atBottomRef.current = true;
  }, [user, other.uid]);

  /** Mark incoming messages as seen while the thread is open. */
  useEffect(() => {
    if (!user) return;
    const unseen = visible
      .filter(
        (m) =>
          m.senderId !== user.uid &&
          !m.deleted &&
          !m.seenBy.includes(user.uid),
      )
      .map((m) => m.id);
    if (unseen.length) void markSeen(user.uid, other.uid, unseen);
  }, [visible, user, other.uid]);

  /** Remember that this thread was read so the inbox badge can clear. */
  useEffect(() => {
    if (!user) return;
    markOpened(conversationId(user.uid, other.uid));
    void markConversationRead(conversationId(user.uid, other.uid), user.uid);
  }, [visible, user, other.uid]);

  // Start at the newest message once per thread, and afterwards only follow
  // new messages when the user is already near the bottom (or sent it) — so
  // scrolling up to read history never gets yanked back down.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || visible.length === 0) return;
    const latest = visible[visible.length - 1];
    if (!latest) return;
    if (!initialScrolledRef.current) {
      initialScrolledRef.current = true;
      lastMsgIdRef.current = latest.id;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (latest.id === lastMsgIdRef.current) return;
    const isMine = latest.senderId === user?.uid;
    lastMsgIdRef.current = latest.id;
    if (isMine || atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [visible, user]);

  useEffect(() => {
    if (!user) return;
    const convId = conversationId(user.uid, other.uid);
    setTheme(loadTheme(convId));
    setBg(loadBackground(convId));
    // Mirror whatever the other participant picked, live.
    setQuickReaction(loadQuickReaction(convId) || loadQuickReaction(other.uid));
    const stopAppearance = subscribeAppearance(convId, (next) => {
      if (next.theme) setTheme(next.theme);
      if (next.background) setBg(next.background);
    });
    // A quick reaction picked by either side shows up for both.
    const stopQuick = subscribeQuickReaction(convId, setQuickReaction);
    return () => {
      stopAppearance();
      stopQuick();
    };
  }, [user, other.uid]);

  useEffect(() => {
    if (!recording) return;
    setRecordSecs(0);
    const t = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const sendVoice = async (blob: Blob) => {
    if (!user) return;
    setError("");
    setUploading(true);
    try {
      const ext = blob.type.includes("mp4")
        ? "m4a"
        : blob.type.includes("ogg")
          ? "ogg"
          : "webm";
      const voice = new File([blob], `voice-${Date.now()}.${ext}`, {
        type: blob.type || "audio/webm",
      });
      const uploaded = await uploadToCloudinary(voice);
      await sendMessage(user.uid, other.uid, "", {
        url: uploaded.url,
        type: "audio",
        name: "Voice message",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send voice");
    } finally {
      setUploading(false);
    }
  };

  const startRecording = async () => {
    if (recording || recorderRef.current) return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordStartRef.current = Date.now();
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find(
        (t) =>
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported(t),
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      cancelRecordRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        chunksRef.current = [];
        recorderRef.current = null;
        setRecording(false);
        if (cancelRecordRef.current) return;
        // Very short taps produce a header-only (or empty) blob that no player
        // can open, so ask for a longer hold instead of sending silence.
        if (blob.size < 1024) {
          setError("Recording too short — hold the mic for a moment longer");
          return;
        }
        void sendVoice(blob);
      };
      recorder.onerror = () => {
        setError("Recording failed — please try again");
      };
      recorderRef.current = recorder;
      // Small time slices keep chunks flowing so a quick stop still has audio.
      recorder.start(100);
      setRecording(true);
    } catch {
      setError("Microphone permission is needed to record voice");
    }
  };

  const stopRecording = (cancel = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      return;
    }
    cancelRecordRef.current = cancel;
    const finish = () => {
      try {
        // Flush whatever is still buffered before closing the recorder,
        // otherwise the last (sometimes only) chunk is lost.
        if (recorder.state === "recording") recorder.requestData();
      } catch {
        /* not supported everywhere */
      }
      setTimeout(() => {
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          /* noop */
        }
      }, 250);
    };
    // Guarantee at least ~700ms of audio so the clip is always playable.
    const elapsed = Date.now() - recordStartRef.current;
    if (!cancel && elapsed < 700) setTimeout(finish, 700 - elapsed);
    else finish();
  };

  /** Stops any running recording when the thread closes. */
  useEffect(() => {
    return () => {
      cancelRecordRef.current = true;
      try {
        if (recorderRef.current?.state !== "inactive")
          recorderRef.current?.stop();
      } catch {
        /* noop */
      }
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordStreamRef.current = null;
      recorderRef.current = null;
    };
  }, []);


  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : "");
    e.target.value = "";
  };

  const clearFile = () => {
    setFile(null);
    setPreview("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || (!text.trim() && !file)) return;
    if (block.iBlocked || block.blockedMe) {
      setError(
        block.iBlocked
          ? "You blocked this person. Unblock to send a message."
          : "You can't reply to this conversation.",
      );
      return;
    }
    const value = text.trim();
    const chosen = file;
    const quoted = replyTo;
    const reply = quoted
      ? {
          id: quoted.id,
          text:
            quoted.text ||
            quoted.mediaName ||
            (quoted.mediaType === "image"
              ? "Photo"
              : quoted.mediaType === "video"
                ? "Video"
                : quoted.mediaType === "audio"
                  ? "Voice message"
                  : "Attachment"),
          senderId: quoted.senderId,
        }
      : undefined;
    setText("");
    clearFile();
    setReplyTo(null);
    setError("");
    try {
      if (chosen) {
        setUploading(true);
        const uploaded = await uploadToCloudinary(chosen);
        const type = chosen.type.startsWith("image/")
          ? "image"
          : chosen.type.startsWith("video/")
            ? "video"
            : uploaded.resourceType === "video"
              ? "video"
              : "file";
        await sendMessage(
          user.uid,
          other.uid,
          value,
          { url: uploaded.url, type, name: chosen.name },
          "text",
          undefined,
          reply,
        );
      } else {
        await sendMessage(
          user.uid,
          other.uid,
          value,
          undefined,
          "text",
          undefined,
          reply,
        );
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      <header className="flex items-center gap-3 px-4 h-14 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-xl z-10">
        <button onClick={onBack} aria-label="Back" className="text-gray-500">
          <ArrowLeft size={22} />
        </button>
        <Avatar src={other.photoURL} alt={other.displayName} size={34} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {nickname || other.displayName}
          </p>
          <p className="text-xs text-gray-400 truncate">@{other.username}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void startCall(other, "audio")}
            disabled={busy}
            aria-label={`Audio call ${other.displayName}`}
            title="Audio call"
            className="w-9 h-9 rounded-full flex items-center justify-center text-sky-600 hover:bg-sky-50 disabled:opacity-40 active:scale-90 transition"
          >
            <Phone size={19} />
          </button>
          <button
            onClick={() => void startCall(other, "video")}
            disabled={busy}
            aria-label={`Video call ${other.displayName}`}
            title="Video call"
            className="w-9 h-9 rounded-full flex items-center justify-center text-sky-600 hover:bg-sky-50 disabled:opacity-40 active:scale-90 transition"
          >
            <Video size={20} />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Chat settings"
            title="Chat settings"
            className="w-9 h-9 rounded-full flex items-center justify-center text-sky-600 hover:bg-sky-50 active:scale-90 transition"
          >
            <Info size={20} />
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white">
          <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-full bg-gray-100">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search in conversation"
              aria-label="Search in conversation"
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <button
            onClick={() => {
              setSearchOpen(false);
              setSearchTerm("");
            }}
            className="text-xs font-semibold text-sky-600"
          >
            Cancel
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={`flex-1 overflow-y-auto px-4 py-4 space-y-2 ${
          bg.id === "default" ? theme.background : backgroundClass(bg)
        }`}
        style={
          bg.id === "custom" && bg.imageUrl
            ? {
                backgroundImage: `url(${bg.imageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundAttachment: "local",
              }
            : undefined
        }
      >

        {visible.length === 0 && (
          <p className="text-center text-sm text-gray-400 mt-10">
            Say hi to {other.displayName}
          </p>
        )}
        {(searchTerm.trim()
          ? visible.filter((m) =>
              (m.text || m.mediaName || "")
                .toLowerCase()
                .includes(searchTerm.trim().toLowerCase()),
            )
          : visible
        ).map((m) => {
          const mine = m.senderId === user?.uid;
          if (m.kind === "call") {
            const label = m.text || "Call";
            const isVideo = label.toLowerCase().includes("video");
            const unanswered =
              /missed|no answer|declined/i.test(label) && !/·\s*\d/.test(label);
            const CallIcon = isVideo ? Video : Phone;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuFor(m);
                  }}
                  onDoubleClick={() => setMenuFor(m)}
                  style={{ WebkitTouchCallout: "none" }}
                  className="max-w-[75%] rounded-2xl bg-gray-100 px-3 py-2.5 select-none"
                >

                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        unanswered
                          ? "bg-red-500 text-white"
                          : "bg-gray-300 text-gray-700"
                      }`}
                    >
                      <CallIcon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-gray-800">
                        {label}
                      </span>
                      <span className="block text-[11px] text-gray-500">
                        {new Date(m.createdAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                  </div>
                  {unanswered ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void startCall(other, isVideo ? "video" : "audio")
                      }
                      className="mt-2 w-full rounded-xl bg-gray-200 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
                    >
                      Call back
                    </button>
                  ) : null}
                </div>
              </div>
            );
          }


          const seen = m.seenBy.includes(other.uid);
          const delivered = seen || m.deliveredTo.includes(other.uid);
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuFor(m);
                }}
                onDoubleClick={() => {
                  if (m.deleted || !user) {
                    setMenuFor(m);
                    return;
                  }
                  void toggleMessageReaction(
                    user.uid,
                    other.uid,
                    m.id,
                    quickReaction,
                  );
                }}
                style={{ WebkitTouchCallout: "none" }}
                className={`max-w-[75%] px-1.5 py-1.5 rounded-2xl text-sm break-words select-none ${
                  mine
                    ? `${theme.mine} rounded-br-md`
                    : "bg-gray-100 text-gray-800 rounded-bl-md"
                }`}

              >
                {!m.deleted && m.replyToText ? (
                  <div
                    className={`mb-1 px-2.5 py-1 rounded-xl border-l-2 text-[11px] ${
                      mine
                        ? "bg-white/15 border-white/60 text-white/85"
                        : "bg-white border-sky-300 text-gray-500"
                    }`}
                  >
                    <span className="block font-semibold">
                      {m.replyToSenderId === user?.uid
                        ? "You"
                        : nickname || other.displayName}
                    </span>
                    <span className="line-clamp-2">{m.replyToText}</span>
                  </div>
                ) : null}
                {m.deleted ? (

                  <p
                    className={`px-2.5 py-1 italic ${mine ? "text-white/80" : "text-gray-500"}`}
                  >
                    This message was deleted
                  </p>
                ) : (
                  <>
                    {m.mediaUrl && m.mediaType === "image" && (
                      <button
                        type="button"
                        onClick={() =>
                          setImageView({
                            url: m.mediaUrl,
                            name: m.mediaName,
                            createdAt: m.createdAt,
                          })
                        }
                        className="block w-full"
                      >
                        <img
                          src={m.mediaUrl}
                          alt={m.mediaName || "photo"}
                          className="rounded-xl max-h-64 w-full object-cover"
                        />
                      </button>
                    )}
                    {m.mediaUrl && m.mediaType === "video" && (
                      <div className="relative">
                        <video
                          src={m.mediaUrl}
                          playsInline
                          muted
                          onClick={() => setLightbox(m.mediaUrl)}
                          className="rounded-xl max-h-64 w-full cursor-pointer"
                        />
                        <span
                          className="absolute inset-0 flex items-center justify-center pointer-events-none"
                        >
                          <span className="w-12 h-12 rounded-full bg-black/45 flex items-center justify-center text-white">
                            <Play size={22} className="fill-white" />
                          </span>
                        </span>
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col gap-2">
                          <button
                            type="button"
                            aria-label="Share this video"
                            onClick={() => setShareFor(m)}
                            className="w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center"
                          >
                            <Send size={17} />
                          </button>
                          <button
                            type="button"
                            aria-label="Open video"
                            onClick={() => setLightbox(m.mediaUrl)}
                            className="w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center"
                          >
                            <Scissors size={17} />
                          </button>
                        </span>
                      </div>
                    )}
                    {m.mediaUrl && m.mediaType === "audio" && (
                      <audio
                        src={m.mediaUrl}
                        controls
                        className="w-56 max-w-full my-1"
                      />
                    )}
                    {m.mediaUrl && m.mediaType === "file" && (

                      <a
                        href={m.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-2 px-2 py-2 rounded-xl ${
                          mine ? "bg-white/15" : "bg-white"
                        }`}
                      >
                        <FileText size={18} />
                        <span className="truncate max-w-[10rem]">
                          {m.mediaName || "File"}
                        </span>
                      </a>
                    )}
                    {m.text && (
                      <>
                        <PostLinkPreview text={m.text} />
                        <p className="px-2.5 py-1">
                          <LinkText text={m.text} mine={mine} />
                        </p>
                      </>
                    )}
                  </>
                )}
                <div
                  className={`flex items-center justify-end gap-1 px-2 pb-0.5 text-[10px] ${
                    mine ? "text-white/70" : "text-gray-400"
                  }`}
                >
                  {m.editedAt ? <span>Edited</span> : null}
                  <span>
                    {new Date(m.createdAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>· {timeAgo(m.createdAt)}</span>
                  {mine && !m.deleted && (
                    <>
                      {seen ? (
                        <span className="flex items-center gap-0.5 text-white">
                          <CheckCheck size={13} />
                          <span className="font-medium">Seen</span>
                        </span>
                      ) : delivered ? (
                        <span className="flex items-center gap-0.5 text-white/60">
                          <CheckCheck size={13} />
                          <span>Delivered</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-white/60">
                          <Check size={13} />
                          <span>Sent</span>
                        </span>
                      )}
                    </>
                  )}
                </div>
                {Object.values(m.reactions ?? {}).length > 0 && (
                  <div
                    className={`flex ${mine ? "justify-end" : "justify-start"} -mt-0.5 px-1.5`}
                  >
                    <button
                      type="button"
                      onClick={() => setMenuFor(m)}
                      className="flex items-center gap-0.5 rounded-full bg-white border border-gray-200 shadow-sm px-1.5 py-0.5 text-[12px] leading-none"
                    >
                      {Array.from(
                        new Set(Object.values(m.reactions ?? {})),
                      ).map((emoji) => (
                        <span key={emoji}>{emoji}</span>
                      ))}
                      {Object.values(m.reactions ?? {}).length > 1 && (
                        <span className="text-[10px] text-gray-500">
                          {Object.values(m.reactions ?? {}).length}
                        </span>
                      )}
                    </button>
                  </div>
                )}

              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {(file || error) && (
        <div className="px-3 pt-2">
          {file && (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-2xl p-2">
              {preview ? (
                <img
                  src={preview}
                  alt="preview"
                  className="w-12 h-12 rounded-xl object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-gray-400">
                  <FileText size={20} />
                </div>
              )}
              <span className="flex-1 text-xs text-gray-600 truncate">
                {file.name}
              </span>
              <button
                onClick={clearFile}
                aria-label="Remove attachment"
                className="text-gray-400"
              >
                <X size={18} />
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      )}

      {replyTo && !block.iBlocked && !block.blockedMe && (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded-2xl bg-gray-50 border border-gray-100 px-3 py-2">
          <CornerUpLeft size={15} className="mt-0.5 text-sky-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-gray-600">
              Replying to{" "}
              {replyTo.senderId === user?.uid
                ? "yourself"
                : nickname || other.displayName}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {replyTo.text ||
                replyTo.mediaName ||
                (replyTo.mediaType === "image"
                  ? "Photo"
                  : replyTo.mediaType === "video"
                    ? "Video"
                    : replyTo.mediaType === "audio"
                      ? "Voice message"
                      : "Attachment")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            aria-label="Cancel reply"
            className="text-gray-400"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {block.iBlocked || block.blockedMe ? (

        <div className="p-4 border-t border-gray-100 bg-white text-center space-y-2">
          <p className="text-sm text-gray-500">
            {block.iBlocked
              ? `You blocked ${nickname || other.displayName}. They can't message you until you unblock.`
              : "You can't send messages in this conversation."}
          </p>
          {block.iBlocked && (
            <button
              type="button"
              disabled={blockBusy}
              onClick={async () => {
                if (!user) return;
                setBlockBusy(true);
                try {
                  await setBlocked(user.uid, other.uid, false);
                } finally {
                  setBlockBusy(false);
                }
              }}
              className="px-5 py-2 rounded-full bg-sky-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              Unblock
            </button>
          )}
        </div>
      ) : (
      <form
        onSubmit={submit}
        className="flex items-center gap-2 p-3 border-t border-gray-100 bg-white"
      >
        {!recording && (
          <>
        <label
          className="w-10 h-10 shrink-0 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-sky-600 cursor-pointer active:scale-90 transition"
          aria-label="Attach photo or video"
          title="Photo / Video"
        >
          <ImagePlus size={19} />
          <input
            type="file"
            accept="image/*,video/*"
            onChange={pick}
            className="hidden"
          />
        </label>
        <label
          className="w-10 h-10 shrink-0 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-sky-600 cursor-pointer active:scale-90 transition"
          aria-label="Attach file"
          title="File"
        >
          <Paperclip size={18} />
          <input type="file" onChange={pick} className="hidden" />
        </label>
          </>
        )}
        <button
          type="button"
          onClick={() => (recording ? stopRecording(false) : startRecording())}
          aria-label={recording ? "Stop recording" : "Record voice message"}
          title={recording ? "Stop & send" : "Voice message"}
          className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center active:scale-90 transition ${
            recording
              ? "bg-red-500 text-white animate-pulse"
              : "bg-gray-50 border border-gray-100 text-sky-600"
          }`}
        >
          {recording ? <Square size={16} /> : <Mic size={19} />}
        </button>
        {recording ? (
          <div className="flex-1 min-w-0 h-11 px-4 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-between gap-2 text-sm text-red-600">
            <span className="truncate">
              Recording… {Math.floor(recordSecs / 60)}:
              {String(recordSecs % 60).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        ) : (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message..."
            className="flex-1 min-w-0 h-11 px-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
          />
        )}

        {!recording && (
        <button
          type="button"
          onClick={() => {
            if (!user) return;
            void sendMessage(user.uid, other.uid, quickReaction).catch((err) =>
              setError(
                err instanceof Error ? err.message : "Could not send message.",
              ),
            );
          }}
          aria-label={`Send ${quickReaction}`}
          title="Quick reaction"
          className="w-10 h-10 shrink-0 rounded-full bg-gray-50 border border-gray-100 text-xl flex items-center justify-center active:scale-90 transition"
        >
          {quickReaction}
        </button>
        )}
        <button
          type={recording ? "button" : "submit"}
          onClick={recording ? () => stopRecording(false) : undefined}
          aria-label={recording ? "Stop and send voice message" : "Send"}
          disabled={uploading || (!recording && !text.trim() && !file)}
          className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 text-white flex items-center justify-center disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Send size={18} />
          )}
        </button>
      </form>
      )}

      {menuFor && user && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={() => setMenuFor(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-3 space-y-1"
            onClick={(e) => e.stopPropagation()}
          >
            {!menuFor.deleted && menuFor.kind !== "call" && (
              <div className="flex items-center justify-between gap-1 bg-gray-50 border border-gray-100 rounded-full px-2 py-2 mb-1">
                {MESSAGE_REACTIONS.map((emoji) => {
                  const active = (menuFor.reactions ?? {})[user.uid] === emoji;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`React ${emoji}`}
                      onClick={() => {
                        void toggleMessageReaction(
                          user.uid,
                          other.uid,
                          menuFor.id,
                          emoji,
                        );
                        setMenuFor(null);
                      }}
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-xl transition-transform active:scale-90 ${
                        active ? "bg-sky-100 scale-110" : "hover:bg-white"
                      }`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            )}
            {!menuFor.deleted && menuFor.kind !== "call" && (
              <button
                onClick={() => {
                  setReplyTo(menuFor);
                  setMenuFor(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
              >
                <CornerUpLeft size={18} className="text-gray-400" />
                Reply
              </button>
            )}
            {!menuFor.deleted && menuFor.kind !== "call" && (
              <button
                onClick={() => {
                  setShareFor(menuFor);
                  setMenuFor(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
              >
                <Forward size={18} className="text-gray-400" />
                Forward
              </button>
            )}
            {menuFor.senderId === user.uid && !menuFor.deleted && menuFor.kind !== "call" && (
              <button
                onClick={() => {
                  setEditDraft(menuFor.text);
                  setEditFor(menuFor);
                  setMenuFor(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
              >
                <Pencil size={18} className="text-gray-400" />
                Edit message
              </button>
            )}
            <button

              onClick={() => {
                void deleteForMe(user.uid, other.uid, menuFor.id);
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              <Trash2 size={18} className="text-gray-400" />
              {menuFor.deleted ? "Remove from inbox" : "Delete for me"}
            </button>
            {menuFor.senderId === user.uid && !menuFor.deleted && (
              <button
                onClick={() => {
                  void deleteForEveryone(user.uid, other.uid, menuFor.id);
                  setMenuFor(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-red-500 hover:bg-red-50"
              >
                <Trash2 size={18} />
                Delete for everyone
              </button>
            )}
            <button
              onClick={() => setMenuFor(null)}
              className="w-full px-4 py-3 rounded-2xl text-sm text-gray-500 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-4 space-y-3 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <Avatar src={other.photoURL} alt={other.displayName} size={44} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {other.displayName}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  @{other.username}
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setSettingsOpen(false);
                onOpenProfile?.(other.uid);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              <User size={18} className="text-gray-400" />
              View profile
            </button>

            <div className="px-1">
              <p className="flex items-center gap-2 text-xs font-semibold text-gray-500 mb-2">
                <Palette size={15} className="text-gray-400" />
                Chat theme
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                {CHAT_THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTheme(t);
                      if (user)
                        void saveSharedTheme(conversationId(user.uid, other.uid), t.id);
                    }}
                    aria-label={`${t.name} theme`}
                    className={`w-10 h-10 rounded-full bg-gradient-to-br ${t.swatch} ${
                      theme.id === t.id
                        ? "ring-2 ring-offset-2 ring-gray-800"
                        : ""
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="px-1">
              <p className="flex items-center gap-2 text-xs font-semibold text-gray-500 mb-2">
                <Images size={15} className="text-gray-400" />
                Chat background
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                {CHAT_BACKGROUNDS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      const choice: ChatBackgroundChoice = { id: b.id };
                      setBg(choice);
                      if (user)
                        void saveSharedBackground(
                          conversationId(user.uid, other.uid),
                          choice,
                        );
                    }}
                    aria-label={`${b.name} background`}
                    title={b.name}
                    className={`w-10 h-10 rounded-full border border-gray-200 bg-gradient-to-br ${b.swatch} ${
                      bg.id === b.id ? "ring-2 ring-offset-2 ring-gray-800" : ""
                    }`}
                  />
                ))}
                <label
                  aria-label="Choose background from gallery"
                  title="From gallery"
                  className={`w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center cursor-pointer overflow-hidden bg-gray-50 text-gray-500 ${
                    bg.id === "custom" ? "ring-2 ring-offset-2 ring-gray-800" : ""
                  }`}
                >
                  {bgUploading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : bg.id === "custom" && bg.imageUrl ? (
                    <img
                      src={bg.imageUrl}
                      alt="Chat background"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImagePlus size={17} />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const picked = e.target.files?.[0];
                      e.target.value = "";
                      if (!picked || !user) return;
                      setBgUploading(true);
                      setError("");
                      try {
                        const uploaded = await uploadToCloudinary(picked);
                        const choice: ChatBackgroundChoice = {
                          id: "custom",
                          imageUrl: secureUrl(uploaded.url),
                        };
                        setBg(choice);
                        void saveSharedBackground(
                          conversationId(user.uid, other.uid),
                          choice,
                        );
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Could not set background",
                        );
                      } finally {
                        setBgUploading(false);
                      }
                    }}
                  />
                </label>
              </div>
              {bg.id === "custom" && (
                <button
                  onClick={() => {
                    const choice: ChatBackgroundChoice = { id: "default" };
                    setBg(choice);
                    if (user)
                      void saveSharedBackground(
                        conversationId(user.uid, other.uid),
                        choice,
                      );
                  }}
                  className="mt-2 text-xs font-semibold text-sky-600"
                >
                  Remove photo background
                </button>
              )}
            </div>



            <button
              onClick={() => {
                setSettingsOpen(false);
                setSearchOpen(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              <Search size={18} className="text-gray-400" />
              Search in conversation
            </button>

            <button
              onClick={() => {
                setSettingsOpen(false);
                setMediaOpen(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              <Images size={18} className="text-gray-400" />
              View media, files & links
            </button>

            <button
              onClick={() => {
                setNicknameDraft(nickname);
                setSettingsOpen(false);
                setNicknameOpen(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              <Pencil size={18} className="text-gray-400" />
              Nicknames
            </button>

            <button
              onClick={() => setQuickOpen((open) => !open)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              <span className="text-lg leading-none">{quickReaction}</span>
              Quick reaction
            </button>
            {quickOpen && (
              <div className="px-1 pb-2 flex items-center gap-2 flex-wrap">
                {QUICK_REACTION_CHOICES.map((emoji) => (
                  <button
                    key={emoji}
                    aria-label={`Quick reaction ${emoji}`}
                    onClick={() =>
                      user &&
                      void saveSharedQuickReaction(
                        conversationId(user.uid, other.uid),
                        emoji,
                      ).then(setQuickReaction)
                    }
                    className={`w-10 h-10 rounded-full text-xl flex items-center justify-center border ${
                      quickReaction === emoji
                        ? "border-sky-400 bg-sky-50"
                        : "border-gray-100 bg-gray-50"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => {
                const next = !muted;
                setMuted(next);
                setPrefs(other.uid, { muted: next });
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              {muted ? (
                <Bell size={18} className="text-gray-400" />
              ) : (
                <BellOff size={18} className="text-gray-400" />
              )}
              {muted ? "Unmute notifications" : "Mute notifications"}
            </button>

            <button
              disabled={blockBusy}
              onClick={async () => {
                if (!user) return;
                setBlockBusy(true);
                try {
                  await setBlocked(user.uid, other.uid, !block.iBlocked);
                } finally {
                  setBlockBusy(false);
                  setSettingsOpen(false);
                }
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm hover:bg-gray-50 disabled:opacity-50 ${
                block.iBlocked ? "text-gray-700" : "text-red-500"
              }`}
            >
              {block.iBlocked ? (
                <ShieldOff size={18} className="text-gray-400" />
              ) : (
                <Ban size={18} />
              )}
              {block.iBlocked ? "Unblock" : "Block"}
            </button>

            <button
              onClick={() => setSettingsOpen(false)}
              className="w-full px-4 py-3 rounded-2xl text-sm text-gray-500 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {mediaOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={() => setMediaOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-4 max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-900 mb-3">
              Media, files & links
            </p>
            <div className="grid grid-cols-3 gap-2">
              {visible
                .filter((m) => !m.deleted && m.mediaUrl)
                .map((m) => (
                  <a
                    key={m.id}
                    href={m.mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="aspect-square rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center"
                  >
                    {m.mediaType === "image" ? (
                      <img
                        src={m.mediaUrl}
                        alt={m.mediaName || "photo"}
                        className="w-full h-full object-cover"
                      />
                    ) : m.mediaType === "video" ? (
                      <video src={m.mediaUrl} className="w-full h-full object-cover" />
                    ) : (
                      <FileText size={22} className="text-gray-400" />
                    )}
                  </a>
                ))}
            </div>
            {visible.filter((m) => !m.deleted && m.mediaUrl).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">
                No media yet.
              </p>
            )}
            <button
              onClick={() => setMediaOpen(false)}
              className="w-full mt-3 px-4 py-3 rounded-2xl text-sm text-gray-500 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {nicknameOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={() => setNicknameOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-900">Nickname</p>
            <input
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
              placeholder={other.displayName}
              aria-label="Nickname"
              className="w-full h-11 px-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
            />
            <button
              onClick={() => {
                const value = nicknameDraft.trim();
                setNickname(value);
                setPrefs(other.uid, { nickname: value });
                setNicknameOpen(false);
              }}
              className="w-full h-11 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-semibold"
            >
              Save
            </button>
            <button
              onClick={() => setNicknameOpen(false)}
              className="w-full px-4 py-3 rounded-2xl text-sm text-gray-500 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {editFor && user && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={() => setEditFor(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-900">Edit message</p>
            <input
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              aria-label="Edit message"
              className="w-full h-11 px-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
            />
            <button
              onClick={async () => {
                const value = editDraft.trim();
                const target = editFor;
                setEditFor(null);
                if (!value || !target || value === target.text) return;
                try {
                  await editMessage(user.uid, other.uid, target.id, value);
                } catch {
                  setError("Could not edit message");
                }
              }}
              className="w-full h-11 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-semibold"
            >
              Save
            </button>
            <button
              onClick={() => setEditFor(null)}
              className="w-full px-4 py-3 rounded-2xl text-sm text-gray-500 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {lightbox && (

        <VideoLightbox src={lightbox} onClose={() => setLightbox("")} />
      )}
      {imageView && (
        <ImageLightbox
          src={imageView.url}
          name={imageView.name}
          createdAt={imageView.createdAt}
          onClose={() => setImageView(null)}
        />
      )}
      {shareFor && (
        <ShareSheet
          mediaUrl={shareFor.mediaUrl}
          mediaType={shareFor.mediaType || "video"}
          text={shareFor.text}
          {...(shareFor.postId ? { postId: shareFor.postId } : {})}
          onClose={() => setShareFor(null)}
        />
      )}
    </div>

  );
}
