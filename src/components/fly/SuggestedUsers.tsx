import { useEffect, useState } from "react";
import { ChevronLeft, X } from "lucide-react";
import {
  arrayUnion,
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "./AuthContext";
import { Avatar } from "./Avatar";
import { toMillis } from "./chat";
import type { UserProfile } from "./types";

export function SuggestedUsers({
  onOpenProfile,
}: {
  onOpenProfile: (uid: string) => void;
}) {
  const { user, profile, refreshProfile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    return onSnapshot(query(collection(db, "users"), limit(50)), (snap) => {
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

  if (!user || !profile) return null;

  const suggestions = users.filter(
    (u) =>
      u.uid !== user.uid &&
      !profile.following.includes(u.uid) &&
      !hidden.includes(u.uid),
  );

  if (suggestions.length === 0) return null;

  const follow = async (target: UserProfile) => {
    setBusyId(target.uid);
    try {
      await updateDoc(doc(db, "users", target.uid), {
        followers: arrayUnion(user.uid),
      });
      await updateDoc(doc(db, "users", user.uid), {
        following: arrayUnion(target.uid),
      });
      await refreshProfile();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="border-y border-gray-100 py-3 my-1">
      <div className="flex items-center justify-between px-4 pb-2">
        <p className="text-sm font-semibold text-gray-900">Suggested for you</p>
        <button
          onClick={() => setShowAll(true)}
          className="text-xs font-semibold text-sky-500 active:opacity-60"
        >
          See all
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {suggestions.map((u) => {
          const followsMe = u.followers.includes(user.uid);
          return (
            <div
              key={u.uid}
              className="relative shrink-0 w-36 rounded-2xl border border-gray-100 bg-white px-3 py-4 flex flex-col items-center text-center"
            >
              <button
                onClick={() => setHidden((h) => [...h, u.uid])}
                aria-label="Remove suggestion"
                className="absolute top-2 right-2 text-gray-300 active:text-gray-500"
              >
                <X size={14} />
              </button>
              <button onClick={() => onOpenProfile(u.uid)} className="flex flex-col items-center">
                <Avatar src={u.photoURL} alt={u.displayName} size={64} />
                <p className="mt-2 text-xs font-semibold text-gray-900 truncate w-full">
                  {u.displayName}
                </p>
                <p className="text-[11px] text-gray-400 truncate w-full">
                  {followsMe ? "Follows you" : "Suggested for you"}
                </p>
              </button>
              <button
                onClick={() => void follow(u)}
                disabled={busyId === u.uid}
                className="mt-3 w-full h-8 rounded-lg bg-sky-500 text-white text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
              >
                {followsMe ? "Follow back" : "Follow"}
              </button>
            </div>
          );
        })}
      </div>
      {showAll && (
        <DiscoverPeople
          users={users}
          profile={profile}
          myUid={user.uid}
          busyId={busyId}
          hidden={hidden}
          onHide={(uid) => setHidden((h) => [...h, uid])}
          onFollow={(u) => void follow(u)}
          onOpenProfile={(uid) => {
            setShowAll(false);
            onOpenProfile(uid);
          }}
          onClose={() => setShowAll(false)}
        />
      )}
    </section>
  );
}

function DiscoverPeople({
  users,
  profile,
  myUid,
  busyId,
  hidden,
  onHide,
  onFollow,
  onOpenProfile,
  onClose,
}: {
  users: UserProfile[];
  profile: UserProfile;
  myUid: string;
  busyId: string | null;
  hidden: string[];
  onHide: (uid: string) => void;
  onFollow: (u: UserProfile) => void;
  onOpenProfile: (uid: string) => void;
  onClose: () => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const visible = users.filter(
    (u) =>
      u.uid !== myUid &&
      !profile.following.includes(u.uid) &&
      !hidden.includes(u.uid) &&
      !dismissed.includes(u.uid),
  );
  const followBack = visible.filter((u) => u.followers.includes(myUid));
  const suggested = visible.filter((u) => !u.followers.includes(myUid));

  const mutualsOf = (u: UserProfile) =>
    u.followers.filter((id) => profile.following.includes(id));

  const row = (u: UserProfile) => {
    const followsMe = u.followers.includes(myUid);
    const mutuals = mutualsOf(u)
      .map((id) => users.find((x) => x.uid === id))
      .filter((x): x is UserProfile => Boolean(x))
      .slice(0, 3);
    return (
      <div key={u.uid} className="flex items-center gap-3 px-4 py-2.5">
        <button onClick={() => onOpenProfile(u.uid)} className="shrink-0">
          <Avatar src={u.photoURL} alt={u.displayName} size={52} />
        </button>
        <button
          onClick={() => onOpenProfile(u.uid)}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm font-semibold text-gray-900 truncate">
            {u.displayName}
          </p>
          {mutuals.length > 0 ? (
            <span className="flex items-center gap-1.5 mt-0.5">
              <span className="flex -space-x-2">
                {mutuals.map((m) => (
                  <Avatar
                    key={m.uid}
                    src={m.photoURL}
                    alt={m.displayName}
                    size={18}
                  />
                ))}
              </span>
              <span className="text-xs text-gray-500">
                {mutualsOf(u).length} mutual{mutualsOf(u).length > 1 ? "s" : ""}
              </span>
            </span>
          ) : (
            <p className="text-xs text-gray-500 truncate">
              {followsMe ? "Follows you" : "Suggested for you"}
            </p>
          )}
        </button>
        <button
          onClick={() => onFollow(u)}
          disabled={busyId === u.uid}
          className="h-9 px-5 rounded-xl bg-sky-500 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-50 shrink-0"
        >
          {followsMe ? "Follow back" : "Follow"}
        </button>
        <button
          onClick={() => setDismissed((d) => [...d, u.uid])}
          aria-label="Remove suggestion"
          className="text-gray-400 active:text-gray-600 shrink-0 p-1"
        >
          <X size={18} />
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      <div className="flex items-center gap-3 px-2 py-3 border-b border-gray-100 shrink-0">
        <button
          onClick={onClose}
          aria-label="Back"
          className="p-2 text-gray-900 active:opacity-60"
        >
          <ChevronLeft size={26} />
        </button>
        <h1 className="text-lg font-bold text-gray-900">Discover people</h1>
      </div>
      <div className="flex-1 overflow-y-auto pb-8">
        {suggested.length > 0 && (
          <>
            <p className="px-4 pt-4 pb-2 text-base font-bold text-gray-900">
              Suggested for you
            </p>
            {suggested.map(row)}
          </>
        )}
        {followBack.length > 0 && (
          <>
            <p className="px-4 pt-5 pb-2 text-base font-bold text-gray-900">
              Follow back
            </p>
            {followBack.map(row)}
          </>
        )}
        {visible.length === 0 && (
          <p className="text-center text-sm text-gray-400 mt-16">
            No new people to discover right now
          </p>
        )}
      </div>
    </div>
  );
}
