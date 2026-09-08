import { useEffect, useRef, useState } from "react";
import { Eye,
  Check,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db, secureUrl } from "../../lib/firebase";
import { timeAgo } from "../../lib/time";
import { Avatar } from "./Avatar";
import { formatViews, registerView } from "./views";
import { useAuth } from "./AuthContext";
import type { Comment, Post } from "./types";
import { ShareSheet } from "./ShareSheet";
import { getPostBackground } from "./postBackgrounds";
import { AutoPlayVideo } from "./AutoPlayVideo";
import { ImageLightbox } from "./ImageLightbox";

export function CommentItem({
  comment,
  postRef,
  comments,
  onOpenProfile,
}: {
  comment: Comment;
  postRef: ReturnType<typeof doc>;
  comments: Comment[];
  onOpenProfile: (uid: string) => void;
}) {
  const { user, profile } = useAuth();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  const likes = comment.likes ?? [];
  const replies = comment.replies ?? [];
  const liked = !!user && likes.includes(user.uid);

  const saveComments = (next: Comment[]) =>
    updateDoc(postRef, { comments: next });

  const toggleLike = async () => {
    if (!user) return;
    const next = comments.map((c) => {
      if (c.id !== comment.id) return c;
      const cLikes = c.likes ?? [];
      return {
        ...c,
        likes: liked
          ? cLikes.filter((id) => id !== user.uid)
          : [...cLikes, user.uid],
      };
    });
    await saveComments(next);
  };

  const addReply = async () => {
    if (!user || !profile || !replyText.trim()) return;
    setBusy(true);
    const reply: Comment = {
      id: `${Date.now()}-${user.uid}`,
      authorId: user.uid,
      authorName: profile.displayName,
      authorPhoto: profile.photoURL,
      text: replyText.trim(),
      createdAt: Date.now(),
      likes: [],
      replies: [],
    };
    try {
      const next = comments.map((c) =>
        c.id === comment.id
          ? { ...c, replies: [...(c.replies ?? []), reply] }
          : c,
      );
      await saveComments(next);
      setReplyText("");
      setReplyOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <button onClick={() => onOpenProfile(comment.authorId)}>
          <Avatar src={comment.authorPhoto} alt={comment.authorName} size={28} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="bg-gray-50 rounded-2xl px-3 py-2">
            <p className="text-xs font-semibold text-gray-800">
              {comment.authorName}
            </p>
            <p className="text-sm text-gray-700 break-words">{comment.text}</p>
          </div>
          <div className="flex items-center gap-4 mt-1 px-2 text-xs text-gray-400">
            <span>{timeAgo(comment.createdAt)}</span>
            <button
              onClick={toggleLike}
              className={`flex items-center gap-1 font-semibold ${
                liked ? "text-rose-500" : "hover:text-gray-600"
              }`}
            >
              <Heart
                size={12}
                className={liked ? "fill-rose-500 text-rose-500" : ""}
              />
              {likes.length > 0 ? likes.length : "Like"}
            </button>
            <button
              onClick={() => setReplyOpen((v) => !v)}
              className="font-semibold hover:text-gray-600"
            >
              Reply
            </button>
          </div>

          {replies.length > 0 && (
            <div className="mt-2 space-y-2 pl-2 border-l-2 border-gray-100">
              {replies
                .slice()
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((r) => (
                  <div key={r.id} className="flex items-start gap-2">
                    <button onClick={() => onOpenProfile(r.authorId)}>
                      <Avatar src={r.authorPhoto} alt={r.authorName} size={22} />
                    </button>
                    <div className="bg-gray-50 rounded-2xl px-3 py-1.5 flex-1">
                      <p className="text-[11px] font-semibold text-gray-800">
                        {r.authorName}
                      </p>
                      <p className="text-sm text-gray-700 break-words">
                        {r.text}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {replyOpen && (
            <div className="flex items-center gap-2 mt-2">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply to ${comment.authorName}...`}
                className="flex-1 h-9 px-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
              />
              <button
                onClick={addReply}
                disabled={busy || !replyText.trim()}
                className="h-9 px-3 rounded-2xl bg-sky-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                Reply
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PostCard({
  post,
  onOpenProfile,
  onOpenReels,
}: {
  post: Post;
  onOpenProfile: (uid: string) => void;
  onOpenReels?: (postId: string) => void;
}) {
  const { user, profile } = useAuth();
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.text);
  const [savingEdit, setSavingEdit] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const liked = !!user && post.likes.includes(user.uid);
  const isVideo = post.mediaType === "video" && !!secureUrl(post.mediaUrl);
  const ref = doc(db, "posts", post.id);


  const toggleLike = async () => {
    if (!user) return;
    await updateDoc(ref, {
      likes: liked ? arrayRemove(user.uid) : arrayUnion(user.uid),
    });
  };

  const saveEdit = async () => {
    if (!editText.trim() && !post.mediaUrl) return;
    setSavingEdit(true);
    try {
      await updateDoc(ref, { text: editText.trim() });
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
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

  const share = () => setShowShare(true);


  const media = secureUrl(post.mediaUrl);

  if (hidden) return null;


  return (
    <article className="bg-white border-b border-gray-100 px-4 py-4">
      <div className="flex items-start gap-3">
        <button onClick={() => onOpenProfile(post.authorId)}>
          <Avatar src={post.authorPhoto} alt={post.authorName} size={40} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm">
            <button
              onClick={() => onOpenProfile(post.authorId)}
              className="font-semibold text-gray-900 truncate"
            >
              {post.authorName}
            </button>
            <span className="text-gray-400 truncate">@{post.authorUsername}</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400 shrink-0">{timeAgo(post.createdAt)}</span>
            <span className="ml-auto flex items-center gap-1 shrink-0" ref={menuRef}>
              <span className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100"
                  aria-label="Post options"
                >
                  <MoreHorizontal size={20} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-9 z-30 w-44 rounded-xl bg-white shadow-xl border border-gray-100 py-1">
                    {user?.uid === post.authorId ? (
                      <>
                        <button
                          onClick={() => {
                            setEditText(post.text);
                            setEditing(true);
                            setMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Pencil size={16} /> Edit post
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            deleteDoc(ref);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-gray-50"
                        >
                          <Trash2 size={16} /> Delete post
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setHidden(true);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <X size={16} /> Hide post
                      </button>
                    )}
                  </div>
                )}
              </span>
              <button
                onClick={() => setHidden(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100"
                aria-label="Hide post"
              >
                <X size={19} />
              </button>
            </span>

          </div>

          {editing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-2xl bg-gray-50 border border-gray-100 text-[15px] text-gray-800 outline-none focus:border-sky-300 resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="h-8 px-4 rounded-full bg-sky-500 text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
                >
                  <Check size={13} /> Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="h-8 px-4 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold flex items-center gap-1"
                >
                  <X size={13} /> Cancel
                </button>
              </div>
            </div>
          ) : (
            post.text &&
            !isVideo &&
            (post.bgStyle && !post.mediaUrl ? (
              (() => {
                const bg = getPostBackground(post.bgStyle);
                return (
                  <div
                    className="mt-2 rounded-2xl min-h-44 flex items-center justify-center p-6"
                    style={{ background: bg.background }}
                  >
                    <p
                      className="text-xl font-bold text-center whitespace-pre-wrap break-words"
                      style={{ color: bg.textColor }}
                    >
                      {post.text}
                    </p>
                  </div>
                );
              })()
            ) : (
              <p className="text-[15px] text-gray-800 mt-1 whitespace-pre-wrap break-words">
                {post.text}
              </p>
            ))
          )}

          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {post.tags.map((t) => (
                <span
                  key={t}
                  className="text-[11px] font-medium text-sky-600 bg-sky-50 rounded-full px-2 py-0.5"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {media && (
            <div className="mt-3 rounded-2xl overflow-hidden bg-black aspect-[4/5] [&>div]:h-full">
              {post.mediaType === "video" ? (
                <AutoPlayVideo
                  src={media}
                  onFirstPlay={() => registerView(post.id)}
                  onVideoClick={() => onOpenReels?.(post.id)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <img
                  src={media}
                  alt="post media"
                  onClick={() => setLightbox(true)}
                  className="w-full h-full object-cover cursor-zoom-in"
                />
              )}
            </div>
          )}
          {isVideo ? (
            <div className="mt-2.5">
              <div className="flex items-center gap-5 text-gray-800">
                <button
                  onClick={toggleLike}
                  className="flex items-center gap-1.5 active:scale-90 transition-transform"
                  aria-label="Like"
                >
                  <Heart
                    size={24}
                    className={liked ? "text-rose-500 fill-rose-500" : ""}
                  />
                  <span className="text-sm font-semibold">
                    {formatViews(post.likes.length) || ""}
                  </span>
                </button>
                <button
                  onClick={() => setShowComments((v) => !v)}
                  className="flex items-center gap-1.5 active:scale-90 transition-transform"
                  aria-label="Comments"
                >
                  <MessageCircle size={23} />
                  <span className="text-sm font-semibold">
                    {formatViews(post.comments.length) || ""}
                  </span>
                </button>
                <button
                  onClick={share}
                  className="flex items-center gap-1.5 active:scale-90 transition-transform"
                  aria-label="Share"
                >
                  <Send size={22} />
                </button>
                <span className="ml-auto flex items-center gap-1.5 text-gray-400">
                  <Eye size={19} />
                  <span className="text-xs font-medium">
                    {formatViews(post.views ?? 0)}
                  </span>
                </span>
              </div>
              {post.text && (
                <p className="mt-2 text-sm text-gray-800 whitespace-pre-wrap break-words">
                  <button
                    onClick={() => onOpenProfile(post.authorId)}
                    className="font-semibold mr-1.5"
                  >
                    {post.authorUsername}
                  </button>
                  <span className={captionExpanded ? "" : "line-clamp-1 inline"}>
                    {post.text}
                  </span>
                  {!captionExpanded && post.text.length > 60 && (
                    <button
                      onClick={() => setCaptionExpanded(true)}
                      className="text-gray-400 ml-1"
                    >
                      more
                    </button>
                  )}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-400">{timeAgo(post.createdAt)}</p>
            </div>
          ) : (
          <div className="flex items-center gap-6 mt-3 text-gray-400">
            <button
              onClick={toggleLike}
              className="flex items-center gap-1.5 text-sm active:scale-90 transition-transform"
            >
              <Heart
                size={19}
                className={liked ? "text-rose-500 fill-rose-500" : ""}
              />
              <span className={liked ? "text-rose-500" : ""}>
                {post.likes.length || ""}
              </span>
            </button>
            <button
              onClick={() => setShowComments((v) => !v)}
              className="flex items-center gap-1.5 text-sm active:scale-90 transition-transform"
            >
              <MessageCircle size={19} />
              <span>{post.comments.length || ""}</span>
            </button>
            <button
              onClick={share}
              className="flex items-center gap-1.5 text-sm active:scale-90 transition-transform"
            >
              <Send size={18} />
            </button>
            {post.mediaType === "video" && (
              <span className="flex items-center gap-1.5 text-sm ml-auto">
                <Eye size={18} />
                <span>{formatViews(post.views ?? 0)} views</span>
              </span>
            )}
          </div>
          )}

          {showComments && (
            <div className="mt-3 space-y-3">
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
              <div className="flex items-center gap-2">
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
          )}
        </div>
      </div>
      {showShare && (
        <ShareSheet
          mediaUrl={media || ""}
          mediaType={post.mediaType}
          text={post.text}
          postId={post.id}
          onClose={() => setShowShare(false)}
        />
      )}
      {lightbox && media && !isVideo && (
        <ImageLightbox src={media} onClose={() => setLightbox(false)} />
      )}
    </article>
  );
}
