import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, Users, X } from "lucide-react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { useAuth } from "./AuthContext";
import { createGroupConversation } from "./chat";
import type { GroupConversation, GroupMember, UserProfile } from "./types";

export function GroupCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (group: GroupConversation) => void;
}) {
  const { user, profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void getDocs(query(collection(db, "users"), limit(100)))
      .then((snap) => {
        if (!alive) return;
        setUsers(
          snap.docs
            .map((docSnap) => {
              const data = docSnap.data() as Record<string, unknown>;
              return {
                uid: docSnap.id,
                username: String(data['username'] ?? "user"),
                displayName: String(data['displayName'] ?? "Anonymous"),
                bio: String(data['bio'] ?? ""),
                photoURL: String(data['photoURL'] ?? ""),
                followers: Array.isArray(data['followers'])
                  ? (data['followers'] as string[])
                  : [],
                following: Array.isArray(data['following'])
                  ? (data['following'] as string[])
                  : [],
                createdAt: Number(data['createdAt'] ?? Date.now()),
              };
            })
            .filter((candidate) => candidate.uid !== user?.uid),
        );
      })
      .catch(() => {
        if (alive) setError("Could not load people.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (candidate) =>
        candidate.displayName.toLowerCase().includes(term) ||
        candidate.username.toLowerCase().includes(term),
    );
  }, [search, users]);

  const toggle = (uid: string) => {
    setSelected((current) =>
      current.includes(uid)
        ? current.filter((id) => id !== uid)
        : [...current, uid],
    );
  };

  const submit = async () => {
    if (!user || selected.length === 0) {
      setError("Select at least one person to create a group.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const currentMember: GroupMember = {
        uid: user.uid,
        displayName:
          profile?.displayName || user.displayName || user.email || "You",
        username: profile?.username || "user",
        photoURL: profile?.photoURL || user.photoURL || "",
      };
      const members = [
        currentMember,
        ...users
          .filter((candidate) => selected.includes(candidate.uid))
          .map(
            (candidate): GroupMember => ({
              uid: candidate.uid,
              displayName: candidate.displayName,
              username: candidate.username,
              photoURL: candidate.photoURL,
            }),
          ),
      ];
      const group = await createGroupConversation(
        name,
        members,
        user.uid,
      );
      onCreated(group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create group.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl p-4 max-h-[88vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">New group</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Choose people to start a group chat
            </p>
          </div>
          <button onClick={onClose} aria-label="Close new group">
            <X size={21} className="text-gray-400" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 h-10 px-3 rounded-full bg-gray-100">
          <Search size={16} className="text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people"
            className="flex-1 bg-transparent text-sm outline-none"
            autoFocus
          />
        </div>

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Group name (optional)"
          className="mt-3 h-11 px-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
        />

        <div className="flex-1 overflow-y-auto mt-3 min-h-0">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={22} className="animate-spin text-sky-500" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              No other people found.
            </p>
          ) : (
            <div className="space-y-1">
              {filteredUsers.map((candidate) => {
                const checked = selected.includes(candidate.uid);
                return (
                  <button
                    type="button"
                    key={candidate.uid}
                    onClick={() => toggle(candidate.uid)}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-2xl text-left hover:bg-gray-50"
                  >
                    <Avatar
                      src={candidate.photoURL}
                      alt={candidate.displayName}
                      size={42}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {candidate.displayName}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        @{candidate.username}
                      </p>
                    </div>
                    <span
                      className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                        checked
                          ? "bg-sky-500 border-sky-500 text-white"
                          : "border-gray-200 text-transparent"
                      }`}
                    >
                      <Check size={15} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || selected.length === 0}
          className="mt-3 h-11 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={17} className="animate-spin" />
          ) : (
            <Users size={17} />
          )}
          Create group{selected.length > 0 ? ` (${selected.length + 1})` : ""}
        </button>
      </div>
    </div>
  );
}