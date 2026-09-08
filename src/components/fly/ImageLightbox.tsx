import { useEffect, useRef, useState } from "react";
import { Download, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export function ImageLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<number | null>(null);

  const apply = (z: number, o: { x: number; y: number }) => {
    zoomRef.current = z;
    offsetRef.current = o;
    setZoom(z);
    setOffset(o);
  };

  // Cursor-anchored wheel / pinch zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy =
        e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const z = clamp(zoomRef.current * Math.exp(-dy * 0.002), MIN_ZOOM, MAX_ZOOM);
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const k = z / zoomRef.current;
      const o = offsetRef.current;
      apply(z, { x: px - (px - o.x) * k, y: py - (py - o.y) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Lock background scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dist = (t: React.TouchList | TouchList) =>
    t.length >= 2
      ? Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY)
      : 0;

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchRef.current = dist(e.touches);
      dragRef.current = null;
    } else if (e.touches.length === 1 && zoomRef.current > 1) {
      dragRef.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const d = dist(e.touches);
      const z = clamp(
        zoomRef.current * (d / pinchRef.current),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      pinchRef.current = d;
      const rect = containerRef.current!.getBoundingClientRect();
      const px = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - rect.left;
      const py = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - rect.top;
      const k = z / zoomRef.current;
      const o = offsetRef.current;
      apply(z, { x: px - (px - o.x) * k, y: py - (py - o.y) * k });
    } else if (dragRef.current && zoomRef.current > 1) {
      const dx = e.touches[0]!.clientX - dragRef.current.x;
      const dy = e.touches[0]!.clientY - dragRef.current.y;
      dragRef.current = {
        x: e.touches[0]!.clientX,
        y: e.touches[0]!.clientY,
      };
      const o = offsetRef.current;
      apply(zoomRef.current, { x: o.x + dx, y: o.y + dy });
    }
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
    dragRef.current = null;
    if (zoomRef.current <= 1) apply(1, { x: 0, y: 0 });
  };

  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const z = clamp(zoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
    const rect = el.getBoundingClientRect();
    const px = rect.width / 2;
    const py = rect.height / 2;
    const k = z / zoomRef.current;
    const o = offsetRef.current;
    apply(z, { x: px - (px - o.x) * k, y: py - (py - o.y) * k });
  };

  const saveImage = async () => {
    try {
      const res = await fetch(src, { mode: "cors" });
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fly-photo-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("ছবি সেভ হয়েছে");
    } catch {
      window.open(src, "_blank");
      toast.info("ছবি নতুন ট্যাবে খোলা হয়েছে — সেখান থেকে সেভ করুন");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col"
      role="dialog"
      aria-label="ছবি বড় করে দেখুন"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between p-3 shrink-0">
        <button
          onClick={saveImage}
          className="flex items-center gap-1.5 h-9 px-4 rounded-full bg-white/10 text-white text-sm font-semibold active:scale-95 transition-transform"
          aria-label="ছবি সেভ করুন"
        >
          <Download size={17} /> সেভ
        </button>
        <button
          onClick={onClose}
          className="h-9 w-9 rounded-full bg-white/10 text-white flex items-center justify-center active:scale-95 transition-transform"
          aria-label="বন্ধ করুন"
        >
          <X size={19} />
        </button>
      </div>

      {/* Zoom area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden touch-none select-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={() =>
          zoomRef.current > 1
            ? apply(1, { x: 0, y: 0 })
            : zoomBy(2)
        }
      >
        <img
          src={src}
          alt="পোস্টের ছবি বড় করে"
          draggable={false}
          className="w-full h-full object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        />
      </div>

      {/* Bottom zoom controls */}
      <div className="flex items-center justify-center gap-3 p-3 shrink-0">
        <button
          onClick={() => zoomBy(1 / 1.4)}
          disabled={zoom <= MIN_ZOOM}
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
          disabled={zoom >= MAX_ZOOM}
          className="h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
          aria-label="জুম ইন"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}
