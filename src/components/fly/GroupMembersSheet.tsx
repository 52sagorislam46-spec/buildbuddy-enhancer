import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, MoreVertical, Search, X } from "lucide-react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { useAuth } from "./AuthContext";
import { addGroupMembers, removeGroupMember, setGroupAdmin } from "./chat";
import type { GroupConversation, GroupMember } from "./types";

/**
 * Messenger-style "See chat members" screen: All / Admins tabs, an Add flow and
 * a per-member menu for admin rights and removal.
 */
export function GroupMembersSheet({
  group,
  onClose,
}: {
  group: GroupConversation;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [tab, setTab] = useState<"all" | "admins">("all");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const adminIds = useMemo(
    () => group.adminIds ?? (group.createdBy ? [group.createdBy] : []),
    [group.adminIds, group.createdBy],
  );
  const iAmAdmin = !!user && adminIds.includes(user.uid);
  const shown = tab === "admins" ? group.members.filter((m) => adminIds.includes(m.uid)) : group.members;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update members.");
    } finally {
      setBusy(false);
      setMenuFor(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto pb-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4">
          <button type="button" onClick={onClose} aria-label="Close members" className="text-gray-400">
            <X size={20} />
          </button>
          <div className="text-center">
            <h2 className="text-base font-bold text-gray-900">Members</h2>
            <p className="text-xs text-gray-400">{group.members.length} people</p>
          </div>
          {iAmAdmin ? (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="text-sm font-semibold text-sky-600"
            >
              Add
            </button>
          ) : (
            <span className="w-9" />
          )}
        </div>

        <div className="mx-4 mt-4 grid grid-cols-2 rounded-full bg-gray-100 p-1 text-sm font-semibold">
          {(["all", "admins"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`h-9 rounded-full ${
                tab === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
              }`}
            >
              {key === "all" ? "All" : "Admins"}
            </button>
          ))}
        </div>

        {error && <p className="px-4 pt-3 text-xs text-red-500">{error}</p>}

        <div className="px-4 py-3 space-y-1">
          {shown.map((member) => {
            const isAdmin = adminIds.includes(member.uid);
            return (
              <div key={member.uid} className="relative flex items-center gap-3 py-2">
                <Avatar src={member.photoURL} alt={member.displayName} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 truncate">{member.displayName}</p>
                  <p className="text-xs text-gray-400 truncate">
                    @{member.username}
                    {isAdmin ? " · Admin" : ""}
                  </p>
                </div>
                {iAmAdmin && member.uid !== user?.uid && (
                  <button
                    type="button"
                    aria-label={`Options for ${member.displayName}`}
                    onClick={() => setMenuFor((current) => (current === member.uid ? null : member.uid))}
                    className="shrink-0 text-gray-400"
                  >
                    {busy && menuFor === member.uid ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <MoreVertical size={18} />
                    )}
                  </button>
                )}
                {menuFor === member.uid && (
                  <div className="absolute right-0 top-11 z-10 w-52 rounded-2xl border border-gray-100 bg-white shadow-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => void act(() => setGroupAdmin(group, member.uid, !isAdmin))}
                      className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {isAdmin ? "Remove as admin" : "Make admin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void act(() => removeGroupMember(group, member.uid))}
                      className="w-full text-left px-4 py-3 text-sm text-red-500 hover:bg-red-50"
                    >
                      Remove from group
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {shown.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-400">No admins yet.</p>
          )}
        </div>
      </div>

      {addOpen && (
        <AddMembersSheet group={group} onClose={() => setAddOpen(false)} />
      )}
    </div>
  );
}

function AddMembersSheet({
  group,
  onClose,
}: {
  group: GroupConversation;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<GroupMember[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void getDocs(query(collection(db, "users"), limit(100)))
      .then((snap) => {
        if (!alive) return;
        setPeople(
          snap.docs
            .map((docSnap) => {
              const data = docSnap.data() as Record<string, unknown>;
              return {
                uid: docSnap.id,
                displayName: String(data["displayName"] ?? "Anonymous"),
                username: String(data["username"] ?? "user"),
                photoURL: String(data["photoURL"] ?? ""),
              };
            })
            .filter((person) => !group.participantIds.includes(person.uid)),
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [group.participantIds]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return people;
    return people.filter(
      (person) =>
        person.displayName.toLowerCase().includes(term) ||
        person.username.toLowerCase().includes(term),
    );
  }, [people, search]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl max-h-[80vh] overflow-y-auto p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-900">Add people</h2>
          <button type="button" onClick={onClose} aria-label="Close add people" className="text-gray-400">
            <X size={20} />
          </button>
        </div>
        <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-gray-50 border border-gray-100 mb-3">
          <Search size={16} className="text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people"
            aria-label="Search people"
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        {loading ? (
          <div className="py-8 flex justify-center text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((person) => (
              <button
                key={person.uid}
                type="button"
                onClick={() =>
                  setSelected((current) =>
                    current.includes(person.uid)
                      ? current.filter((id) => id !== person.uid)
                      : [...current, person.uid],
                  )
                }
                className="w-full flex items-center gap-3 py-2"
              >
                <Avatar src={person.photoURL} alt={person.displayName} size={38} />
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-semibold text-gray-800 truncate">{person.displayName}</p>
                  <p className="text-xs text-gray-400 truncate">@{person.username}</p>
                </div>
                <span
                  className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                    selected.includes(person.uid)
                      ? "bg-sky-500 border-sky-500 text-white"
                      : "border-gray-200 text-transparent"
                  }`}
                >
                  <Check size={14} />
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-gray-400">No one left to add.</p>
            )}
          </div>
        )}
        <button
          type="button"
          disabled={selected.length === 0 || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await addGroupMembers(
                group,
                people.filter((person) => selected.includes(person.uid)),
              );
              onClose();
            } finally {
              setSaving(false);
            }
          }}
          className="mt-4 w-full h-11 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving ? "Adding..." : `Add ${selected.length || ""}`.trim()}
        </button>
      </div>
    </div>
  );
}
