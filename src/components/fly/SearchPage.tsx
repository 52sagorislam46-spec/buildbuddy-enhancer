import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { collection, limit, onSnapshot, query } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { toMillis } from "./chat";
import type { UserProfile } from "./types";

export function SearchPage({
  onOpenProfile,
  onBack,
}: {
  onOpenProfile: (uid: string) => void;
  onBack?: () => void;
}) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [term, setTerm] = useState("");

  useEffect(() => {
    return onSnapshot(query(collection(db, "users"), limit(100)), (snap) => {
      setUsers(
        snap.docs.map((d) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data: any = d.data();
          return {
            uid: d.id,
            username: data.username ?? "user",
            displayName: data.displayName ?? "Anonymous",
            bio: data.bio ?? "",
            photoURL: data.photoURL ?? "",
            followers: data.followers ?? [],
            following: data.following ?? [],
            createdAt: toMillis(data.createdAt),
          };
        }),
      );
    });
  }, []);

  const results = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q),
    );
  }, [users, term]);

  return (
    <div className="pb-20">
      <header className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-4 h-16 flex items-center gap-2 z-10">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-gray-600 active:scale-90 transition-transform"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="relative w-full">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search people"
            className="w-full h-10 pl-10 pr-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
          />
        </div>
      </header>
      <ul>
        {results.map((u) => (
          <li key={u.uid}>
            <button
              onClick={() => onOpenProfile(u.uid)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left active:bg-gray-50"
            >
              <Avatar src={u.photoURL} alt={u.displayName} size={44} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {u.displayName}
                </p>
                <p className="text-xs text-gray-400 truncate">@{u.username}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
