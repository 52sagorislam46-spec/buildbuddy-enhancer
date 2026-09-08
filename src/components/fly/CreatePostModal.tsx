import { useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, isVideoFile, uploadToCloudinary } from "../../lib/firebase";
import { useAuth } from "./AuthContext";
import { notifyUpload } from "../../lib/appNotifications";
import { POST_BACKGROUNDS, getPostBackground } from "./postBackgrounds";

export function CreatePostModal({ onClose }: { onClose: () => void }) {
  const { ensureUserProfile } = useAuth();
  const [text, setText] = useState("");
  const tags = "";
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bgId, setBgId] = useState<string | null>(null);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const bg = bgId && !file ? getPostBackground(bgId) : null;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : "");
    if (f) setBgId(null);
  };

  const submit = async () => {
    if (!text.trim() && !file) return;
    setBusy(true);
    setError("");
    try {
      const profile = await ensureUserProfile();
      let mediaUrl = "";
      let mediaType = "";
      if (file) {
        const uploaded = await uploadToCloudinary(file);
        mediaUrl = uploaded.url;
        mediaType = uploaded.resourceType || (isVideoFile(file) ? "video" : "image");
      }
      const isReel = mediaType === "video";
      await addDoc(collection(db, "posts"), {
        authorId: profile.uid,
        authorName: profile.displayName,
        authorUsername: profile.username,
        authorPhoto: profile.photoURL,
        text: text.trim(),
        mediaUrl,
        mediaType,
        bgStyle: bg && bg.id !== "plain" ? bg.id : "",
        likes: [],
        comments: [],
        tags: tags
          .split(/[,#\s]+/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 8),
        createdAt: serverTimestamp(),
      });
      void notifyUpload({
        type: isReel ? "reel" : "post",
        actorId: profile.uid,
        actorName: profile.displayName,
        actorPhoto: profile.photoURL,
        followers: profile.followers,
        text: text.trim(),
        mediaUrl: mediaType === "image" ? mediaUrl : "",
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish post");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">New post</h2>
          <button onClick={onClose} className="text-gray-400" aria-label="Close">
            <X size={22} />
          </button>
        </div>
        {bg ? (
          <div
            className="w-full rounded-2xl min-h-44 flex items-center justify-center p-4"
            style={{ background: bg.background }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="What's happening?"
              className="w-full bg-transparent text-center text-xl font-bold outline-none resize-none placeholder:opacity-70"
              style={{ color: bg.textColor }}
            />
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="What's happening?"
            className="w-full p-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 outline-none focus:border-sky-300 resize-none"
          />
        )}
        {!file && (
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => setShowBgPicker((v) => !v)}
              aria-label="Text background"
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold border shadow-sm shrink-0 ${
                showBgPicker || bgId
                  ? "bg-gradient-to-br from-sky-400 to-fuchsia-500 text-white border-transparent"
                  : "bg-white text-gray-700 border-gray-200"
              }`}
            >
              Aa
            </button>
            {showBgPicker && (
              <div className="flex items-center gap-2 overflow-x-auto flex-1 py-1">
                {POST_BACKGROUNDS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBgId(b.id === "plain" ? null : b.id)}
                    aria-label={b.label}
                    className={`w-8 h-8 rounded-lg shrink-0 border shadow-sm transition-transform active:scale-90 ${
                      (bgId ?? "plain") === b.id
                        ? "ring-2 ring-sky-500 ring-offset-1"
                        : "border-gray-200"
                    }`}
                    style={{ background: b.swatch }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {preview && (
          <div className="mt-3 rounded-2xl overflow-hidden bg-gray-100 max-h-60">
            {file && isVideoFile(file) ? (
              <video src={preview} controls className="w-full max-h-60" />
            ) : (
              <img src={preview} alt="preview" className="w-full object-cover" />
            )}
          </div>
        )}
        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2 mt-3">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between mt-4">
          <label className="flex items-center gap-2 text-sky-500 font-medium cursor-pointer">
            <ImagePlus size={20} />
            <span className="text-sm">Photo / Video</span>
            <input
              type="file"
              accept="image/*,video/*"
              onChange={pick}
              className="hidden"
            />
          </label>
          <button
            onClick={submit}
            disabled={busy || (!text.trim() && !file)}
            className="h-10 px-6 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
