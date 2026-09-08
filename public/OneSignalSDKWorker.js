importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
importScripts("/fly-push-ack.js");

/* Same background acknowledgement as the Firebase worker. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    const payload = event.data ? event.data.json() : {};
    data = payload.data || (payload.custom && payload.custom.a) || payload || {};
  } catch (e) {
    data = {};
  }
  if (typeof self.flyAck === "function") event.waitUntil(self.flyAck(data));
});
