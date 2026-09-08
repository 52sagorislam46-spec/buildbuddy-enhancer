/*
 * Background acknowledgement helper (shared by the push service workers).
 *
 * When a push arrives while the app is closed, this marks the device as
 * reachable (so the person shows as online while their data is on) and marks
 * the incoming chat messages as delivered — all without opening the app.
 */
/* eslint-disable */

const FLY_API_KEY = "AIzaSyDfzHhkNtrs3A_soHAWE51le-zrlbeXulc";
const FLY_PROJECT_ID = "fly-c7445";
const FLY_DB = `https://firestore.googleapis.com/v1/projects/${FLY_PROJECT_ID}/databases/(default)/documents`;

function flyIdb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fly-sw", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("auth")) {
        request.result.createObjectStore("auth");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function flyReadAuth() {
  try {
    const db = await flyIdb();
    return await new Promise((resolve) => {
      const tx = db.transaction("auth", "readonly");
      const req = tx.objectStore("auth").get("current");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

let flyTokenCache = null;

async function flyAccessToken(refreshToken) {
  const now = Date.now();
  if (flyTokenCache && flyTokenCache.expires > now + 60_000) {
    return flyTokenCache.token;
  }
  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FLY_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;
  flyTokenCache = {
    token: data.access_token,
    expires: now + Number(data.expires_in || 3000) * 1000,
  };
  return flyTokenCache.token;
}

async function flyTouchPresence(uid, token) {
  const iso = new Date().toISOString();
  await fetch(
    `${FLY_DB}/presence/${uid}?updateMask.fieldPaths=reachable&updateMask.fieldPaths=reachableAt&updateMask.fieldPaths=lastSeen`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          reachable: { booleanValue: true },
          reachableAt: { timestampValue: iso },
          lastSeen: { timestampValue: iso },
        },
      }),
    },
  ).catch(() => {});
}

async function flyMarkDelivered(convId, uid, token) {
  const listUrl =
    `${FLY_DB}/conversations/${convId}/messages` +
    `?pageSize=25&orderBy=createdAt%20desc`;
  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return;
  const data = await res.json();
  const docs = data.documents || [];
  const writes = [];
  for (const document of docs) {
    const fields = document.fields || {};
    const sender = fields.senderId && fields.senderId.stringValue;
    if (!sender || sender === uid) continue;
    if (fields.deleted && fields.deleted.booleanValue) continue;
    const delivered =
      (fields.deliveredTo &&
        fields.deliveredTo.arrayValue &&
        fields.deliveredTo.arrayValue.values) ||
      [];
    if (delivered.some((v) => v.stringValue === uid)) continue;
    writes.push({
      transform: {
        document: document.name,
        fieldTransforms: [
          {
            fieldPath: "deliveredTo",
            appendMissingElements: { values: [{ stringValue: uid }] },
          },
        ],
      },
    });
  }
  if (!writes.length) return;
  await fetch(`${FLY_DB.replace(/\/documents$/, "")}/documents:commit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ writes }),
  }).catch(() => {});
}

/** Acknowledges a background push. `data` may carry `convId`. */
async function flyAck(data) {
  try {
    const auth = await flyReadAuth();
    if (!auth || !auth.uid || !auth.refreshToken) return;
    const token = await flyAccessToken(auth.refreshToken);
    if (!token) return;
    await flyTouchPresence(auth.uid, token);
    const convId = data && (data.convId || data.conversationId);
    if (convId) await flyMarkDelivered(String(convId), auth.uid, token);
  } catch (e) {
    /* background ack is best effort */
  }
}

self.flyAck = flyAck;
