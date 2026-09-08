type OneSignalClient = {
  init: (options: {
    appId: string;
    serviceWorkerPath: string;
    serviceWorkerParam?: { scope: string };
    allowLocalhostAsSecureOrigin?: boolean;
  }) => Promise<void>;
  login: (externalId: string) => Promise<void>;
  logout: () => Promise<void>;
  Notifications: {
    requestPermission: () => Promise<boolean>;
  };
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(instance: OneSignalClient) => void | Promise<void>>;
  }
}

const appId = import.meta.env["VITE_ONESIGNAL_APP_ID"] as string | undefined;
let readyPromise: Promise<OneSignalClient> | null = null;

export function isOneSignalConfigured(): boolean {
  return Boolean(appId);
}

function loadOneSignal(): Promise<OneSignalClient> {
  if (!appId || typeof window === "undefined") {
    return Promise.reject(new Error("OneSignal is not configured."));
  }
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<OneSignalClient>((resolve, reject) => {
    const queue = (window.OneSignalDeferred ??= []);
    queue.push(async (instance) => {
      try {
        await instance.init({
          appId,
          serviceWorkerPath: "/OneSignalSDKWorker.js",
          serviceWorkerParam: { scope: "/" },
          allowLocalhostAsSecureOrigin: true,
        });
        resolve(instance);
      } catch (error) {
        reject(error);
      }
    });

    if (document.querySelector('script[data-onesignal-sdk="true"]')) return;
    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.async = true;
    script.dataset["onesignalSdk"] = "true";
    script.onerror = () => reject(new Error("Could not load OneSignal."));
    document.head.appendChild(script);
  });

  return readyPromise;
}

export async function initializeOneSignalUser(uid: string): Promise<void> {
  if (window.top !== window.self) {
    throw new Error("open-in-new-tab");
  }
  const oneSignal = await loadOneSignal();
  await oneSignal.login(uid);
}

export async function requestOneSignalPermission(uid: string): Promise<boolean> {
  await initializeOneSignalUser(uid);
  const oneSignal = await loadOneSignal();
  return oneSignal.Notifications.requestPermission();
}

export async function logoutOneSignal(): Promise<void> {
  if (!readyPromise) return;
  try {
    const oneSignal = await readyPromise;
    await oneSignal.logout();
  } catch {
    /* A failed cleanup must not block sign-out. */
  }
}

export async function sendOneSignalNotification(input: {
  externalIds: string[];
  title: string;
  body: string;
  icon?: string;
  link?: string;
  tag?: string;
}): Promise<{ ok: boolean; sent: boolean; error?: string }> {
  const token = await import("./firebase").then(({ auth }) =>
    auth.currentUser?.getIdToken(),
  );
  if (!token) return { ok: false, sent: false, error: "No Firebase session." };

  try {
    const link =
      typeof window !== "undefined"
        ? new URL(input.link || "/", window.location.origin).toString()
        : input.link || "/";
    const response = await fetch("/api/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...input, link }),
    });
    const data = (await response.json().catch(() => null)) as
      | { sent?: boolean; error?: string }
      | null;
    if (!response.ok) {
      return {
        ok: false,
        sent: false,
        error: data?.error || `Push request failed (${response.status}).`,
      };
    }
    return { ok: true, sent: Boolean(data?.sent) };
  } catch (error) {
    return {
      ok: false,
      sent: false,
      error: error instanceof Error ? error.message : "Push request failed.",
    };
  }
}