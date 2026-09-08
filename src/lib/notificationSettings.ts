/**
 * User-controlled notification preferences (sound / vibration / push)
 * per event type. Stored locally so they survive reloads.
 */
import { useEffect, useState } from "react";

export type NotifyEvent = "messages" | "calls";
export type NotifyChannel = "sound" | "vibration" | "push";

export type EventPrefs = Record<NotifyChannel, boolean>;
export type NotificationSettings = Record<NotifyEvent, EventPrefs>;

export const NOTIFY_EVENTS: { id: NotifyEvent; label: string; hint: string }[] = [
  { id: "messages", label: "Messages", hint: "New chats, photos and files" },
  { id: "calls", label: "Calls", hint: "Incoming audio and video calls" },
];

export const NOTIFY_CHANNELS: { id: NotifyChannel; label: string }[] = [
  { id: "sound", label: "In-app sound" },
  { id: "vibration", label: "Vibration" },
  { id: "push", label: "Push notification" },
];

const STORAGE_KEY = "fly.notificationSettings";

export const DEFAULT_SETTINGS: NotificationSettings = {
  messages: { sound: true, vibration: true, push: true },
  calls: { sound: true, vibration: true, push: true },
};

function normalize(raw: unknown): NotificationSettings {
  const out: NotificationSettings = {
    messages: { ...DEFAULT_SETTINGS.messages },
    calls: { ...DEFAULT_SETTINGS.calls },
  };
  if (!raw || typeof raw !== "object") return out;
  const data = raw as Partial<Record<NotifyEvent, Partial<EventPrefs>>>;
  (Object.keys(out) as NotifyEvent[]).forEach((event) => {
    const src = data[event];
    if (!src) return;
    (Object.keys(out[event]) as NotifyChannel[]).forEach((channel) => {
      if (typeof src[channel] === "boolean") out[event][channel] = src[channel]!;
    });
  });
  return out;
}

let current: NotificationSettings = DEFAULT_SETTINGS;
let loaded = false;
const listeners = new Set<(s: NotificationSettings) => void>();

export function getNotificationSettings(): NotificationSettings {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) current = normalize(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
  }
  return current;
}

export function setNotificationSettings(next: NotificationSettings) {
  current = next;
  loaded = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l(next));
}

export function toggleNotificationSetting(
  event: NotifyEvent,
  channel: NotifyChannel,
) {
  const prev = getNotificationSettings();
  setNotificationSettings({
    ...prev,
    [event]: { ...prev[event], [channel]: !prev[event][channel] },
  });
}

/** True when the given channel is enabled for that event type. */
export function isNotifyEnabled(event: NotifyEvent, channel: NotifyChannel) {
  return getNotificationSettings()[event][channel];
}

export function subscribeNotificationSettings(
  listener: (s: NotificationSettings) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNotificationSettings(): NotificationSettings {
  const [settings, setSettings] = useState<NotificationSettings>(() =>
    getNotificationSettings(),
  );
  useEffect(() => {
    setSettings(getNotificationSettings());
    return subscribeNotificationSettings(setSettings);
  }, []);
  return settings;
}
