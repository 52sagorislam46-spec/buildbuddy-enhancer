import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Flag,
  Heart,
  ImagePlus,
  Link2,
  Loader2,
  MoreVertical,
  Plus,
  Send,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db, isVideoFile, secureUrl, uploadToCloudinary } from "../../lib/firebase";
import { useAuth } from "./AuthContext";
import { fetchProfile, sendMessage } from "./chat";
import { notifyUpload } from "../../lib/appNotifications";
import { Avatar } from "./Avatar";
import type { Story } from "./types";
import {
  NOTE_MAX,
  deleteNote,
  saveNote,
  subscribeNotes,
  type UserNote,
} from "./notes";



const STORY_TTL = 24 * 60 * 60 * 1000; // 24 hours
const STORY_DURATION = 5000; // 5s per image story

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in (value as object)) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === "number" ? value : Date.now();
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

function useStories() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "stories"), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        setStories(
          snap.docs
            .map((d) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const data: any = d.data();
              return {
                id: d.id,
                authorId: data.authorId ?? "",
                authorName: data.authorName ?? "Anonymous",
                authorUsername: data.authorUsername ?? "user",
                authorPhoto: data.authorPhoto ?? "",
                mediaUrl: data.mediaUrl ?? "",
                mediaType: data.mediaType ?? "image",
                createdAt: toMillis(data.createdAt),
                reactions: (data.reactions as Record<string, string>) ?? {},
              } as Story;
            })
            .filter((s) => s.mediaUrl && now - s.createdAt < STORY_TTL),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { stories, loading };
}

interface StoryGroup {
  authorId: string;
  authorName: string;
  authorPhoto: string;
  stories: Story[];
}

function AddStoryModal({ onClose }: { onClose: () => void }) {
  const { ensureUserProfile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : "");
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const profile = await ensureUserProfile();
      const uploaded = await uploadToCloudinary(file);
      const storyMediaType =
        uploaded.resourceType || (isVideoFile(file) ? "video" : "image");
      await addDoc(collection(db, "stories"), {
        authorId: profile.uid,
        authorName: profile.displayName,
        authorUsername: profile.username,
        authorPhoto: profile.photoURL,
        mediaUrl: uploaded.url,
        mediaType: storyMediaType,
        createdAt: serverTimestamp(),
      });
      void notifyUpload({
        type: "story",
        actorId: profile.uid,
        actorName: profile.displayName,
        actorPhoto: profile.photoURL,
        followers: profile.followers,
        mediaUrl: storyMediaType === "image" ? uploaded.url : "",
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add story");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Add to story</h2>
          <button onClick={onClose} className="text-gray-400" aria-label="Close">
            <X size={22} />
          </button>
        </div>
        {preview ? (
          <div className="rounded-2xl overflow-hidden bg-gray-100 max-h-80">
            {file && isVideoFile(file) ? (
              <video src={preview} controls className="w-full max-h-80" />
            ) : (
              <img src={preview} alt="story preview" className="w-full object-cover" />
            )}
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 h-48 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 cursor-pointer active:bg-gray-50">
            <ImagePlus size={32} />
            <span className="text-sm">Choose photo or video</span>
            <input
              type="file"
              accept="image/*,video/*"
              onChange={pick}
              className="hidden"
            />
          </label>
        )}
        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2 mt-3">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between mt-4">
          {preview ? (
            <label className="flex items-center gap-2 text-sky-500 font-medium cursor-pointer">
              <ImagePlus size={20} />
              <span className="text-sm">Change</span>
              <input
                type="file"
                accept="image/*,video/*"
                onChange={pick}
                className="hidden"
              />
            </label>
          ) : (
            <span />
          )}
          <button
            onClick={submit}
            disabled={busy || !file}
            className="h-10 px-6 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Share story
          </button>
        </div>
      </div>
    </div>
  );
}

const VIEWED_KEY = "fly_viewed_story_ids";

function readViewedIds(): string[] {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const REACTION_EMOJIS = ["Love", "Laugh", "Surprised", "Sad", "Like", "Fire"];

// Stored reaction values stay the same words (backward compatible), but the UI
// always renders the matching emoji glyph instead of the plain text.
const REACTION_GLYPHS: Record<string, string> = {
  Love: "❤️",
  Laugh: "😂",
  Surprised: "😮",
  Sad: "😢",
  Like: "👍",
  Fire: "🔥",
};

const reactionGlyph = (value?: string) =>
  (value && REACTION_GLYPHS[value]) || value || "";

// Tapping the same emoji again removes the reaction (undo); tapping a
// different one switches it, since each user only ever has one reaction.
async function reactToStory(
  storyId: string,
  uid: string,
  emoji: string,
  current?: string,
) {
  const remove = current === emoji;
  await setDoc(
    doc(db, "stories", storyId),
    { reactions: { [uid]: remove ? deleteField() : emoji } },
    { merge: true },
  );
}

function StoryViewer({
  groups,
  startGroup,
  onClose,
  onStoryViewed,
}: {
  groups: StoryGroup[];
  startGroup: number;
  onClose: () => void;
  onStoryViewed: (storyId: string) => void;
}) {
  const { user } = useAuth();
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuNote, setMenuNote] = useState("");

  const [replySent, setReplySent] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const group = groups[gi];
  const story = group?.stories[si];

  const myReaction = user ? story?.reactions?.[user.uid] : undefined;

  const reactionCounts = useMemo<[string, number][]>(() => {
    const counts = new Map<string, number>();
    Object.values(story?.reactions ?? {}).forEach((emoji) => {
      if (!emoji) return;
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [story?.reactions]);

  const totalReactions = reactionCounts.reduce((sum, [, c]) => sum + c, 0);

  // "Who reacted" list (Facebook-style)
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [reactors, setReactors] = useState<
    { uid: string; name: string; photo: string; emoji: string }[]
  >([]);
  const [reactorsLoading, setReactorsLoading] = useState(false);

  const reactorsOpenRef = useRef(false);
  reactorsOpenRef.current = reactorsOpen;

  useEffect(() => {
    if (!reactorsOpen || !story) return;
    const entries = Object.entries(story.reactions ?? {}).filter(([, e]) => !!e);
    let cancelled = false;
    setReactorsLoading(true);
    void Promise.all(
      entries.map(async ([uid, emoji]) => {
        const profile = await fetchProfile(uid).catch(() => null);
        return {
          uid,
          emoji: emoji as string,
          name: profile?.displayName ?? "Anonymous",
          photo: profile?.photoURL ?? "",
        };
      }),
    ).then((list) => {
      if (cancelled) return;
      setReactors(list);
      setReactorsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reactorsOpen, story?.id, story?.reactions]);


  const sendReply = async () => {
    if (!user || !story || !reply.trim()) return;
    setSending(true);
    try {
      // Story comments land in the author's inbox together with the story
      // media itself, so they see what the comment is about.
      const media = secureUrl(story.mediaUrl)
        ? {
            url: secureUrl(story.mediaUrl),
            type: story.mediaType === "video" ? "video" : "image",
            name: "Story",
          }
        : undefined;
      await sendMessage(user.uid, story.authorId, reply.trim(), media);
      setReply("");
      setReplySent(true);
      setTimeout(() => setReplySent(false), 2000);
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  };

  const next = () => {
    if (!group) return;
    if (si < group.stories.length - 1) {
      setSi(si + 1);
    } else if (gi < groups.length - 1) {
      setGi(gi + 1);
      setSi(0);
    } else {
      onClose();
    }
  };

  const prev = () => {
    if (si > 0) {
      setSi(si - 1);
    } else if (gi > 0) {
      const pg = groups[gi - 1];
      setGi(gi - 1);
      setSi(Math.max(0, (pg?.stories.length ?? 1) - 1));
    }
  };

  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;

  // Pause playback while the options sheet is open (like Facebook).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (menuOpen || reactorsOpen) v.pause();
    else v.play().catch(() => {});
  }, [menuOpen, reactorsOpen]);


  useEffect(() => {
    if (!story) return;
    onStoryViewed(story.id);
    setProgress(0);
    if (story.mediaType === "video") {
      const v = videoRef.current;
      v?.play().catch(() => {});
      return;
    }
    let last = Date.now();
    let elapsed = 0;
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = now - last;
      last = now;
      if (menuOpenRef.current || reactorsOpenRef.current) return;
      elapsed += delta;
      const p = elapsed / STORY_DURATION;
      if (p >= 1) {
        clearInterval(timer);
        next();
      } else {
        setProgress(p);
      }
    }, 50);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gi, si, story?.id]);


  if (!group || !story) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex items-center justify-center">
      <div className="relative w-full max-w-md h-full sm:h-[90vh] bg-black sm:rounded-2xl overflow-hidden">
        {/* progress bars */}
        <div className="absolute top-3 left-3 right-3 z-20 flex gap-1">
          {group.stories.map((s, i) => (
            <div key={s.id} className="flex-1 h-0.5 rounded bg-white/30 overflow-hidden">
              <div
                className="h-full bg-white"
                style={{
                  width: i < si ? "100%" : i === si ? `${progress * 100}%` : "0%",
                }}
              />
            </div>
          ))}
        </div>

        {/* header */}
        <div className="absolute top-6 left-3 right-3 z-20 flex items-center gap-2">
          <Avatar src={group.authorPhoto} alt={group.authorName} size={32} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {group.authorName}
            </p>
            <p className="text-[11px] text-white/70">{timeAgo(story.createdAt)}</p>
          </div>
          <button
            onClick={() => { setMenuNote(""); setMenuOpen(true); }}
            aria-label="Story options"
            className="text-white/90 p-1"
          >
            <MoreVertical size={22} />
          </button>
          <button
            onClick={onClose}
            aria-label="Close stories"
            className="text-white/90 p-1"
          >
            <X size={24} />
          </button>
        </div>

        {/* Facebook-style story options sheet */}
        {menuOpen && (
          <div
            className="absolute inset-0 z-40 bg-black/50 flex items-end"
            onClick={() => setMenuOpen(false)}
          >
            <div
              className="w-full bg-white rounded-t-3xl p-2 pb-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto my-2 h-1 w-10 rounded-full bg-gray-300" />
              {menuNote && (
                <p className="px-4 py-2 text-sm text-sky-600">{menuNote}</p>
              )}
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secureUrl(story.mediaUrl));
                    setMenuNote("Link copied");
                  } catch {
                    setMenuNote("Could not copy link");
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-gray-900 active:bg-gray-50 rounded-2xl"
              >
                <Link2 size={20} />
                <span className="text-sm font-medium">Copy link</span>
              </button>
              <a
                href={secureUrl(story.mediaUrl)}
                target="_blank"
                rel="noreferrer"
                download
                className="w-full flex items-center gap-3 px-4 py-3 text-gray-900 active:bg-gray-50 rounded-2xl"
              >
                <Download size={20} />
                <span className="text-sm font-medium">
                  Save {story.mediaType === "video" ? "video" : "photo"}
                </span>
              </a>
              {user?.uid === story.authorId ? (
                <button
                  onClick={async () => {
                    try {
                      await deleteDoc(doc(db, "stories", story.id));
                      setMenuOpen(false);
                      next();
                    } catch {
                      setMenuNote("Could not delete story");
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-600 active:bg-red-50 rounded-2xl"
                >
                  <Trash2 size={20} />
                  <span className="text-sm font-medium">Delete story</span>
                </button>
              ) : (
                <button
                  onClick={() => setMenuNote("Thanks, we received your report")}
                  className="w-full flex items-center gap-3 px-4 py-3 text-gray-900 active:bg-gray-50 rounded-2xl"
                >
                  <Flag size={20} />
                  <span className="text-sm font-medium">Report story</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Who reacted sheet */}
        {reactorsOpen && (
          <div
            className="absolute inset-0 z-40 bg-black/50 flex items-end"
            onClick={() => setReactorsOpen(false)}
          >
            <div
              className="w-full max-h-[60%] overflow-y-auto bg-white rounded-t-3xl p-2 pb-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto my-2 h-1 w-10 rounded-full bg-gray-300" />
              <p className="px-4 pb-2 text-sm font-semibold text-gray-900">
                Reactions ({totalReactions})
              </p>
              {reactorsLoading ? (
                <div className="flex justify-center py-6 text-gray-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : reactors.length === 0 ? (
                <p className="px-4 py-4 text-sm text-gray-500">No reactions yet</p>
              ) : (
                reactors.map((r) => (
                  <div
                    key={r.uid}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <Avatar src={r.photo} alt={r.name} size={36} />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                      {r.name}
                    </span>
                    <span className="text-lg">{reactionGlyph(r.emoji)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}




        {/* media */}
        {story.mediaType === "video" ? (
          <video
            ref={videoRef}
            src={secureUrl(story.mediaUrl)}
            className="w-full h-full object-contain"
            playsInline
            onEnded={next}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress(v.currentTime / v.duration);
            }}
          />
        ) : (
          <img
            src={secureUrl(story.mediaUrl)}
            alt={`${group.authorName}'s story`}
            className="w-full h-full object-contain"
          />
        )}

        {/* tap zones */}
        <button
          aria-label="Previous story"
          onClick={prev}
          className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
        />
        <button
          aria-label="Next story"
          onClick={next}
          className="absolute right-0 top-0 bottom-0 w-2/3 z-10"
        />

        {/* top & bottom gradients (Instagram-style readability) */}
        <div className="absolute top-0 left-0 right-0 h-28 z-10 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-32 z-10 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

        {/* reactions + reply bar */}
        <div className="absolute bottom-3 left-3 right-3 z-20 space-y-2">
          {reactionCounts.length > 0 && (
            <button
              onClick={() => {
                if (user?.uid === story.authorId) setReactorsOpen(true);
              }}
              aria-label={
                user?.uid === story.authorId ? "See who reacted" : "Reactions"
              }
              className="flex gap-1.5 flex-wrap items-center text-left"
            >
              {reactionCounts.map(([emoji, count]) => (
                <span
                  key={emoji}
                  className="bg-white/20 backdrop-blur rounded-full px-2 py-0.5 text-base text-white flex items-center gap-1"
                >
                  {reactionGlyph(emoji)}
                  <span className="text-xs font-semibold">{count}</span>
                </span>
              ))}
              {user?.uid === story.authorId && (
                <span className="text-[11px] text-white/70 ml-1 underline">
                  {totalReactions} reaction{totalReactions === 1 ? "" : "s"}
                </span>
              )}
            </button>
          )}


          {showReactions && (
            <div className="flex items-center justify-between bg-white/10 backdrop-blur rounded-full px-3 py-1.5">
              {REACTION_EMOJIS.map((emoji) => {
                const mine = myReaction === emoji;
                return (
                  <button
                    key={emoji}
                    aria-label={mine ? `Remove ${emoji} reaction` : `React ${emoji}`}
                    onClick={() => {
                      if (!user) return;
                      reactToStory(story.id, user.uid, emoji, myReaction).catch(
                        () => {},
                      );
                    }}
                    className={`text-2xl leading-none transition-transform active:scale-125 ${
                      mine ? "scale-125 drop-shadow" : "opacity-80"
                    }`}
                  >
                    {reactionGlyph(emoji)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Instagram-style bar: message pill + quick actions */}
          <div className="flex items-center gap-3">
            {user && user.uid !== story.authorId ? (
              <>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendReply();
                  }}
                  placeholder="Add a comment..."
                  className="flex-1 min-w-0 h-11 px-4 rounded-full bg-transparent border border-white/60 text-sm text-white placeholder-white/80 outline-none focus:border-white"
                />
                <button
                  onClick={() => {
                    if (!user) return;
                    reactToStory(story.id, user.uid, "Love", myReaction).catch(
                      () => {},
                    );
                  }}
                  aria-label={myReaction === "Love" ? "Remove like" : "Like story"}
                  className="text-white active:scale-90 transition-transform"
                >
                  <Heart
                    size={24}
                    fill={myReaction === "Love" ? "currentColor" : "none"}
                  />
                </button>
                <button
                  onClick={() => setShowReactions((v) => !v)}
                  aria-label="More reactions"
                  className="text-white active:scale-90 transition-transform"
                >
                  <SmilePlus size={24} />
                </button>
                <button
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  aria-label="Send reply"
                  className="text-white disabled:opacity-40 active:scale-90 transition-transform"
                >
                  {sending ? (
                    <Loader2 size={22} className="animate-spin" />
                  ) : (
                    <Send size={22} />
                  )}
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowReactions((v) => !v)}
                aria-label="Reactions"
                className="ml-auto text-white active:scale-90 transition-transform"
              >
                <SmilePlus size={24} />
              </button>
            )}
          </div>
          {replySent && (
            <p className="text-[11px] text-white/80 text-center">Comment sent ✓</p>
          )}
        </div>

      </div>
    </div>
  );
}

export function StoriesBar() {
  const { user, ensureUserProfile } = useAuth();
  const { stories, loading } = useStories();
  const [adding, setAdding] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteView, setNoteView] = useState<UserNote | null>(null);

  useEffect(() => subscribeNotes(setNotes), []);


  // Seen status is stored on the user profile in Firestore so it stays
  // correct across devices; localStorage is only an instant local cache.
  useEffect(() => {
    setViewedIds(new Set(readViewedIds()));
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (!snap.exists()) return;
      const ids = (snap.data()["viewedStoryIds"] as string[] | undefined) ?? [];
      setViewedIds((prev) => {
        const merged = new Set(prev);
        ids.forEach((id) => merged.add(id));
        return merged;
      });
    });
  }, [user]);

  const markViewed = (storyId: string) => {
    setViewedIds((prev) => {
      if (prev.has(storyId)) return prev;
      const nextSet = new Set(prev);
      nextSet.add(storyId);
      try {
        localStorage.setItem(
          VIEWED_KEY,
          JSON.stringify([...readViewedIds(), storyId].slice(-500)),
        );
      } catch {
        /* ignore */
      }
      return nextSet;
    });
    if (user) {
      setDoc(
        doc(db, "users", user.uid),
        { viewedStoryIds: arrayUnion(storyId) },
        { merge: true },
      ).catch(() => {});
    }
  };


  const groups = useMemo<StoryGroup[]>(() => {
    const map = new Map<string, StoryGroup>();
    for (const s of stories) {
      const g = map.get(s.authorId);
      if (g) {
        g.stories.push(s);
      } else {
        map.set(s.authorId, {
          authorId: s.authorId,
          authorName: s.authorName,
          authorPhoto: s.authorPhoto,
          stories: [s],
        });
      }
    }
    // oldest first inside each group so viewing starts at the first story
    const arr = [...map.values()];
    arr.forEach((g) => g.stories.sort((a, b) => a.createdAt - b.createdAt));
    return arr;
  }, [stories]);

  const myNote = notes.find((n) => n.uid === user?.uid) ?? null;
  const noteFor = (uid: string) => notes.find((n) => n.uid === uid) ?? null;
  const noteOnly = notes.filter(
    (n) => n.uid !== user?.uid && !groups.some((g) => g.authorId === n.uid),
  );

  return (
    <>
      <div className="flex gap-3 overflow-x-auto px-4 py-3 border-b border-gray-100">
        {/* your story */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <button
            onClick={() => {
              setNoteDraft(myNote?.text ?? "");
              setNoteOpen(true);
            }}
            className="max-w-[92px] rounded-2xl rounded-bl-sm bg-gray-100 px-2.5 py-1 text-[10px] leading-tight text-gray-600 line-clamp-2 text-left"
          >
            {myNote?.text || "Post a note..."}
          </button>
          <button
            onClick={() => setAdding(true)}
            className="flex flex-col items-center gap-1"
          >
            <div className="relative">
              <div className="p-[2px] rounded-full bg-gray-200">
                <Avatar
                  src={user?.photoURL ?? ""}
                  alt="Your story"
                  size={56}
                  className="ring-2 ring-white"
                />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-sky-500 border-2 border-white flex items-center justify-center text-white">
                <Plus size={12} strokeWidth={3} />
              </div>
            </div>
            <span className="text-[11px] text-gray-600 w-16 truncate text-center">
              Your story
            </span>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center px-4">
            <Loader2 size={18} className="animate-spin text-sky-400" />
          </div>
        ) : (
          groups.map((g, i) => {
            const hasUnviewed = g.stories.some((s) => !viewedIds.has(s.id));
            const note = noteFor(g.authorId);
            return (
              <div
                key={g.authorId}
                className="flex flex-col items-center gap-1 shrink-0"
              >
                {note && g.authorId !== user?.uid ? (
                  <button
                    onClick={() => setNoteView(note)}
                    className="max-w-[92px] rounded-2xl rounded-bl-sm bg-gray-100 px-2.5 py-1 text-[10px] leading-tight text-gray-600 line-clamp-2 text-left"
                  >
                    {note.text}
                  </button>
                ) : (
                  <span className="h-[26px]" />
                )}
                <button
                  onClick={() => setViewer(i)}
                  className="flex flex-col items-center gap-1"
                >
                  <div
                    className={`p-[2px] rounded-full ${
                      hasUnviewed
                        ? "bg-gradient-to-tr from-sky-400 via-cyan-400 to-fuchsia-400"
                        : "bg-gray-300"
                    }`}
                  >
                    <Avatar
                      src={g.authorPhoto}
                      alt={`${g.authorName}'s story`}
                      size={56}
                      className="ring-2 ring-white"
                    />
                  </div>
                  <span className="text-[11px] text-gray-600 w-16 truncate text-center">
                    {g.authorId === user?.uid ? "You" : g.authorName}
                  </span>
                </button>
              </div>
            );
          })
        )}

        {noteOnly.map((n) => (
          <div key={n.uid} className="flex flex-col items-center gap-1 shrink-0">
            <button
              onClick={() => setNoteView(n)}
              className="max-w-[92px] rounded-2xl rounded-bl-sm bg-gray-100 px-2.5 py-1 text-[10px] leading-tight text-gray-600 line-clamp-2 text-left"
            >
              {n.text}
            </button>
            <button
              onClick={() => setNoteView(n)}
              className="flex flex-col items-center gap-1"
            >
              <div className="p-[2px] rounded-full bg-gray-200">
                <Avatar
                  src={n.authorPhoto}
                  alt={n.authorName}
                  size={56}
                  className="ring-2 ring-white"
                />
              </div>
              <span className="text-[11px] text-gray-600 w-16 truncate text-center">
                {n.authorName}
              </span>
            </button>
          </div>
        ))}
      </div>

      {noteOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
          <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">New note</h2>
              <button
                onClick={() => setNoteOpen(false)}
                className="text-gray-400"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Share what's on your mind — it disappears after 24 hours.
            </p>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value.slice(0, NOTE_MAX))}
              rows={3}
              autoFocus
              placeholder="Post a note..."
              className="w-full rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-800 outline-none"
            />
            <div className="mt-1 text-right text-[11px] text-gray-400">
              {noteDraft.length}/{NOTE_MAX}
            </div>
            <div className="mt-3 flex gap-2">
              {myNote && (
                <button
                  onClick={async () => {
                    if (!user) return;
                    setNoteBusy(true);
                    try {
                      await deleteNote(user.uid);
                      setNoteOpen(false);
                    } finally {
                      setNoteBusy(false);
                    }
                  }}
                  disabled={noteBusy}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-red-500 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
              <button
                onClick={async () => {
                  if (!user || !noteDraft.trim()) return;
                  setNoteBusy(true);
                  try {
                    const profile = await ensureUserProfile();
                    await saveNote(
                      profile.uid,
                      noteDraft,
                      profile.displayName,
                      profile.photoURL,
                    );
                    setNoteOpen(false);
                  } finally {
                    setNoteBusy(false);
                  }
                }}
                disabled={noteBusy || !noteDraft.trim()}
                className="flex-1 rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {noteBusy ? "Sharing..." : "Share"}
              </button>
            </div>
          </div>
        </div>
      )}

      {noteView && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center px-6"
          onClick={() => setNoteView(null)}
        >
          <div
            className="w-full max-w-xs rounded-3xl bg-white p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Avatar
              src={noteView.authorPhoto}
              alt={noteView.authorName}
              size={56}
              className="mx-auto"
            />
            <p className="mt-3 text-sm font-semibold text-gray-900">
              {noteView.authorName}
            </p>
            <p className="mt-2 rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-700">
              {noteView.text}
            </p>
            <p className="mt-2 text-[11px] text-gray-400">
              {timeAgo(noteView.createdAt)} ago
            </p>
          </div>
        </div>
      )}

      {adding && <AddStoryModal onClose={() => setAdding(false)} />}
      {viewer !== null && (
        <StoryViewer
          groups={groups}
          startGroup={viewer}
          onClose={() => setViewer(null)}
          onStoryViewed={markViewed}
        />
      )}
    </>
  );
}
