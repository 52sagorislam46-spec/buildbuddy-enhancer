import { useState } from "react";
import { Bell, X } from "lucide-react";
import {
  NOTIFY_CHANNELS,
  NOTIFY_EVENTS,
  toggleNotificationSetting,
  useNotificationSettings,
} from "../../lib/notificationSettings";
import { enablePush } from "../../lib/push";
import { useAuth } from "./AuthContext";

export function NotificationSettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useNotificationSettings();
  const { user } = useAuth();
  const [status, setStatus] = useState("");

  const handleToggle = async (
    event: (typeof NOTIFY_EVENTS)[number]["id"],
    channel: (typeof NOTIFY_CHANNELS)[number]["id"],
  ) => {
    const turningOn = !settings[event][channel];
    if (channel === "push" && turningOn) {
      if (!user) return;
      const result = await enablePush(user.uid);
      if (result !== "registered") {
        setStatus(
          result === "open-in-new-tab"
            ? "Open Fly in a new browser tab to enable push notifications."
            : result === "denied"
              ? "Notifications are blocked. Allow them in browser settings and try again."
              : "Push notifications are unavailable on this browser.",
        );
        return;
      }
    }
    setStatus("");
    toggleNotificationSetting(event, channel);
  };

  return (
    <div className="fixed inset-0 z-[65] bg-black/40 flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-y-auto">
        <header className="sticky top-0 bg-white/95 backdrop-blur-xl border-b border-gray-100 px-5 h-14 flex items-center gap-2">
          <Bell size={18} className="text-sky-500" />
          <h2 className="text-base font-bold text-gray-900">
            Notification settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close notification settings"
            className="ml-auto text-gray-400"
          >
            <X size={20} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-6">
          {NOTIFY_EVENTS.map((event) => (
            <section key={event.id}>
              <h3 className="text-sm font-semibold text-gray-900">
                {event.label}
              </h3>
              <p className="text-xs text-gray-400 mb-2">{event.hint}</p>
              <div className="rounded-2xl border border-gray-100 divide-y divide-gray-100">
                {NOTIFY_CHANNELS.map((channel) => {
                  const on = settings[event.id][channel.id];
                  return (
                    <label
                      key={channel.id}
                      className="flex items-center justify-between px-4 py-3 cursor-pointer"
                    >
                      <span className="text-sm text-gray-700">
                        {channel.label}
                      </span>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() => handleToggle(event.id, channel.id)}
                      />
                      <span
                        aria-hidden
                        className={`w-11 h-6 rounded-full transition-colors relative ${
                          on ? "bg-sky-500" : "bg-gray-200"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                            on ? "left-[1.375rem]" : "left-0.5"
                          }`}
                        />
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="text-xs text-gray-400">
            Turn on push here to allow notifications while Fly is closed or in
            the background. If they stay off, allow notifications for this site
            in the browser settings.
          </p>
          {status && <p className="text-xs text-amber-600">{status}</p>}
        </div>
      </div>
    </div>
  );
}
