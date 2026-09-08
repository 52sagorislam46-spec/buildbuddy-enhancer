/* Background push handler: shows notifications when the app is closed. */
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");
importScripts("/fly-push-ack.js");

firebase.initializeApp({
  apiKey: "AIzaSyDfzHhkNtrs3A_soHAWE51le-zrlbeXulc",
  authDomain: "fly-c7445.firebaseapp.com",
  projectId: "fly-c7445",
  storageBucket: "fly-c7445.firebasestorage.app",
  messagingSenderId: "48342961325",
  appId: "1:48342961325:web:2a185f173692aec3a28a24",
});

const messaging = firebase.messaging();

/* Tags of calls that are still ringing on this device. */
const ringing = new Set();

function showCallNotification(data, title, tag) {
  return self.registration.showNotification(title, {
    body: data.body || "",
    icon: data.icon || "/favicon.ico",
    badge: "/favicon.ico",
    tag: tag,
    data: { link: data.link || "/", call: true },
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [700, 400, 700, 400, 700, 400, 700],
    actions: [
      { action: "answer", title: "Answer" },
      { action: "decline", title: "Decline" },
    ],
  });
}

/* Keeps the phone buzzing while the caller is still waiting (~30s). */
async function ringLoop(data, title, tag) {
  ringing.add(tag);
  for (let i = 0; i < 10; i++) {
    if (!ringing.has(tag)) return;
    const open = await self.registration.getNotifications({ tag: tag });
    if (i > 0 && open.length === 0) {
      ringing.delete(tag);
      return;
    }
    await showCallNotification(data, title, tag);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  ringing.delete(tag);
}

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  /* Mark this phone reachable + the message delivered while the app is shut. */
  if (typeof self.flyAck === "function") self.flyAck(data);
  const title = data.title || "Fly";
  const tag = data.tag || "";
  const isCall = tag.indexOf("call_") === 0 || tag.indexOf("groupcall_") === 0;
  if (isCall) return ringLoop(data, title, tag);
  return self.registration.showNotification(title, {
    body: data.body || "",
    icon: data.icon || "/favicon.ico",
    badge: "/favicon.ico",
    tag: tag || undefined,
    data: { link: data.link || "/" },
    renotify: Boolean(tag),
    vibrate: [120, 60, 120],
  });
});

self.addEventListener("notificationclose", (event) => {
  const tag = event.notification.tag || "";
  if (tag) ringing.delete(tag);
});



self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.notification.tag) ringing.delete(event.notification.tag);
  if (event.action === "decline") return;
  const link = (event.notification.data && event.notification.data.link) || "/";


  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
