import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CirclePlus,
  Copy,
  Download,
  Images,
  Info,
  Link2,
  Loader2,
  MessageCircle,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Send,
  Share2,
  UserPlus,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  increment,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db, secureUrl } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { useAuth } from "./AuthContext";
import { fetchProfile, sendMessage } from "./chat";
import type { UserProfile } from "./types";

/**
 * Instagram-style share sheet: searchable friend grid on top and
 * external share actions at the bottom.
 */
export function ShareSheet({
  mediaUrl,
  mediaType,
  text,
  postId,
  onClose,
}: {
  mediaUrl: string;
  mediaType?: string;
  text?: string;
  postId?: string;
  onClose: () => void;
}) {
  const { user, profile } = useAuth();
  const [targets, setTargets] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState("");
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [storyDone, setStoryDone] = useState(false);

  const link = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : postId
          ? `${window.location.origin}/?post=${postId}`
          : mediaUrl,
    [postId, mediaUrl],
  );

  useEffect(() => {
    if (!user || !profile) return;
    setLoading(true);
    const ids = Array.from(
      new Set([...(profile.following ?? []), ...(profile.followers ?? [])]),
    ).filter((id) => id !== user.uid);
    void Promise.all(ids.map((id) => fetchProfile(id)))
      .then((list) => setTargets(list.filter((p): p is UserProfile => !!p)))
      .finally(() => setLoading(false));
  }, [user, profile]);

  const filtered = targets.filter((t) =>
    `${t.displayName} ${t.username}`
      .toLowerCase()
      .includes(term.trim().toLowerCase()),
  );

  const sendTo = async (target: UserProfile) => {
    if (!user || sent.has(target.uid)) return;
    setSent((s) => new Set(s).add(target.uid));
    if (postId) {
      updateDoc(doc(db, "posts", postId), { shares: increment(1) }).catch(
        () => {},
      );
    }
    await sendMessage(
      user.uid,
      target.uid,
      text ? `${text.slice(0, 80)} ${link}` : link,
      { url: secureUrl(mediaUrl), type: mediaType || "video" },
      "text",
      postId,
    ).catch(() => {});
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(link);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const nativeShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: "Fly", text: text || "", url: link }).catch(
        () => {},
      );
    } else {
      await copyLink();
    }
  };

  const openExternal = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const addToStory = async () => {
    if (!profile || storyDone) return;
    setStoryDone(true);
    await addDoc(collection(db, "stories"), {
      authorId: profile.uid,
      authorName: profile.displayName,
      authorUsername: profile.username,
      authorPhoto: profile.photoURL,
      mediaUrl: secureUrl(mediaUrl),
      mediaType: mediaType || "video",
      createdAt: serverTimestamp(),
    }).catch(() => {});
  };

  const actions = [
    {
      key: "story",
      label: "Add to story",
      icon: <CirclePlus size={22} />,
      className: "bg-gray-100 text-gray-700",
      onClick: addToStory,
      done: storyDone,
    },
    {
      key: "messenger",
      label: "Messenger",
      icon: <MessageCircle size={22} />,
      className: "bg-blue-500 text-white",
      onClick: () =>
        openExternal(
          `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
        ),
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      icon: <Share2 size={22} />,
      className: "bg-green-500 text-white",
      onClick: () =>
        openExternal(`https://wa.me/?text=${encodeURIComponent(link)}`),
    },
    {
      key: "share",
      label: "Share",
      icon: <Share2 size={22} />,
      className: "bg-gray-100 text-gray-700",
      onClick: nativeShare,
    },
    {
      key: "copy",
      label: copied ? "Copied" : "Copy link",
      icon: copied ? <Check size={22} /> : <Link2 size={22} />,
      className: "bg-gray-100 text-gray-700",
      onClick: copyLink,
    },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end">
      <button
        className="flex-1 bg-black/50"
        aria-label="Close share sheet"
        onClick={onClose}
      />
      <div className="bg-white rounded-t-3xl max-h-[78vh] flex flex-col">
        <div className="h-1.5 w-10 bg-gray-200 rounded-full mx-auto my-3" />
        <div className="flex items-center gap-2 px-4 pb-3">
          <div className="flex-1 flex items-center gap-2 h-11 px-3 rounded-full bg-gray-100">
            <Search size={17} className="text-gray-400" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
            <UserPlus size={19} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-sky-500" size={20} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              No people to share with yet.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-y-5 gap-x-2">
              {filtered.map((t) => (
                <button
                  key={t.uid}
                  onClick={() => void sendTo(t)}
                  className="flex flex-col items-center gap-2"
                >
                  <div
                    className={`rounded-full ${sent.has(t.uid) ? "opacity-50" : ""}`}
                  >
                    <Avatar src={t.photoURL} alt={t.displayName} size={76} />
                  </div>
                  <span className="text-xs text-gray-700 truncate max-w-[6.5rem]">
                    {t.displayName}
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      sent.has(t.uid) ? "text-gray-400" : "text-sky-600"
                    }`}
                  >
                    {sent.has(t.uid) ? "Sent" : "Send"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-3 py-3 overflow-x-auto">
          <div className="flex items-start gap-5 min-w-max">
            {actions.map((a) => (
              <button
                key={a.key}
                onClick={() => void a.onClick()}
                className="flex flex-col items-center gap-1.5 w-16"
              >
                <span
                  className={`w-14 h-14 rounded-full flex items-center justify-center ${a.className}`}
                >
                  {"done" in a && a.done ? <Check size={22} /> : a.icon}
                </span>
                <span className="text-[11px] text-gray-600 text-center leading-tight">
                  {a.label}
                </span>
              </button>
            ))}
            <span className="sr-only">
              <Copy size={1} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fullscreen image viewer with download + action menu (Edit/Forward/Share/Info/Album). */
export function ImageLightbox({
  src,
  name,
  createdAt,
  onClose,
}: {
  src: string;
  name?: string | undefined;
  createdAt?: number | undefined;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [albumDone, setAlbumDone] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rotate, setRotate] = useState(0);
  const [filter, setFilter] = useState<
    "none" | "grayscale" | "sepia" | "bright" | "contrast"
  >("none");

  const filterCss =
    filter === "grayscale"
      ? "grayscale(1)"
      : filter === "sepia"
        ? "sepia(1)"
        : filter === "bright"
          ? "brightness(1.35)"
          : filter === "contrast"
            ? "contrast(1.4)"
            : "none";

  const fileName = name || `fly-image-${Date.now()}.jpg`;

  const downloadImage = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  };

  const saveEditedCopy = async () => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      await img.decode();
      const rotated = rotate % 180 !== 0;
      const canvas = document.createElement("canvas");
      canvas.width = rotated ? img.naturalHeight : img.naturalWidth;
      canvas.height = rotated ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.filter = filterCss;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/jpeg", 0.92);
      a.download = `edited-${fileName}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setEditOpen(false);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  };

  const shareImage = async () => {
    if (navigator.share) {
      await navigator.share({ title: "Fly", url: src }).catch(() => {});
    } else {
      try {
        await navigator.clipboard?.writeText(src);
      } catch {
        /* ignore */
      }
    }
  };

  const createAlbum = async () => {
    if (!user || albumDone) return;
    setAlbumDone(true);
    await addDoc(collection(db, "albums"), {
      uid: user.uid,
      mediaUrl: secureUrl(src),
      mediaType: "image",
      name: fileName,
      createdAt: serverTimestamp(),
    }).catch(() => {});
  };

  const menuItems = [
    {
      key: "edit",
      label: "Edit",
      icon: <Pencil size={20} />,
      onClick: () => {
        setMenuOpen(false);
        setEditOpen(true);
      },
    },
    {
      key: "forward",
      label: "Forward",
      icon: <Send size={20} />,
      onClick: () => {
        setMenuOpen(false);
        setForwardOpen(true);
      },
    },
    {
      key: "share",
      label: "Share",
      icon: <Share2 size={20} />,
      onClick: () => {
        setMenuOpen(false);
        void shareImage();
      },
    },
    {
      key: "info",
      label: "Info",
      icon: <Info size={20} />,
      onClick: () => {
        setMenuOpen(false);
        setInfoOpen(true);
      },
    },
    {
      key: "album",
      label: albumDone ? "Saved to album" : "Create album",
      icon: albumDone ? <Check size={20} /> : <Images size={20} />,
      onClick: () => {
        setMenuOpen(false);
        void createAlbum();
      },
    },
  ];

  // ---- Image zoom state & helpers ----
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 5;
  const zoomContainerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<number | null>(null);
  const movedRef = useRef(false);

  const applyZoom = (z: number, o: { x: number; y: number }) => {
    zoomRef.current = z;
    offsetRef.current = o;
    setZoom(z);
    setOffset(o);
  };

  const clampNum = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));

  const zoomBy = (factor: number, anchorX?: number, anchorY?: number) => {
    const el = zoomContainerRef.current;
    if (!el) return;
    const z = clampNum(zoomRef.current * factor, ZOOM_MIN, ZOOM_MAX);
    const rect = el.getBoundingClientRect();
    const px = anchorX ?? rect.width / 2;
    const py = anchorY ?? rect.height / 2;
    const k = z / zoomRef.current;
    const o = offsetRef.current;
    applyZoom(z, { x: px - (px - o.x) * k, y: py - (py - o.y) * k });
  };

  useEffect(() => {
    const el = zoomContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy =
        e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomBy(Math.exp(-dy * 0.002), e.clientX - el.getBoundingClientRect().left, e.clientY - el.getBoundingClientRect().top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const touchDist = (t: React.TouchList | TouchList) =>
    t.length >= 2
      ? Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY)
      : 0;

  const onTouchStart = (e: React.TouchEvent) => {
    movedRef.current = false;
    if (e.touches.length === 2) {
      pinchRef.current = touchDist(e.touches);
      dragRef.current = null;
    } else if (e.touches.length === 1 && zoomRef.current > 1) {
      dragRef.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      movedRef.current = true;
      const d = touchDist(e.touches);
      const rect = zoomContainerRef.current!.getBoundingClientRect();
      const px =
        (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - rect.left;
      const py =
        (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - rect.top;
      const factor = d / pinchRef.current;
      pinchRef.current = d;
      zoomBy(factor, px, py);
    } else if (dragRef.current && zoomRef.current > 1) {
      movedRef.current = true;
      const dx = e.touches[0]!.clientX - dragRef.current.x;
      const dy = e.touches[0]!.clientY - dragRef.current.y;
      dragRef.current = {
        x: e.touches[0]!.clientX,
        y: e.touches[0]!.clientY,
      };
      const o = offsetRef.current;
      applyZoom(zoomRef.current, { x: o.x + dx, y: o.y + dy });
    }
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
    dragRef.current = null;
    if (zoomRef.current <= 1) applyZoom(1, { x: 0, y: 0 });
  };

  const resetZoom = () => applyZoom(1, { x: 0, y: 0 });

  const handleContainerClick = (e: React.MouseEvent) => {
    // Ignore clicks that were part of a drag/pinch gesture.
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col">
      <div className="flex items-center justify-between px-2 py-2">
        <button
          onClick={onClose}
          aria-label="Close image"
          className="w-10 h-10 rounded-full text-white flex items-center justify-center text-xl"
        >
          ✕
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void downloadImage()}
            aria-label="Download image"
            className="w-10 h-10 rounded-full text-white flex items-center justify-center"
          >
            {downloading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Download size={20} />
            )}
          </button>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="More options"
            className="w-10 h-10 rounded-full text-white flex items-center justify-center"
          >
            <MoreVertical size={20} />
          </button>
        </div>
      </div>

      <div
        ref={zoomContainerRef}
        className="flex-1 relative overflow-hidden touch-none select-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleContainerClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (zoomRef.current > 1) resetZoom();
          else {
            const rect = zoomContainerRef.current!.getBoundingClientRect();
            zoomBy(2, e.clientX - rect.left, e.clientY - rect.top);
          }
        }}
      >
        <img
          src={src}
          alt={name || "photo"}
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain transition-transform"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotate}deg)`,
            transformOrigin: "0 0",
            filter: filterCss,
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-3 p-3 shrink-0">
        <button
          onClick={() => zoomBy(1 / 1.4)}
          disabled={zoom <= ZOOM_MIN}
          className="h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
          aria-label="জুম আউট"
        >
          <Minus size={18} />
        </button>
        <span className="text-white/80 text-xs font-medium w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => zoomBy(1.4)}
          disabled={zoom >= ZOOM_MAX}
          className="h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
          aria-label="জুম ইন"
        >
          <Plus size={18} />
        </button>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-[85] flex flex-col justify-end">
          <button
            className="flex-1 bg-black/40"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="bg-neutral-900 rounded-t-3xl py-3">
            <div className="h-1.5 w-10 bg-neutral-700 rounded-full mx-auto mb-2" />
            {menuItems.map((item) => (
              <button
                key={item.key}
                onClick={item.onClick}
                className="w-full flex items-center gap-4 px-6 py-3.5 text-white hover:bg-neutral-800"
              >
                <span className="text-neutral-300">{item.icon}</span>
                <span className="text-[15px]">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {infoOpen && (
        <div className="fixed inset-0 z-[85] flex flex-col justify-end">
          <button
            className="flex-1 bg-black/40"
            aria-label="Close info"
            onClick={() => setInfoOpen(false)}
          />
          <div className="bg-neutral-900 rounded-t-3xl p-6 text-white space-y-2">
            <h3 className="font-semibold text-lg mb-3">Photo info</h3>
            <p className="text-sm text-neutral-300">
              <span className="text-neutral-500">Name:</span> {fileName}
            </p>
            <p className="text-sm text-neutral-300">
              <span className="text-neutral-500">Type:</span> Image
            </p>
            {createdAt ? (
              <p className="text-sm text-neutral-300">
                <span className="text-neutral-500">Sent:</span>{" "}
                {new Date(createdAt).toLocaleString()}
              </p>
            ) : null}
            <button
              onClick={() => setInfoOpen(false)}
              className="mt-3 w-full py-2.5 rounded-full bg-neutral-800 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-[85] bg-black flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 text-white">
            <button
              onClick={() => setEditOpen(false)}
              aria-label="Close editor"
              className="w-10 h-10 flex items-center justify-center text-xl"
            >
              ✕
            </button>
            <span className="font-semibold text-sm">Edit photo</span>
            <button
              onClick={() => void saveEditedCopy()}
              className="px-4 py-1.5 rounded-full bg-sky-500 text-sm font-semibold"
            >
              Save copy
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden">
            <img
              src={src}
              alt="edit preview"
              className="max-h-full max-w-full object-contain transition-transform"
              style={{ transform: `rotate(${rotate}deg)`, filter: filterCss }}
            />
          </div>
          <div className="flex items-center justify-center gap-3 px-4 py-4 overflow-x-auto">
            <button
              onClick={() => setRotate((r) => (r + 90) % 360)}
              className="px-4 py-2 rounded-full bg-neutral-800 text-white text-xs font-semibold whitespace-nowrap"
            >
              Rotate
            </button>
            {(
              [
                ["none", "Original"],
                ["grayscale", "B&W"],
                ["sepia", "Sepia"],
                ["bright", "Bright"],
                ["contrast", "Contrast"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap ${
                  filter === key
                    ? "bg-sky-500 text-white"
                    : "bg-neutral-800 text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {forwardOpen && (
        <ShareSheet
          mediaUrl={src}
          mediaType="image"
          onClose={() => setForwardOpen(false)}
        />
      )}
    </div>
  );
}

/** Fullscreen in-app video player used when a chat video is tapped. */
export function VideoLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] bg-black flex items-center justify-center"
      onClick={onClose}
    >
      <video
        src={src}
        controls
        autoPlay
        playsInline
        className="max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        aria-label="Close video"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center"
      >
        ✕
      </button>
    </div>
  );
}
