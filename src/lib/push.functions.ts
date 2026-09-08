/**
 * Firebase Cloud Messaging sender.
 *
 * Runs on the server (TanStack Start server function) so the Lovable gateway
 * credentials are never exposed to the browser. Push stays best-effort: when
 * the credentials are missing the call resolves without sending anything.
 */
import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/firebase_messaging";

export interface PushInput {
  tokens: string[];
  title: string;
  body: string;
  icon?: string;
  link?: string;
  tag?: string;
  convId?: string;
}

interface PushResult {
  sent: number;
  invalid: string[];
  error?: string;
}

function normalize(input: PushInput): PushInput {
  const tokens = Array.isArray(input?.tokens)
    ? input.tokens
        .filter((token) => typeof token === "string" && token.length > 20)
        .slice(0, 400)
    : [];
  return {
    tokens,
    title: String(input?.title ?? "Fly").slice(0, 120),
    body: String(input?.body ?? "").slice(0, 300),
    icon: String(input?.icon ?? "").slice(0, 500),
    link: String(input?.link ?? "/").slice(0, 300),
    tag: String(input?.tag ?? "").slice(0, 80),
    convId: String(input?.convId ?? "").slice(0, 120),
  };
}

export const sendPushNotification = createServerFn({ method: "POST" })
  .inputValidator((input: PushInput) => normalize(input))
  .handler(async ({ data }): Promise<PushResult> => {
    if (!data.tokens.length) return { sent: 0, invalid: [] };

    const lovableKey = process.env["LOVABLE_API_KEY"];
    const connectionKey = process.env["FIREBASE_MESSAGING_API_KEY"];
    if (!lovableKey || !connectionKey) {
      return { sent: 0, invalid: [], error: "push not configured" };
    }

    const headers = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey,
      "Content-Type": "application/json",
    };

    let sent = 0;
    const invalid: string[] = [];

    await Promise.all(
      data.tokens.map(async (token) => {
        try {
          const res = await fetch(`${GATEWAY_URL}/v1/projects/_/messages:send`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              message: {
                token,
                data: {
                  title: data.title,
                  body: data.body,
                  icon: data.icon ?? "",
                  link: data.link ?? "/",
                  tag: data.tag ?? "",
                  convId: data.convId ?? "",
                },
                webpush: {
                  headers: { Urgency: "high", TTL: "600" },
                  fcm_options: { link: data.link ?? "/" },
                },
                android: { priority: "HIGH" },
                apns: {
                  headers: { "apns-priority": "10" },
                  payload: {
                    aps: {
                      alert: { title: data.title, body: data.body },
                      sound: "default",
                    },
                  },
                },
              },
            }),
          });
          if (res.ok) {
            sent += 1;
            return;
          }
          const errorBody = await res.text();
          console.error(`FCM send failed [${res.status}]: ${errorBody}`);
          if (res.status === 404 || res.status === 400) invalid.push(token);
        } catch (error) {
          console.error("FCM send error", error);
        }
      }),
    );

    return { sent, invalid };
  });
