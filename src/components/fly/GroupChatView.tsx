import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CornerUpLeft,
  FileText,
  ImagePlus,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Phone,
  Info,
  Play,
  Scissors,
  Send,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, secureUrl, uploadToCloudinary } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { LinkText } from "./LinkText";
import { PostLinkPreview } from "./PostLinkPreview";
import { useAuth } from "./AuthContext";
import {
  deleteGroupMessageForEveryone,
  deleteGroupMessageForMe,
  editGroupMessage,
  groupFromData,
  leaveGroupConversation,
  markGroupSeen,
  sendGroupMessage,
  toggleGroupMessageReaction,
  toMillis,
  updateGroupInfo,
  MESSAGE_REACTIONS,
} from "./chat";
import { getPrefs, markOpened, setPrefs } from "./chatPrefs";
import { markConversationRead } from "./readState";
import {
  backgroundClass,
  backgroundForTheme,
  type ChatBackgroundChoice,
  defaultTheme,
  loadBackground,
  loadTheme,
  saveSharedBackground,
  saveSharedTheme,
  subscribeAppearance,
  type ChatTheme,
} from "./chatTheme";
import { loadGroupNicknames, saveGroupNickname, type GroupNicknames } from "./groupNicknames";
import {
  DEFAULT_QUICK_REACTION,
  loadQuickReaction,
  saveSharedQuickReaction,
  subscribeQuickReaction,
} from "./quickReaction";
import { GroupMediaSheet, GroupSearchSheet, GroupSettingsSheet } from "./GroupSettingsSheet";
import { GroupMembersSheet } from "./GroupMembersSheet";
import { NotificationSettingsModal } from "./NotificationSettingsModal";
import { ImageLightbox, ShareSheet, VideoLightbox } from "./ShareSheet";
import { timeAgo } from "../../lib/time";
import { useGroupCalls } from "./groupCallContext";
import { MAX_GROUP_CALL_PARTICIPANTS } from "./groupCalls";
import type { ChatMessage, GroupConversation } from "./types";


export function GroupChatView({
  group: initialGroup,
  onBack,
}: {
  group: GroupConversation;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const { startGroupCall, busy: callBusy } = useGroupCalls();
  const [group, setGroup] = useState<GroupConversation>(initialGroup);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [theme, setTheme] = useState<ChatTheme>(defaultTheme);
  const [background, setBackground] = useState<ChatBackgroundChoice>({
    id: "default",
  });
  const [muted, setMuted] = useState(false);
  const [nicknames, setNicknames] = useState<GroupNicknames>({});
  const [quickReaction, setQuickReaction] = useState(DEFAULT_QUICK_REACTION);
  const [leaving, setLeaving] = useState(false);
  const [lightbox, setLightbox] = useState("");
  const [imageView, setImageView] = useState<{
    url: string;
    name?: string;
    createdAt?: number;
  } | null>(null);
  const [shareFor, setShareFor] = useState<ChatMessage | null>(null);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editFor, setEditFor] = useState<ChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRecordRef = useRef(false);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordStartRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(loadTheme(group.id));
    setBackground(loadBackground(group.id));
    setNicknames(loadGroupNicknames(group.id));
    setQuickReaction(loadQuickReaction(group.id));
    setMuted(getPrefs(group.id).muted);
  }, [group.id]);

  /** Theme/background picked by any member shows up for everyone. */
  useEffect(() => {
    const stopAppearance = subscribeAppearance(group.id, (next) => {
      if (next.theme) setTheme(next.theme);
      if (next.background) setBackground(next.background);
    });
    // A quick reaction picked by any member shows up for everyone.
    const stopQuick = subscribeQuickReaction(group.id, setQuickReaction);
    return () => {
      stopAppearance();
      stopQuick();
    };
  }, [group.id]);

  /** Keeps group name/photo live for everyone in the chat. */
  useEffect(() => {
    return onSnapshot(doc(db, "conversations", initialGroup.id), (snap) => {
      if (!snap.exists()) return;
      setGroup(groupFromData(snap.id, snap.data() as Record<string, unknown>));
    });
  }, [initialGroup.id]);

  useEffect(() => {
    if (!recording) {
      setRecordSecs(0);
      return;
    }
    const timer = setInterval(() => setRecordSecs((secs) => secs + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const sendVoice = async (blob: Blob) => {
    if (!user) return;
    setError("");
    setUploading(true);
    try {
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      const voice = new File([blob], `voice-${Date.now()}.${ext}`, {
        type: blob.type || "audio/webm",
      });
      const uploaded = await uploadToCloudinary(voice);
      await sendGroupMessage(group, user.uid, "", {
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
        (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      cancelRecordRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recordStreamRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        chunksRef.current = [];
        recorderRef.current = null;
        setRecording(false);
        if (cancelRecordRef.current) return;
        if (blob.size < 1024) {
          setError("Recording too short — hold the mic for a moment longer");
          return;
        }
        void sendVoice(blob);
      };
      recorder.onerror = () => setError("Recording failed — please try again");
      recorderRef.current = recorder;
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
    const elapsed = Date.now() - recordStartRef.current;
    if (!cancel && elapsed < 700) setTimeout(finish, 700 - elapsed);
    else finish();
  };

  /** Stops any running recording when the thread closes. */
  useEffect(() => {
    return () => {
      cancelRecordRef.current = true;
      try {
        if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      } catch {
        /* noop */
      }
      recordStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordStreamRef.current = null;
      recorderRef.current = null;
    };
  }, []);


  useEffect(() => {
    const messagesQuery = query(
      collection(db, "conversations", group.id, "messages"),
      orderBy("createdAt", "asc"),
    );
    return onSnapshot(
      messagesQuery,
      (snap) => {
        setMessages(
          snap.docs.map((message) => {
            const data = message.data() as Record<string, unknown>;
            return {
              id: message.id,
              senderId: String(data["senderId"] ?? ""),
              text: String(data["text"] ?? ""),
              kind: data["kind"] === "call" ? "call" : "text",
              mediaUrl: secureUrl(String(data["mediaUrl"] ?? "")),
              mediaType: String(data["mediaType"] ?? ""),
              mediaName: String(data["mediaName"] ?? ""),
              postId: String(data["postId"] ?? ""),
              replyToId: String(data["replyToId"] ?? ""),
              replyToText: String(data["replyToText"] ?? ""),
              replyToSenderId: String(data["replyToSenderId"] ?? ""),
              editedAt: data["editedAt"] ? toMillis(data["editedAt"]) : 0,
              createdAt: toMillis(data["createdAt"]),
              deliveredTo: Array.isArray(data["deliveredTo"])
                ? (data["deliveredTo"] as string[])
                : [],
              seenBy: Array.isArray(data["seenBy"]) ? (data["seenBy"] as string[]) : [],
              deletedFor: Array.isArray(data["deletedFor"]) ? (data["deletedFor"] as string[]) : [],
              deleted: Boolean(data["deleted"]),
              reactions:
                data["reactions"] && typeof data["reactions"] === "object"
                  ? (data["reactions"] as Record<string, string>)
                  : {},
            };

          }),
        );
      },
      () => setError("Could not load group messages."),
    );
  }, [group.id]);

  const visible = useMemo(
    () => messages.filter((message) => !message.deletedFor.includes(user?.uid ?? "")),
    [messages, user],
  );

  useEffect(() => {
    if (!user) return;
    void markGroupSeen(group.id, user.uid);
    markOpened(group.id);
    void markConversationRead(group.id, user.uid);
  }, [group.id, user, visible.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length]);

  const memberName = (uid: string) =>
    nicknames[uid] || group.members.find((member) => member.uid === uid)?.displayName || "Member";

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(selected && selected.type.startsWith("image/") ? URL.createObjectURL(selected) : "");
    event.target.value = "";
  };

  const clearFile = () => {
    setFile(null);
    setPreview("");
  };

  const quotedPreview = (message: ChatMessage) =>
    message.text ||
    message.mediaName ||
    (message.mediaType === "image"
      ? "Photo"
      : message.mediaType === "video"
        ? "Video"
        : message.mediaType === "audio"
          ? "Voice message"
          : "Attachment");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || (!text.trim() && !file)) return;
    const value = text.trim();
    const selected = file;
    const quoted = replyTo;
    const reply = quoted
      ? { id: quoted.id, text: quotedPreview(quoted), senderId: quoted.senderId }
      : undefined;
    setText("");
    clearFile();
    setReplyTo(null);
    setError("");
    try {
      let media: { url: string; type: string; name?: string } | undefined;
      if (selected) {
        setUploading(true);
        const uploaded = await uploadToCloudinary(selected);
        const type = selected.type.startsWith("image/")
          ? "image"
          : selected.type.startsWith("video/")
            ? "video"
            : uploaded.resourceType === "video"
              ? "video"
              : "file";
        media = { url: uploaded.url, type, name: selected.name };
      }
      await sendGroupMessage(group, user.uid, value, media, undefined, reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
      setText(value);
      if (selected) setFile(selected);
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
        <Avatar src={group.photoURL} alt={group.name} size={36} />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="min-w-0 flex-1 text-left"
          aria-label="Group settings"
        >
          <p className="text-sm font-semibold text-gray-900 truncate">{group.name}</p>
          <p className="text-xs text-gray-400 truncate">{group.participantIds.length} members</p>
        </button>
        <button
          type="button"
          disabled={callBusy || group.participantIds.length > MAX_GROUP_CALL_PARTICIPANTS}
          onClick={() => void startGroupCall(group, "audio")}
          aria-label="Group audio call"
          className="w-9 h-9 rounded-full flex items-center justify-center text-sky-600 hover:bg-sky-50 disabled:opacity-40"
        >
          <Phone size={19} />
        </button>
        <button
          type="button"
          disabled={callBusy || group.participantIds.length > MAX_GROUP_CALL_PARTICIPANTS}
          onClick={() => void startGroupCall(group, "video")}
          aria-label="Group video call"
          className="w-9 h-9 rounded-full flex items-center justify-center text-sky-600 hover:bg-sky-50 disabled:opacity-40"
        >
          <Video size={19} />
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Group settings"
          className="w-9 h-9 rounded-full flex items-center justify-center text-sky-600 hover:bg-sky-50"
        >
          <Info size={19} />
        </button>
      </header>

      <div
        className={`flex-1 overflow-y-auto px-4 py-4 space-y-2 ${
          background.id === "default"
            ? `bg-sky-50/30 ${theme.background}`
            : backgroundClass(background)
        }`}
        style={
          background.id === "custom" && background.imageUrl
            ? {
                backgroundImage: `url(${background.imageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {visible.length === 0 && (
          <p className="text-center text-sm text-gray-400 mt-10">
            Start a conversation in {group.name}
          </p>
        )}
        {visible.map((message) => {
          const mine = message.senderId === user?.uid;
          if (message.kind === "call") {
            const label = message.text || "Call";
            const isVideo = label.toLowerCase().includes("video");
            const unanswered =
              /missed|no answer|declined/i.test(label) && !/·\s*\d/.test(label);
            const CallIcon = isVideo ? Video : Phone;
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuFor(message);
                  }}
                  onDoubleClick={() => setMenuFor(message)}
                  style={{ WebkitTouchCallout: "none" }}
                  className="max-w-[78%] rounded-2xl bg-gray-100 px-3 py-2.5 select-none"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        unanswered ? "bg-red-500 text-white" : "bg-gray-300 text-gray-700"
                      }`}
                    >
                      <CallIcon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-gray-800">
                        {label}
                      </span>
                      <span className="block text-[11px] text-gray-500">
                        {!mine ? `${memberName(message.senderId)} · ` : ""}
                        {new Date(message.createdAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                  </div>
                  {unanswered ? (
                    <button
                      type="button"
                      disabled={
                        callBusy || group.participantIds.length > MAX_GROUP_CALL_PARTICIPANTS
                      }
                      onClick={() => void startGroupCall(group, isVideo ? "video" : "audio")}
                      className="mt-2 w-full rounded-xl bg-gray-200 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
                    >
                      Call back
                    </button>
                  ) : null}
                </div>
              </div>
            );
          }
          const others = group.participantIds.filter((uid) => uid !== message.senderId);
          const seen = others.length > 0 && others.every((uid) => message.seenBy.includes(uid));
          const delivered =
            seen ||
            (others.length > 0 &&
              others.every((uid) => message.deliveredTo.includes(uid) || message.seenBy.includes(uid)));
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[78%]">
                {!mine && (
                  <p className="text-[11px] text-gray-500 mb-1 px-2">
                    {memberName(message.senderId)}
                  </p>
                )}
                <div
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuFor(message);
                  }}
                  onDoubleClick={() => {
                    if (message.deleted || !user) {
                      setMenuFor(message);
                      return;
                    }
                    void toggleGroupMessageReaction(group.id, user.uid, message.id, quickReaction);
                  }}
                  style={{ WebkitTouchCallout: "none" }}
                  className={`px-1.5 py-1.5 rounded-2xl text-sm break-words select-none ${
                    mine
                      ? `${theme.mine} rounded-br-md`
                      : "bg-white text-gray-800 border border-gray-100 rounded-bl-md"
                  }`}

                >
                  {!message.deleted && message.replyToText ? (
                    <div
                      className={`mb-1 px-2.5 py-1 rounded-xl border-l-2 text-[11px] ${
                        mine
                          ? "bg-white/15 border-white/60 text-white/85"
                          : "bg-gray-50 border-sky-300 text-gray-500"
                      }`}
                    >
                      <span className="block font-semibold">
                        {message.replyToSenderId === user?.uid
                          ? "You"
                          : memberName(message.replyToSenderId ?? "")}
                      </span>
                      <span className="line-clamp-2">{message.replyToText}</span>
                    </div>
                  ) : null}
                  {message.deleted ? (

                    <p className="px-2.5 py-1 italic opacity-70">This message was deleted</p>
                  ) : (
                    <>
                      {message.mediaUrl && message.mediaType === "image" && (
                        <button
                          type="button"
                          onClick={() =>
                            setImageView({
                              url: message.mediaUrl,
                              name: message.mediaName,
                              createdAt: message.createdAt,
                            })
                          }
                          className="block w-full"
                        >
                          <img
                            src={message.mediaUrl}
                            alt={message.mediaName || "photo"}
                            className="rounded-xl max-h-64 w-full object-cover"
                          />
                        </button>
                      )}
                      {message.mediaUrl && message.mediaType === "video" && (
                        <div className="relative">
                          <video
                            src={message.mediaUrl}
                            playsInline
                            muted
                            onClick={() => setLightbox(message.mediaUrl)}
                            className="rounded-xl max-h-64 w-full cursor-pointer"
                          />
                          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="w-12 h-12 rounded-full bg-black/45 flex items-center justify-center text-white">
                              <Play size={22} className="fill-white" />
                            </span>
                          </span>
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col gap-2">
                            <button
                              type="button"
                              aria-label="Share this video"
                              onClick={() => setShareFor(message)}
                              className="w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center"
                            >
                              <Send size={17} />
                            </button>
                            <button
                              type="button"
                              aria-label="Open video"
                              onClick={() => setLightbox(message.mediaUrl)}
                              className="w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center"
                            >
                              <Scissors size={17} />
                            </button>
                          </span>
                        </div>
                      )}
                      {message.mediaUrl && message.mediaType === "audio" && (
                        <audio src={message.mediaUrl} controls className="w-56 max-w-full my-1" />
                      )}
                      {message.mediaUrl && message.mediaType === "file" && (

                        <a
                          href={message.mediaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 px-2 py-2 rounded-xl bg-white/20"
                        >
                          <FileText size={18} />
                          <span className="truncate max-w-[10rem]">
                            {message.mediaName || "File"}
                          </span>
                        </a>
                      )}
                      {message.text && (
                        <>
                          <PostLinkPreview text={message.text} />
                          <p className="px-2.5 py-1">
                            <LinkText text={message.text} mine={mine} />
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
                    {message.editedAt ? <span>Edited</span> : null}
                    <span>
                      {new Date(message.createdAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <span>· {timeAgo(message.createdAt)}</span>
                    {mine && !message.deleted && (
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
                  {Object.values(message.reactions ?? {}).length > 0 && (
                    <div className={`flex ${mine ? "justify-end" : "justify-start"} -mt-0.5 px-1.5`}>
                      <button
                        type="button"
                        onClick={() => setMenuFor(message)}
                        className="flex items-center gap-0.5 rounded-full bg-white border border-gray-200 shadow-sm px-1.5 py-0.5 text-[12px] leading-none"
                      >
                        {Array.from(new Set(Object.values(message.reactions ?? {}))).map((emoji) => (
                          <span key={emoji}>{emoji}</span>
                        ))}
                        {Object.values(message.reactions ?? {}).length > 1 && (
                          <span className="text-[10px] text-gray-500">
                            {Object.values(message.reactions ?? {}).length}
                          </span>
                        )}
                      </button>
                    </div>
                  )}
                </div>
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
                <img src={preview} alt="preview" className="w-12 h-12 rounded-xl object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-gray-400">
                  <FileText size={20} />
                </div>
              )}
              <span className="flex-1 text-xs text-gray-600 truncate">{file.name}</span>
              <button onClick={clearFile} aria-label="Remove attachment">
                <X size={18} className="text-gray-400" />
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      )}

      {replyTo && (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded-2xl bg-gray-50 border border-gray-100 px-3 py-2">
          <CornerUpLeft size={15} className="mt-0.5 text-sky-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-gray-600">
              Replying to{" "}
              {replyTo.senderId === user?.uid ? "yourself" : memberName(replyTo.senderId)}
            </p>
            <p className="text-xs text-gray-500 truncate">{quotedPreview(replyTo)}</p>
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


      <form
        onSubmit={submit}
        className="flex items-center gap-2 p-3 border-t border-gray-100 bg-white"
      >
        {!recording && (
          <>
            <label
              className="w-10 h-10 shrink-0 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-sky-600 cursor-pointer"
              aria-label="Attach photo or video"
            >
              <ImagePlus size={19} />
              <input type="file" accept="image/*,video/*" onChange={pick} className="hidden" />
            </label>
            <label
              className="w-10 h-10 shrink-0 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-sky-600 cursor-pointer"
              aria-label="Attach file"
            >
              <Paperclip size={18} />
              <input type="file" onChange={pick} className="hidden" />
            </label>
          </>
        )}
        <button
          type="button"
          onClick={() => (recording ? stopRecording(false) : void startRecording())}
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
          <div className="flex-1 min-w-0 h-11 px-4 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-between gap-3 text-sm text-red-600">
            <span className="truncate">
              Recording… {Math.floor(recordSecs / 60)}:{String(recordSecs % 60).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="shrink-0 text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        ) : (
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Message the group..."
            className="flex-1 min-w-0 h-11 px-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
          />
        )}

        {!recording && (
          <button
            type="button"
            onClick={() => {
              if (!user) return;
              void sendGroupMessage(group, user.uid, quickReaction).catch((err) =>
                setError(err instanceof Error ? err.message : "Could not send message."),
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
          disabled={uploading || (!recording && !text.trim() && !file)}
          aria-label={recording ? "Stop and send voice message" : "Send"}
          className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 text-white flex items-center justify-center disabled:opacity-50"
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </form>

      {menuFor && user && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={() => setMenuFor(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-3 space-y-1"
            onClick={(event) => event.stopPropagation()}
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
                        void toggleGroupMessageReaction(group.id, user.uid, menuFor.id, emoji);
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
            {!menuFor.deleted && menuFor.kind !== "call" && menuFor.mediaUrl ? (
              <button
                onClick={() => {
                  setShareFor(menuFor);
                  setMenuFor(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
              >
                <Send size={18} className="text-gray-400" />
                Forward
              </button>
            ) : null}
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
                void deleteGroupMessageForMe(
                  group.id,
                  user.uid,
                  menuFor.id,
                  group.participantIds,
                );
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
                  void deleteGroupMessageForEveryone(group.id, user.uid, menuFor.id);
                  setMenuFor(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-red-500 hover:bg-red-50"
              >
                <Trash2 size={18} />
                Unsend for everyone
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

      {editFor && user && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={() => setEditFor(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-4 space-y-3"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-900">Edit message</p>
            <input
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
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
                  await editGroupMessage(group.id, target.id, value);
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

      {membersOpen && <GroupMembersSheet group={group} onClose={() => setMembersOpen(false)} />}
      {settingsOpen && (
        <GroupSettingsSheet
          group={group}
          theme={theme}
          background={background}
          muted={muted}
          nicknames={nicknames}
          quickReaction={quickReaction}
          onQuickReaction={(emoji) => {
            void saveSharedQuickReaction(group.id, emoji).then(setQuickReaction);
          }}
          leaving={leaving}
          onUpdateGroup={async (changes) => {
            await updateGroupInfo(group.id, changes);
            setGroup((current) => ({ ...current, ...changes }));
          }}

          onTheme={(next) => {
            setTheme(next);
            const matching = backgroundForTheme(next);
            setBackground(matching);
            void saveSharedTheme(group.id, next.id);
            void saveSharedBackground(group.id, matching);
          }}
          onBackground={(choice) => {
            setBackground(choice);
            void saveSharedBackground(group.id, choice);
          }}
          onToggleMute={() => {
            const next = !muted;
            setMuted(next);
            setPrefs(group.id, { muted: next });
          }}
          onNickname={(uid, value) => setNicknames(saveGroupNickname(group.id, uid, value))}
          onCall={(mode) => {
            setSettingsOpen(false);
            void startGroupCall(group, mode);
          }}
          onOpenMembers={() => {
            setSettingsOpen(false);
            setMembersOpen(true);
          }}
          onOpenMedia={() => {
            setSettingsOpen(false);
            setMediaOpen(true);
          }}
          onOpenSearch={() => {
            setSettingsOpen(false);
            setSearchOpen(true);
          }}
          onOpenNotifications={() => {
            setSettingsOpen(false);
            setNotifOpen(true);
          }}
          onInvite={() => {
            setSettingsOpen(false);
            setMembersOpen(true);
          }}
          onLeave={async () => {
            if (!user || leaving) return;
            setLeaving(true);
            try {
              await leaveGroupConversation(group, user.uid);
              setSettingsOpen(false);
              onBack();
            } catch {
              setError("Could not leave this chat.");
            } finally {
              setLeaving(false);
            }
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {searchOpen && (
        <GroupSearchSheet
          results={visible
            .filter((message) => !message.deleted && message.text)
            .map((message) => ({
              id: message.id,
              text: message.text,
              sender: memberName(message.senderId),
              createdAt: message.createdAt,
            }))}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {mediaOpen && (
        <GroupMediaSheet
          items={visible
            .filter((message) => !message.deleted && message.mediaUrl)
            .map((message) => ({
              id: message.id,
              mediaUrl: message.mediaUrl,
              mediaType: message.mediaType,
              mediaName: message.mediaName,
            }))}
          onClose={() => setMediaOpen(false)}
        />
      )}
      {notifOpen && <NotificationSettingsModal onClose={() => setNotifOpen(false)} />}
      {lightbox && <VideoLightbox src={lightbox} onClose={() => setLightbox("")} />}
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
