import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { Check, Copy, Download, Eye, Heart, Loader2, MessageCircle, MoreHorizontal, Music2, Pause, Play, RotateCcw, RotateCw, Search, Send, Trash2, Volume2, VolumeX } from "lucide-react";
import { arrayRemove, arrayUnion, deleteDoc, doc, getDoc, increment, onSnapshot, updateDoc } from "firebase/firestore";
import { db, secureUrl } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { formatViews, registerView } from "./views";
import { useAuth } from "./AuthContext";
import { useReels } from "./usePosts";
import { TagFilterBar, collectTags, filterByTag } from "./TagFilterBar";
import { CommentItem } from "./PostCard";
import { fetchProfile, sendMessage } from "./chat";
import { timeAgo } from "../../lib/time";
import type { Comment, Post, UserProfile } from "./types";

function Reel({
  post,
  muted,
  onToggleMute,
  onOpenProfile,
}: {
  post: Post;
  muted: boolean;
  onToggleMute: () => void;
  onOpenProfile: (uid: string) => void;
}) {
  const { user, profile } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState(false);
  const [heartBurst, setHeartBurst] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareTargets, setShareTargets] = useState<UserProfile[]>([]);
  const [shareTerm, setShareTerm] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareCount, setShareCount] = useState(() => {
    // Offline fallback: start from the last known cached value if available
    try {
      const cached = window.localStorage.getItem(`fly-share-count-${post.id}`);
      if (cached != null) {
        const n = Number(cached);
        if (!Number.isNaN(n)) return n;
      }
    } catch {
      /* ignore */
    }
    return post.shares ?? 0;
  });
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLong = duration > 15;

  const fmtTime = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const revealControls = () => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 2500);
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
    revealControls();
  };

  const seekBy = (delta: number) => {
    const el = videoRef.current;
    if (!el) return;
    const d = el.duration || 0;
    el.currentTime = Math.min(Math.max(el.currentTime + delta, 0), d || el.currentTime);
    revealControls();
  };

  const onScrub = (e: ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Number(e.target.value);
    setCurrentTime(Number(e.target.value));
    revealControls();
  };

  const liked = !!user && post.likes.includes(user.uid);
  const ref = doc(db, "posts", post.id);
  const media = secureUrl(post.mediaUrl);

  const applyShareCount = (n: number) => {
    setShareCount(n);
    try {
      window.localStorage.setItem(`fly-share-count-${post.id}`, String(n));
    } catch {
      /* ignore */
    }
  };

  const loadCachedShareCount = () => {
    try {
      const cached = window.localStorage.getItem(`fly-share-count-${post.id}`);
      if (cached != null) {
        const n = Number(cached);
        if (!Number.isNaN(n)) setShareCount(n);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    setShareCount(post.shares ?? 0);
  }, [post.shares]);

  // Realtime listener: keeps share count in sync across all devices instantly;
  // falls back to the last known cached value when Firestore is unavailable
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "posts", post.id),
      (snap) => {
        if (snap.exists()) {
          applyShareCount((snap.data() as { shares?: number }).shares ?? 0);
        }
      },
      () => {
        loadCachedShareCount();
      },
    );
    return () => unsub();
  }, [post.id]);

  const refreshShareCount = async () => {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        applyShareCount((snap.data() as { shares?: number }).shares ?? 0);
      }
    } catch {
      // Firestore unreachable — show the last known cached value
      loadCachedShareCount();
    }
  };

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.isIntersecting && entry.intersectionRatio > 0.6) {
          el.play().catch(() => {});
          registerView(post.id);
        } else {
          el.pause();
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [post.id]);

  const toggleLike = async () => {
    if (!user) return;
    await updateDoc(ref, {
      likes: liked ? arrayRemove(user.uid) : arrayUnion(user.uid),
    });
  };

  const likeFromDoubleTap = () => {
    setHeartBurst(true);
    setTimeout(() => setHeartBurst(false), 800);
    if (user && !liked) {
      updateDoc(ref, { likes: arrayUnion(user.uid) }).catch(() => {});
    }
  };

  const handleVideoTap = (e: MouseEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      likeFromDoubleTap();
      return;
    }
    lastTapRef.current = now;
    tapTimerRef.current = setTimeout(() => {
      if (el.paused) el.play().catch(() => {});
      else el.pause();
      revealControls();
    }, 260);
  };

  const addComment = async () => {
    if (!user || !profile || !commentText.trim()) return;
    setBusy(true);
    const comment: Comment = {
      id: `${Date.now()}-${user.uid}`,
      authorId: user.uid,
      authorName: profile.displayName,
      authorPhoto: profile.photoURL,
      text: commentText.trim(),
      createdAt: Date.now(),
      likes: [],
      replies: [],
    };
    try {
      await updateDoc(ref, { comments: arrayUnion(comment) });
      setCommentText("");
    } finally {
      setBusy(false);
    }
  };

  const reelUrl = () => `${window.location.origin}/?post=${post.id}`;

  const share = async () => {
    setShowShare(true);
    setSentTo(new Set());
    if (!user || !profile) return;
    setShareLoading(true);
    try {
      const ids = Array.from(new Set([...profile.following, ...profile.followers])).filter(
        (id) => id !== user.uid,
      );
      const profiles = await Promise.all(ids.map((id) => fetchProfile(id)));
      setShareTargets(profiles.filter((p): p is UserProfile => !!p));
    } finally {
      setShareLoading(false);
    }
  };

  const sendToFriend = async (target: UserProfile) => {
    if (!user || sentTo.has(target.uid)) return;
    const url = reelUrl();
    updateDoc(ref, { shares: increment(1) })
      .catch(() => {})
      .then(() => refreshShareCount());
    await sendMessage(
      user.uid,
      target.uid,
      `Reel: ${post.text ? `${post.text.slice(0, 80)} ` : ""}${url}`,
      { url: secureUrl(post.mediaUrl), type: "video" },
      "text",
      post.id,
    ).catch(() => {});
    setSentTo((s) => new Set(s).add(target.uid));
    refreshShareCount();
  };

  const copyLink = async () => {
    const url = reelUrl();
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    updateDoc(ref, { shares: increment(1) })
      .catch(() => {})
      .then(() => refreshShareCount());
  };

  const saveVideo = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(media);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fly-reel-${post.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setShowMore(false);
    } catch {
      // Fallback: open the video in a new tab so the user can save it manually
      window.open(media, "_blank");
    } finally {
      setSaving(false);
    }
  };

  const deleteReel = async () => {
    if (!user || user.uid !== post.authorId || deleting) return;
    setDeleting(true);
    try {
      await deleteDoc(ref);
      setShowMore(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="relative h-full w-full snap-start snap-always bg-black overflow-hidden">
      <video
        ref={videoRef}
        src={media}
        loop
        playsInline
        muted={muted}
        onClick={handleVideoTap}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        className="absolute inset-0 h-full w-full object-contain"
      />

      {/* Player controls: center play/pause (+ 10s skip for videos longer than 15s) */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-8 transition-opacity duration-200 ${
          showControls || paused ? "opacity-100" : "opacity-0"
        }`}
      >
        {isLong && (
          <button
            onClick={() => seekBy(-10)}
            aria-label="Rewind 10 seconds"
            className="pointer-events-auto w-12 h-12 rounded-full bg-black/55 text-white flex items-center justify-center active:scale-90 transition-transform"
          >
            <RotateCcw size={22} />
          </button>
        )}
        <button
          onClick={togglePlay}
          aria-label={paused ? "Play" : "Pause"}
          className="pointer-events-auto w-16 h-16 rounded-full bg-black/55 text-white flex items-center justify-center active:scale-90 transition-transform"
        >
          {paused ? (
            <Play size={28} className="fill-white ml-0.5" />
          ) : (
            <Pause size={28} className="fill-white" />
          )}
        </button>
        {isLong && (
          <button
            onClick={() => seekBy(10)}
            aria-label="Forward 10 seconds"
            className="pointer-events-auto w-12 h-12 rounded-full bg-black/55 text-white flex items-center justify-center active:scale-90 transition-transform"
          >
            <RotateCw size={22} />
          </button>
        )}
      </div>

      {/* Time, mute and scrub bar */}
      <div className="absolute left-0 right-0 bottom-0 z-10 px-3 pb-2">
        <div className="flex items-center gap-3 text-white">
          <span className="text-xs font-medium tabular-nums">
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
          <button
            onClick={onToggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="ml-auto w-8 h-8 flex items-center justify-center active:scale-90 transition-transform"
          >
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <button
            onClick={() => setShowMore(true)}
            aria-label="More options"
            className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={onScrub}
          aria-label="Seek"
          className="mt-1 w-full h-1.5 appearance-none rounded-full bg-white/30 accent-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
      </div>


      {heartBurst && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Heart
            size={96}
            className="text-rose-500 fill-rose-500 drop-shadow-lg animate-in zoom-in fade-in duration-300"
          />
        </div>
      )}

      <div className="absolute right-3 bottom-28 flex flex-col items-center gap-6 text-white">
        <button onClick={toggleLike} className="flex flex-col items-center gap-1 active:scale-90 transition-transform">
          <Heart size={30} className={liked ? "text-rose-500 fill-rose-500" : ""} />
          <span className="text-xs font-medium">{formatViews(post.likes.length)}</span>
        </button>
        <button
          onClick={() => setShowComments(true)}
          className="flex flex-col items-center gap-1 active:scale-90 transition-transform"
        >
          <MessageCircle size={29} />
          <span className="text-xs font-medium">{formatViews(post.comments.length)}</span>
        </button>
        <button onClick={share} className="flex flex-col items-center gap-1 active:scale-90 transition-transform">
          <Send size={27} />
          <span className="text-xs font-medium">{formatViews(shareCount)}</span>
        </button>
        <div className="flex flex-col items-center gap-1">
          <Eye size={27} />
          <span className="text-xs font-medium">{formatViews(post.views ?? 0)}</span>
        </div>
        <button
          onClick={() => setShowMore(true)}
          aria-label="More options"
          className="flex flex-col items-center gap-1 active:scale-90 transition-transform"
        >
          <MoreHorizontal size={28} />
        </button>
      </div>

      <div className="absolute left-0 right-16 bottom-20 px-4 text-white">
        <button
          onClick={() => onOpenProfile(post.authorId)}
          className="flex items-center gap-2"
        >
          <Avatar src={post.authorPhoto} alt={post.authorName} size={36} />
          <span className="text-sm font-semibold">{post.authorName}</span>
          <span className="text-xs text-white/70">@{post.authorUsername}</span>
          <span className="text-xs text-white/60">· {timeAgo(post.createdAt)}</span>

        </button>
        {post.text && (
          <p className="mt-2 text-sm text-white/90 line-clamp-3 whitespace-pre-wrap break-words">
            {post.text}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 text-white/80">
          <Music2 size={14} className="shrink-0" />
          <div className="overflow-hidden max-w-[220px]">
            <p className="text-xs whitespace-nowrap animate-[marquee_8s_linear_infinite]">
              Original audio · {post.authorName} · @{post.authorUsername}
            </p>
          </div>
        </div>
      </div>

      {showComments && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end">
          <button
            className="flex-1 bg-black/40"
            aria-label="Close comments"
            onClick={() => setShowComments(false)}
          />
          <div className="bg-white rounded-t-3xl max-h-[65%] flex flex-col">
            <div className="h-1.5 w-10 bg-gray-200 rounded-full mx-auto my-3" />
            <div className="flex-1 overflow-y-auto px-4 space-y-3 pb-3">
              {post.comments.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-6">
                  No comments yet.
                </p>
              )}
              {post.comments
                .slice()
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((c) => (
                  <CommentItem
                    key={c.id}
                    comment={c}
                    postRef={ref}
                    comments={post.comments}
                    onOpenProfile={onOpenProfile}
                  />
                ))}
            </div>
            <div className="flex items-center gap-2 p-3 border-t border-gray-100">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 h-10 px-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
              />
              <button
                onClick={addComment}
                disabled={busy || !commentText.trim()}
                className="h-10 px-4 rounded-2xl bg-sky-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                Post
              </button>
            </div>
          </div>
        </div>
      )}

      {showShare && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end">
          <button
            className="flex-1 bg-black/40"
            aria-label="Close share"
            onClick={() => setShowShare(false)}
          />
          <div className="bg-white rounded-t-3xl max-h-[65%] flex flex-col">
            <div className="h-1.5 w-10 bg-gray-200 rounded-full mx-auto my-3" />
            <div className="px-4 pb-2 flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-800 shrink-0">Share reel to</p>
              <div className="ml-auto flex-1 max-w-[55%] h-9 px-3 rounded-full bg-gray-50 border border-gray-100 flex items-center gap-2">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input
                  value={shareTerm}
                  onChange={(e) => setShareTerm(e.target.value)}
                  placeholder="Search"
                  aria-label="Search friends"
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
              {shareLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="animate-spin text-sky-500" size={20} />
                </div>
              ) : shareTargets.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">
                  No friends yet. Follow someone to share reels with them.
                </p>
              ) : shareTargets.filter((t) =>
                  `${t.displayName} ${t.username}`
                    .toLowerCase()
                    .includes(shareTerm.trim().toLowerCase()),
                ).length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">No matches found.</p>
              ) : (
                shareTargets
                  .filter((t) =>
                    `${t.displayName} ${t.username}`
                      .toLowerCase()
                      .includes(shareTerm.trim().toLowerCase()),
                  )
                  .map((t) => (
                  <div key={t.uid} className="flex items-center gap-3 py-2">
                    <Avatar src={t.photoURL} alt={t.displayName} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{t.displayName}</p>
                      <p className="text-xs text-gray-400 truncate">@{t.username}</p>
                    </div>
                    <button
                      onClick={() => sendToFriend(t)}
                      disabled={sentTo.has(t.uid)}
                      className={`h-9 px-4 rounded-full text-sm font-semibold transition-colors ${
                        sentTo.has(t.uid)
                          ? "bg-gray-100 text-gray-400"
                          : "bg-sky-500 text-white active:scale-95"
                      }`}
                    >
                      {sentTo.has(t.uid) ? (
                        <span className="flex items-center gap-1">
                          <Check size={14} /> Sent
                        </span>
                      ) : (
                        "Send"
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-gray-100">
              <button
                onClick={copyLink}
                className="w-full h-11 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center gap-2 text-sm font-semibold text-gray-700 active:scale-[0.98]"
              >
                {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                {copied ? "Link copied!" : "Copy link"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showMore && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end">
          <button
            className="flex-1 bg-black/40"
            aria-label="Close options"
            onClick={() => setShowMore(false)}
          />
          <div className="bg-white rounded-t-3xl p-4 space-y-2">
            <div className="h-1.5 w-10 bg-gray-200 rounded-full mx-auto mb-2" />
            <button
              onClick={saveVideo}
              disabled={saving}
              className="w-full h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center gap-3 px-4 text-sm font-semibold text-gray-700 active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin text-sky-500" />
              ) : (
                <Download size={18} className="text-sky-500" />
              )}
              {saving ? "Saving..." : "Save video"}
            </button>
            {user?.uid === post.authorId && (
              <button
                onClick={deleteReel}
                disabled={deleting}
                className="w-full h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center gap-3 px-4 text-sm font-semibold text-red-600 active:scale-[0.98] disabled:opacity-50"
              >
                {deleting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Trash2 size={18} />
                )}
                {deleting ? "Deleting..." : "Delete video"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function ReelsPage({
  onOpenProfile,
  startPostId,
  onConsumedStart,
}: {
  onOpenProfile: (uid: string) => void;
  startPostId?: string | null;
  onConsumedStart?: () => void;
}) {
  const {
    reels: allReelsRaw,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    refresh,
    refreshing,
  } = useReels(10);
  const { profile } = useAuth();
  const [muted, setMuted] = useState(true);
  const [tag, setTag] = useState<string | null>(null);
  const [tab, setTab] = useState<"reels" | "friends">("reels");
  const feedRef = useRef<HTMLDivElement | null>(null);
  // Pull-to-refresh (Facebook-style): drag down at the top of the feed.
  const [pull, setPull] = useState(0);
  const pullStartRef = useRef<number | null>(null);


  const allReels = useMemo(
    () => allReelsRaw.filter((p) => secureUrl(p.mediaUrl)),
    [allReelsRaw],
  );
  const tabReels = useMemo(
    () =>
      tab === "friends" && profile
        ? allReels.filter((p) => profile.following.includes(p.authorId))
        : allReels,
    [allReels, tab, profile],
  );
  const tags = useMemo(() => collectTags(tabReels), [tabReels]);
  const reels = useMemo(() => filterByTag(tabReels, tag), [tabReels, tag]);

  // Jump to the reel that was clicked on the timeline.
  useEffect(() => {
    if (!startPostId) return;
    const idx = reels.findIndex((p) => p.id === startPostId);
    const el = feedRef.current;
    if (idx >= 0 && el) {
      el.scrollTo({ top: idx * el.clientHeight, behavior: "auto" });
      onConsumedStart?.();
    }
  }, [startPostId, reels, onConsumedStart]);

  // Keep fetching until enough reels are loaded for the current tab/tag filter,
  // so filtering never leaves the feed stuck on the first page.
  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    if (reels.length < 8) void loadMore();
  }, [reels.length, loading, loadingMore, hasMore, loadMore]);

  // Tapping the Reels tab again jumps back to the very first reel.
  useEffect(() => {
    const onTop = () => {
      feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("fly:reels-scroll-top", onTop);
    return () => window.removeEventListener("fly:reels-scroll-top", onTop);
  }, []);

  // Switching between Reels/Friends starts that tab's feed from the top again.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);



  // Infinite scroll: fetch the next batch when nearing the end of the feed.
  const handleFeedScroll = () => {
    const el = feedRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - el.clientHeight * 2) {
      void loadMore();
    }
  };

  const PULL_THRESHOLD = 70;

  const onTouchStart = (e: React.TouchEvent) => {
    const el = feedRef.current;
    if (!el || el.scrollTop > 2 || refreshing) return;
    pullStartRef.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = pullStartRef.current;
    const el = feedRef.current;
    if (start == null || !el) return;
    if (el.scrollTop > 2) {
      pullStartRef.current = null;
      setPull(0);
      return;
    }
    const delta = (e.touches[0]?.clientY ?? start) - start;
    if (delta > 0) setPull(Math.min(delta * 0.5, 100));
  };

  const onTouchEnd = () => {
    if (pullStartRef.current != null && pull >= PULL_THRESHOLD) {
      void refresh().then(() => {
        feedRef.current?.scrollTo({ top: 0, behavior: "auto" });
      });
    }
    pullStartRef.current = null;
    setPull(0);
  };




  return (
    <div className="fixed inset-0 mx-auto w-full max-w-md bg-black">
      <header className="absolute top-0 left-0 right-0 h-14 flex items-center justify-center gap-6 px-5 z-10 bg-gradient-to-b from-black/60 to-transparent">
        <button
          onClick={() => setTab("reels")}
          className={`text-xl transition-colors ${tab === "reels" ? "font-bold text-white" : "font-semibold text-white/50"}`}
        >
          Reels
        </button>
        <button
          onClick={() => setTab("friends")}
          className={`text-xl transition-colors ${tab === "friends" ? "font-bold text-white" : "font-semibold text-white/50"}`}
        >
          Friends
        </button>
      </header>

      <div className="absolute top-14 left-0 right-0 z-10">
        <TagFilterBar tags={tags} active={tag} onChange={setTag} dark />
      </div>

      {(pull > 0 || refreshing) && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-24 z-20 flex justify-center"
          style={{ transform: `translateY(${refreshing ? 0 : Math.min(pull, 60) - 20}px)` }}
        >
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center">
            <Loader2
              size={20}
              className={`text-sky-400 ${refreshing ? "animate-spin" : ""}`}
              style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
            />
          </div>
        </div>
      )}


      {loading ? (
        <div className="h-full flex items-center justify-center">
          <Loader2 className="animate-spin text-sky-400" />
        </div>
      ) : reels.length === 0 ? (
        <p className="h-full flex items-center justify-center text-sm text-white/60 px-8 text-center">
          {tag ? `No reels tagged #${tag}.` : "No reels yet. Post a video to see it here!"}
        </p>
      ) : (
        <div
          key={tab}
          ref={feedRef}

          onScroll={handleFeedScroll}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          className="h-full overflow-y-auto snap-y snap-mandatory scroll-smooth pb-16"
        >

          {reels.map((p) => (
            <div key={p.id} className="h-[calc(100dvh-4rem)]">
              <Reel
                post={p}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                onOpenProfile={onOpenProfile}
              />
            </div>
          ))}
          {loadingMore && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="animate-spin text-sky-400" size={22} />
            </div>
          )}
          {!hasMore && !loadingMore && reels.length > 0 && (
            <p className="py-6 text-center text-xs text-white/40">
              You're all caught up
            </p>
          )}
        </div>
      )}
    </div>
  );
}
