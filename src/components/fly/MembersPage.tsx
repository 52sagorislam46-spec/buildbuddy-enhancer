import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  Mail,
  MoreVertical,
  Pause,
  Phone,
  Play,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth, db } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import {
  SUSPEND_DAY_OPTIONS,
  resumeMember,
  suspendMember,
  suspendedUntil,
} from "./moderation";
import type { UserProfile } from "./types";


function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in (value as object)) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === "number" ? value : 0;
}

export function MembersPage({ onBack }: { onBack: () => void }) {
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [menuUid, setMenuUid] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [notice, setNotice] = useState("");


  useEffect(() => {
    let alive = true;
    getDocs(collection(db, "users"))
      .then((snap) => {
        if (!alive) return;
        const list = snap.docs.map((d) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data: any = d.data();
          return {
            uid: d.id,
            username: data.username ?? "",
            displayName: data.displayName ?? "Anonymous",
            bio: data.bio ?? "",
            photoURL: data.photoURL ?? "",
            phone: data.phone ?? "",
            email: data.email ?? "",
            birthDate: data.birthDate ?? "",
            gender: data.gender ?? "",
            pronoun: data.pronoun ?? "",
            country: data.country ?? "",
            preferredLanguage: data.preferredLanguage ?? "",
            followers: data.followers ?? [],
            following: data.following ?? [],
            suspendedUntil: data.suspendedUntil ?? 0,
            suspendedReason: data.suspendedReason ?? "",
            createdAt: toMillis(data.createdAt),
          } as UserProfile;
        });
        list.sort((a, b) => b.createdAt - a.createdAt);
        setMembers(list);
      })
      .catch(() => setError("Could not load members."))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (uid: string) => {
    if (!window.confirm("Remove this member from the list?")) return;
    setRemoving(uid);
    setError("");
    try {
      await deleteDoc(doc(db, "users", uid));
      setMembers((list) => list.filter((m) => m.uid !== uid));
    } catch {
      setError("Could not remove this member.");
    } finally {
      setRemoving(null);
    }
  };

  const suspend = async (m: UserProfile, days: number) => {
    setMenuUid(null);
    setBusyUid(m.uid);
    setError("");
    try {
      const until = await suspendMember({
        uid: m.uid,
        days,
        displayName: m.displayName,
      });
      setMembers((list) =>
        list.map((x) => (x.uid === m.uid ? { ...x, suspendedUntil: until } : x)),
      );
    } catch {
      setError("Could not suspend this member.");
    } finally {
      setBusyUid(null);
    }
  };

  const resume = async (m: UserProfile) => {
    setMenuUid(null);
    setBusyUid(m.uid);
    setError("");
    try {
      await resumeMember(m.uid);
      setMembers((list) =>
        list.map((x) => (x.uid === m.uid ? { ...x, suspendedUntil: 0 } : x)),
      );
    } catch {
      setError("Could not resume this member.");
    } finally {
      setBusyUid(null);
    }
  };

  const sendReset = async (m: UserProfile) => {
    setMenuUid(null);
    setError("");
    setNotice("");
    if (!m.email) {
      setError("This member has no email address.");
      return;
    }
    setBusyUid(m.uid);
    try {
      await sendPasswordResetEmail(auth, m.email);
      setNotice(`Password reset link sent to ${m.email}.`);
    } catch {
      setError("Could not send the reset link.");
    } finally {
      setBusyUid(null);
    }
  };


  return (
    <div className="pb-20 min-h-screen bg-white">
      <header className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-4 h-14 flex items-center gap-3 z-10">
        <button onClick={onBack} aria-label="Back" className="text-gray-500">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold text-gray-900">Members</h1>
        <span className="ml-auto text-xs text-gray-400">{members.length}</span>
      </header>

      {loading && (
        <p className="flex items-center justify-center gap-2 text-sm text-gray-400 mt-16">
          <Loader2 size={16} className="animate-spin" /> Loading...
        </p>
      )}
      {error && (
        <p className="mx-4 mt-4 text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      {notice && (
        <p className="mx-4 mt-4 text-sm text-emerald-600 bg-emerald-50 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}



      <ul className="p-3 space-y-2">
        {members.map((m) => (
          <li
            key={m.uid}
            className="p-3 rounded-2xl border border-gray-100 bg-white"
          >
            <div className="flex items-center gap-3">
              <Avatar src={m.photoURL} alt={m.displayName} size={44} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {m.displayName}
                </p>
                <p className="text-xs text-gray-400 truncate">@{m.username}</p>
                {suspendedUntil(m) > 0 && (
                  <p className="text-[11px] font-semibold text-amber-600">
                    Suspended until{" "}
                    {new Date(suspendedUntil(m)).toLocaleDateString()}
                  </p>
                )}
                <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                  <Phone size={12} /> {m.phone || "—"}
                </p>
                <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                  <Mail size={12} /> {m.email || "—"}
                </p>
              </div>
              <button
                onClick={() =>
                  setOpenUid((v) => (v === m.uid ? null : m.uid))
                }
                aria-label={`Details of ${m.displayName}`}
                className="text-gray-400 hover:text-sky-500 p-2"
              >
                {openUid === m.uid ? (
                  <ChevronUp size={18} />
                ) : (
                  <ChevronDown size={18} />
                )}
              </button>
              <div className="relative">
                <button
                  onClick={() => setMenuUid((v) => (v === m.uid ? null : m.uid))}
                  disabled={removing === m.uid || busyUid === m.uid}
                  aria-label={`More options for ${m.displayName}`}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-50 p-2"
                >
                  {removing === m.uid || busyUid === m.uid ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <MoreVertical size={18} />
                  )}
                </button>
                {menuUid === m.uid && (
                  <>
                    <button
                      aria-label="Close menu"
                      onClick={() => setMenuUid(null)}
                      className="fixed inset-0 z-[90] cursor-default bg-black/30"
                    />
                    <div className="fixed inset-x-0 bottom-0 z-[100] max-h-[80vh] overflow-y-auto rounded-t-3xl border border-gray-100 bg-white shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-9 sm:w-52 sm:rounded-2xl sm:pb-0">
                      <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-gray-200 sm:hidden" />

                      {suspendedUntil(m) ? (
                        <button
                          onClick={() => void resume(m)}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-emerald-600 hover:bg-emerald-50"
                        >
                          <Play size={14} /> Resume account
                        </button>
                      ) : (
                        <>
                          <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                            <Pause size={11} /> Suspend account
                          </p>
                          {SUSPEND_DAY_OPTIONS.map((d) => (
                            <button
                              key={d}
                              onClick={() => void suspend(m, d)}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              {d} day{d > 1 ? "s" : ""}
                            </button>
                          ))}
                        </>
                      )}
                      <button
                        onClick={() => void sendReset(m)}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-sky-600 border-t border-gray-100 hover:bg-sky-50"
                      >
                        <KeyRound size={14} /> Send password reset link
                      </button>
                      <button

                        onClick={() => {
                          setMenuUid(null);
                          void remove(m.uid);
                        }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-600 border-t border-gray-100 hover:bg-rose-50"
                      >
                        <Trash2 size={14} /> Delete member
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {openUid === m.uid && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5 text-xs text-gray-600">
                <p className="flex items-center gap-2">
                  <Users size={13} className="text-gray-400" />
                  Followers: <span className="font-semibold">{m.followers.length}</span>
                  <UserCheck size={13} className="text-gray-400 ml-2" />
                  Following: <span className="font-semibold">{m.following.length}</span>
                </p>
                <p>
                  <span className="text-gray-400">Joined: </span>
                  {m.createdAt
                    ? new Date(m.createdAt).toLocaleString()
                    : "—"}
                </p>
                <p className="break-all">
                  <span className="text-gray-400">User ID: </span>
                  {m.uid}
                </p>
                <p>
                  <span className="text-gray-400">Birth date: </span>
                  {m.birthDate || "—"}
                </p>
                <p>
                  <span className="text-gray-400">Gender: </span>
                  {m.gender || "—"}
                  <span className="text-gray-400 ml-3">Pronoun: </span>
                  {m.pronoun || "—"}
                </p>
                <p>
                  <span className="text-gray-400">Country: </span>
                  {m.country || "—"}
                  <span className="text-gray-400 ml-3">Language: </span>
                  {m.preferredLanguage || "—"}
                </p>
                <p className="whitespace-pre-wrap">
                  <span className="text-gray-400">Bio: </span>
                  {m.bio || "—"}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!loading && !members.length && (
        <p className="text-center text-sm text-gray-400 mt-10">No members yet.</p>
      )}
    </div>
  );
}
