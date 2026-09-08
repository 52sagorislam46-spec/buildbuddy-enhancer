import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Trash2,
  Video,
} from "lucide-react";
import { Avatar } from "./Avatar";
import { useAuth } from "./AuthContext";
import { useCalls } from "./callContext";
import { fetchProfile } from "./chat";
import {
  clearCallHistory,
  deleteCallHistoryItem,
  outcomeLabel,
  watchCallHistory,
  type CallLog,
} from "./callHistory";
import { timeAgo } from "../../lib/time";
import type { UserProfile } from "./types";

export function CallHistoryPage({
  onBack,
  onOpenProfile,
}: {
  onBack: () => void;
  onOpenProfile: (uid: string) => void;
}) {
  const { user } = useAuth();
  const { startCall, busy } = useCalls();
  const [items, setItems] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const unsub = watchCallHistory(user.uid, (rows) => {
      setItems(rows);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  const callBack = async (log: CallLog, type: "audio" | "video") => {
    if (busy) return;
    const profile: UserProfile | null =
      (await fetchProfile(log.otherId)) ??
      ({
        uid: log.otherId,
        username: "user",
        displayName: log.otherName,
        bio: "",
        photoURL: log.otherPhoto,
        followers: [],
        following: [],
        createdAt: Date.now(),
      } as UserProfile);
    await startCall(profile, type);
  };

  return (
    <div className="pb-20">
      <header className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-4 h-14 flex items-center gap-3 z-10">
        <button onClick={onBack} aria-label="Back" className="text-gray-700">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">Calls</h1>
        {items.length > 0 && (
          <button
            onClick={() => user && void clearCallHistory(user.uid)}
            aria-label="Clear call history"
            className="ml-auto w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center active:scale-90 transition-transform"
          >
            <Trash2 size={17} />
          </button>
        )}
      </header>

      {loading ? (
        <p className="text-center text-sm text-gray-400 mt-10">Loading...</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-20 text-gray-400">
          <Phone size={30} />
          <p className="text-sm">No calls yet.</p>
        </div>
      ) : (
        <ul>
          {items.map((log) => {
            const missed = log.outcome === "missed";
            const Icon = missed
              ? PhoneMissed
              : log.direction === "incoming"
                ? PhoneIncoming
                : PhoneOutgoing;
            return (
              <li
                key={log.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-gray-50"
              >
                <button
                  onClick={() => onOpenProfile(log.otherId)}
                  aria-label={`Open ${log.otherName}'s profile`}
                >
                  <Avatar src={log.otherPhoto} alt={log.otherName} size={48} />
                </button>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-[15px] font-semibold truncate ${
                      missed ? "text-red-500" : "text-gray-900"
                    }`}
                  >
                    {log.otherName}
                  </p>
                  <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                    <Icon
                      size={13}
                      className={missed ? "text-red-500" : "text-gray-400"}
                    />
                    {outcomeLabel(log)} · {timeAgo(log.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => void callBack(log, "audio")}
                  aria-label={`Call ${log.otherName}`}
                  className="w-9 h-9 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <Phone size={17} />
                </button>
                <button
                  onClick={() => void callBack(log, "video")}
                  aria-label={`Video call ${log.otherName}`}
                  className="w-9 h-9 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <Video size={17} />
                </button>
                <button
                  onClick={() => void deleteCallHistoryItem(log.id)}
                  aria-label="Delete this call log"
                  className="w-8 h-8 rounded-full text-gray-400 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
