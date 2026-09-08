/**
 * Web push (Firebase Cloud Messaging).
 * Registers a device token for the signed-in user so notifications can be
 * delivered even when the app is closed or the phone is locked.
 */
import { arrayRemove, arrayUnion, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { setPushReachable } from "../components/fly/presence";
import { sendPushNotification } from "./push.functions";
import {
  initializeOneSignalUser,
  isOneSignalConfigured,
  logoutOneSignal,
  requestOneSignalPermission,
  sendOneSignalNotification,
} from "./onesignal";
import type { NotifyEvent } from "./notificationSettings";

export { logoutOneSignal };

// The app's own Firebase project (same project as the messaging connector)
// is used whenever the connector's public web-push values are not present,
// so only the VAPID key has to come from the connection.
const APP_FIREBASE = {
  apiKey: "AIzaSyDfzHhkNtrs3A_soHAWE51le-zrlbeXulc",
  projectId: "fly-c7445",
  appId: "1:48342961325:web:2a185f173692aec3a28a24",
};

const appId =
  (import.meta.env["VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_APP_ID"] as
    | string
    | undefined) || APP_FIREBASE.appId;
const vapidKey = import.meta.env[
  "VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_VAPID_KEY"
] as string | undefined;

const firebaseConfig = {
  apiKey:
    (import.meta.env["VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_WEB_API_KEY"] as
      | string
      | undefined) || APP_FIREBASE.apiKey,
  projectId:
    (import.meta.env["VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_PROJECT_ID"] as
      | string
      | undefined) || APP_FIREBASE.projectId,
  appId,
  messagingSenderId: appId?.split(":")[1] ?? "",
};

export type PushStatus =
  | "registered"
  | "not-configured"
  | "unsupported"
  | "open-in-new-tab"
  | "denied";

const TOKEN_CACHE_KEY = "fly.fcmToken";

/** Initializes background push without opening a browser permission prompt. */
export async function initializePush(uid: string): Promise<PushStatus> {
  if (typeof window === "undefined") return "unsupported";
  if (!isOneSignalConfigured()) {
    // No OneSignal: silently refresh the Firebase device token when the user
    // has already allowed notifications (never opens a permission prompt).
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return "not-configured";
    }
    return enableFcmPush(uid);
  }
  try {
    await initializeOneSignalUser(uid);
    setPushReachable(uid, true);
    return "registered";
  } catch (error) {
    return error instanceof Error && error.message === "open-in-new-tab"
      ? "open-in-new-tab"
      : "unsupported";
  }
}


const AUTO_PROMPT_KEY = "fly.pushAutoPrompt";

/**
 * Makes sure this device can receive calls while the app is closed.
 * Already-granted devices just refresh their token; a device that has never
 * been asked gets one permission prompt (on the first user interaction).
 */
export function ensureCallPushRegistered(uid: string): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;

  if (Notification.permission === "granted") {
    void initializePush(uid);
    return;
  }
  if (Notification.permission === "denied") return;
  if (localStorage.getItem(AUTO_PROMPT_KEY) === uid) return;

  const ask = () => {
    window.removeEventListener("pointerdown", ask);
    window.removeEventListener("keydown", ask);
    localStorage.setItem(AUTO_PROMPT_KEY, uid);
    void enablePush(uid);
  };
  window.addEventListener("pointerdown", ask, { once: true });
  window.addEventListener("keydown", ask, { once: true });
}

/** Ask for permission and register this browser for background push. */
export async function enablePush(uid: string): Promise<PushStatus> {
  if (isOneSignalConfigured()) {
    if (typeof window === "undefined") return "unsupported";
    try {
      const granted = await requestOneSignalPermission(uid);
      return granted ? "registered" : "denied";
    } catch (error) {
      return error instanceof Error && error.message === "open-in-new-tab"
        ? "open-in-new-tab"
        : "unsupported";
    }
  }
  return enableFcmPush(uid);
}

/** Legacy Firebase Messaging registration kept as a fallback. */
async function enableFcmPush(uid: string): Promise<PushStatus> {
  if (typeof window === "undefined") return "unsupported";
  if (
    !firebaseConfig.apiKey ||
    !firebaseConfig.projectId ||
    !appId ||
    !vapidKey ||
    !firebaseConfig.messagingSenderId
  ) {
    return "not-configured";
  }
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";

  const { initializeApp, getApps, getApp } = await import("firebase/app");
  const { getMessaging, getToken, isSupported, onMessage } = await import(
    "firebase/messaging"
  );
  if (!(await isSupported())) return "unsupported";
  if (window.top !== window.self) return "open-in-new-tab";

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  try {
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
    );
    const app = getApps().length
      ? getApp()
      : initializeApp(firebaseConfig as Record<string, string>);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return "denied";

    if (localStorage.getItem(TOKEN_CACHE_KEY) !== token) {
      await setDoc(
        doc(db, "users", uid),
        { fcmTokens: arrayUnion(token) },
        { merge: true },
      );
      localStorage.setItem(TOKEN_CACHE_KEY, token);
    }

    setPushReachable(uid, true);

    onMessage(messaging, () => {
      /* foreground alerts are handled by the in-app notification code */
    });
    return "registered";
  } catch {
    return "unsupported";
  }
}

/** Collect the device tokens of the given users. */
export async function tokensForUsers(uids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(uids.filter(Boolean)));
  const lists = await Promise.all(
    unique.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        const raw = snap.data()?.["fcmTokens"];
        return Array.isArray(raw) ? (raw as string[]) : [];
      } catch {
        return [];
      }
    }),
  );
  return Array.from(new Set(lists.flat().filter(Boolean)));
}

/** Best-effort push to a set of users. */
export async function pushToUsers(input: {
  uids: string[];
  title: string;
  body: string;
  icon?: string;
  link?: string;
  tag?: string;
  convId?: string;
  event?: NotifyEvent;
}) {
  try {
    if (isOneSignalConfigured()) {
      const result = await sendOneSignalNotification({
        externalIds: input.uids,
        title: input.title,
        body: input.body,
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.link !== undefined ? { link: input.link } : {}),
        ...(input.tag !== undefined ? { tag: input.tag } : {}),
      });
      if (result.ok) return;
    }

    const tokens = await tokensForUsers(input.uids);
    if (!tokens.length) return;
    const result = await sendPushNotification({
      data: {
        tokens,
        title: input.title,
        body: input.body,
        icon: input.icon ?? "",
        link: input.link ?? "/",
        tag: input.tag ?? "",
        convId: input.convId ?? "",
      },
    });
    const invalid = (result as { invalid?: string[] })?.invalid ?? [];
    if (invalid.length) {
      await Promise.all(
        input.uids.map((uid) =>
          setDoc(
            doc(db, "users", uid),
            { fcmTokens: arrayRemove(...invalid) },
            { merge: true },
          ).catch(() => {}),
        ),
      );
    }
  } catch {
    /* push is best effort */
  }
}
