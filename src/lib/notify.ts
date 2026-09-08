/**
 * Shared audio + notification helpers.
 * Browsers block AudioContext until a user gesture, so we unlock a single
 * shared context on the first interaction and reuse it everywhere.
 */

import { isNotifyEnabled, type NotifyEvent } from "./notificationSettings";

let sharedCtx: AudioContext | null = null;
let unlockBound = false;

function createCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export function getAudioContext(): AudioContext | null {
  if (!sharedCtx) sharedCtx = createCtx();
  if (sharedCtx && sharedCtx.state === "suspended") {
    void sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

/** Attach one-time listeners so audio is allowed to play later. */
export function bindAudioUnlock() {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  const unlock = () => {
    getAudioContext();
  };
  ["pointerdown", "touchstart", "keydown", "click"].forEach((ev) =>
    window.addEventListener(ev, unlock, { passive: true }),
  );
}

/** Short notification chime. */
export function playChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.14);
    gain.gain.linearRampToValueAtTime(0.2, now + i * 0.14 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.14);
    osc.stop(now + i * 0.14 + 0.3);
  });
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* noop */
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function showNotification(
  title: string,
  body: string,
  options: { icon?: string; silent?: boolean; event?: NotifyEvent } = {},
) {
  const event = options.event ?? "messages";
  if (isNotifyEnabled(event, "sound")) playChime();
  if (isNotifyEnabled(event, "vibration")) vibrate([120, 60, 120]);
  if (!isNotifyEnabled(event, "push")) return;
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: options.icon || "/favicon.ico",
      silent: true,
    });
  } catch {
    /* notification blocked (e.g. inside an iframe) */
  }
}

/** Short "whoosh" played when the user sends a message. */
export function playSendSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(1150, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}
