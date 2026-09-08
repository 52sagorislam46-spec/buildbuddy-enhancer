/**
 * Live video-call effects (Touch up / Effects / Backgrounds / Color filters).
 *
 * The raw camera track is drawn into a canvas every frame with CSS filters
 * applied, and the canvas is captured back into a MediaStream. That processed
 * track is what we send to the other side and show in the local preview, so
 * every effect works for real on both screens.
 */

export interface EffectOption {
  id: string;
  label: string;
  /** CSS filter string applied to the frame. */
  filter: string;
}

export const TOUCH_UP_OPTIONS: EffectOption[] = [
  { id: "off", label: "Off", filter: "" },
  { id: "soft", label: "Soft", filter: "brightness(1.06) saturate(1.1) blur(0.7px)" },
  { id: "glow", label: "Glow", filter: "brightness(1.14) saturate(1.18) contrast(0.96) blur(1px)" },
  { id: "sharp", label: "Clear", filter: "contrast(1.12) saturate(1.05) brightness(1.03)" },
];

export const EFFECT_OPTIONS: EffectOption[] = [
  { id: "none", label: "None", filter: "" },
  { id: "mono", label: "Mono", filter: "grayscale(1) contrast(1.1)" },
  { id: "vintage", label: "Vintage", filter: "sepia(0.55) contrast(1.1) saturate(0.9)" },
  { id: "comic", label: "Comic", filter: "contrast(1.6) saturate(1.8) brightness(1.05)" },
  { id: "neon", label: "Neon", filter: "saturate(2.2) hue-rotate(-20deg) contrast(1.25)" },
  { id: "invert", label: "X-ray", filter: "invert(1) hue-rotate(180deg)" },
];

export const COLOR_FILTER_OPTIONS: EffectOption[] = [
  { id: "none", label: "None", filter: "" },
  { id: "warm", label: "Warm", filter: "sepia(0.28) saturate(1.25)" },
  { id: "cool", label: "Cool", filter: "hue-rotate(180deg) saturate(1.1) brightness(1.03)" },
  { id: "mint", label: "Mint", filter: "hue-rotate(80deg) saturate(1.2)" },
  { id: "rose", label: "Rose", filter: "hue-rotate(-35deg) saturate(1.3)" },
  { id: "fade", label: "Fade", filter: "contrast(0.88) saturate(0.8) brightness(1.08)" },
];

export interface BackgroundOption {
  id: string;
  label: string;
  /** Blur radius (px) applied outside the centred subject area. */
  blur: number;
  /** Darkening applied to the background, 0-1. */
  dim: number;
}

export const BACKGROUND_OPTIONS: BackgroundOption[] = [
  { id: "none", label: "None", blur: 0, dim: 0 },
  { id: "blur", label: "Blur", blur: 12, dim: 0 },
  { id: "strong", label: "Strong blur", blur: 24, dim: 0.1 },
  { id: "spotlight", label: "Spotlight", blur: 16, dim: 0.45 },
];

export interface EffectSettings {
  touchUp: string;
  effect: string;
  color: string;
  background: string;
}

export const DEFAULT_EFFECTS: EffectSettings = {
  touchUp: "off",
  effect: "none",
  color: "none",
  background: "none",
};

export function isEffectsActive(s: EffectSettings): boolean {
  return (
    s.touchUp !== "off" ||
    s.effect !== "none" ||
    s.color !== "none" ||
    s.background !== "none"
  );
}

function pick(list: EffectOption[], id: string) {
  return list.find((o) => o.id === id)?.filter ?? "";
}

export function filterStringFor(s: EffectSettings): string {
  const parts = [
    pick(TOUCH_UP_OPTIONS, s.touchUp),
    pick(EFFECT_OPTIONS, s.effect),
    pick(COLOR_FILTER_OPTIONS, s.color),
  ].filter(Boolean);
  return parts.join(" ") || "none";
}

export function backgroundFor(s: EffectSettings): BackgroundOption {
  return (
    BACKGROUND_OPTIONS.find((o) => o.id === s.background) ?? BACKGROUND_OPTIONS[0]!
  );
}

/** Draws a camera track through a canvas so live effects can be applied. */
export class VideoEffectProcessor {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private mask: HTMLCanvasElement | null = null;
  private raf = 0;
  private stream: MediaStream | null = null;
  private settings: EffectSettings = DEFAULT_EFFECTS;

  get output() {
    return this.stream;
  }

  setSettings(next: EffectSettings) {
    this.settings = next;
  }

  /** Starts processing and returns the processed video stream. */
  start(track: MediaStreamTrack, settings: EffectSettings): MediaStream | null {
    if (typeof document === "undefined") return null;
    this.stop();
    this.settings = settings;

    // Process at most 640px wide — filtered/blurred frames above that are too
    // expensive for phones and make the live call stutter.
    const MAX_W = 640;
    const fit = (w: number, h: number) => {
      if (!w || !h || w <= MAX_W) return { w: w || 640, h: h || 480 };
      return { w: MAX_W, h: Math.round((h * MAX_W) / w) };
    };
    const settingsTrack = track.getSettings();
    const { w: width, h: height } = fit(
      settingsTrack.width ?? 640,
      settingsTrack.height ?? 480,
    );


    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => {});
    this.video = video;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    this.canvas = canvas;

    const mask = document.createElement("canvas");
    mask.width = width;
    mask.height = height;
    this.mask = mask;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Cap the processing rate: drawing filtered frames at the browser's full
    // 60fps rAF rate overloads mobile CPUs and makes the call stutter.
    const minFrameMs = 1000 / 24;
    let lastDraw = 0;

    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastDraw < minFrameMs) return;
      lastDraw = now;
      const v = this.video;
      if (!v || v.readyState < 2) return;

      if (v.videoWidth) {
        const size = fit(v.videoWidth, v.videoHeight);
        if (size.w !== canvas.width || size.h !== canvas.height) {
          canvas.width = size.w;
          canvas.height = size.h;
          mask.width = size.w;
          mask.height = size.h;
        }
      }

      const w = canvas.width;
      const h = canvas.height;
      const filter = filterStringFor(this.settings);
      const bg = backgroundFor(this.settings);

      ctx.save();
      ctx.filter = bg.blur
        ? `${filter === "none" ? "" : filter} blur(${bg.blur}px)`.trim()
        : filter;
      ctx.drawImage(v, 0, 0, w, h);
      ctx.restore();

      if (bg.dim) {
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${bg.dim})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      if (bg.blur) {
        // Re-draw the centred subject area sharp, feathered with a radial mask.
        const mctx = mask.getContext("2d");
        if (mctx) {
          mctx.clearRect(0, 0, w, h);
          mctx.save();
          mctx.filter = filter;
          mctx.drawImage(v, 0, 0, w, h);
          mctx.restore();
          const grad = mctx.createRadialGradient(
            w / 2,
            h * 0.44,
            Math.min(w, h) * 0.2,
            w / 2,
            h * 0.44,
            Math.min(w, h) * 0.55,
          );
          grad.addColorStop(0, "rgba(0,0,0,1)");
          grad.addColorStop(0.75, "rgba(0,0,0,0.85)");
          grad.addColorStop(1, "rgba(0,0,0,0)");
          mctx.globalCompositeOperation = "destination-in";
          mctx.fillStyle = grad;
          mctx.fillRect(0, 0, w, h);
          mctx.globalCompositeOperation = "source-over";
          ctx.drawImage(mask, 0, 0, w, h);
        }
      }
    };
    this.raf = requestAnimationFrame(draw);

    const captured = (
      canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }
    ).captureStream?.(24);
    if (!captured) {
      this.stop();
      return null;
    }
    this.stream = captured;
    return captured;
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      try {
        this.video.pause();
        this.video.srcObject = null;
      } catch {
        /* noop */
      }
      this.video = null;
    }
    this.canvas = null;
    this.mask = null;
  }
}
