import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Bell,
  BellOff,
  Eye,
  EyeOff,
  MailOpen,
  Phone,
  Pin,
  PinOff,
  Search,
  ShieldOff,
  Trash2,
  UsersRound,
} from "lucide-react";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { useAuth } from "./AuthContext";
import { fetchProfile, groupFromData, toMillis } from "./chat";
import { setBlocked } from "./blocks";
import { GroupCreateModal } from "./GroupCreateModal";
import {
  getPrefs,
  setPrefs,
  subscribePrefs,
  togglePref,
  type ChatPrefs,
} from "./chatPrefs";
import {
  cacheReadAt,
  isConversationUnread,
  markConversationRead,
  readAtFromData,
} from "./readState";
import { StoriesBar } from "./Stories";
import { subscribePresence, type PresenceState } from "./presence";
import { timeAgo } from "../../lib/time";
import type {
  Conversation,
  GroupConversation,
  UserProfile,
} from "./types";

const ONLINE_WINDOW_MS = 2 * 60_000;
/** A phone with notifications on stays "online" for a while after the app closes. */
const REACHABLE_WINDOW_MS = 5 * 60_000;

function isOnline(p: PresenceState | undefined): boolean {
  if (!p) return false;
  const age = Date.now() - p.lastSeen;
  if (p.online && age < ONLINE_WINDOW_MS) return true;
  // A closed app whose phone still accepts notifications counts as reachable,
  // measured from the last time the device confirmed it.
  const reachAge = Date.now() - (p.reachableAt || p.lastSeen);
  return p.reachable && reachAge < REACHABLE_WINDOW_MS;
}


function presenceLabel(p: PresenceState | undefined): string | null {
  if (!p || !p.lastSeen) return null;
  if (isOnline(p)) return "Active now";
  return `Active ${timeAgo(p.lastSeen)} ago`;
}

export function MessagesPage({
  onOpenChat,
  onOpenGroup,
  onOpenCalls,
}: {
  onOpenChat: (profile: UserProfile) => void;
  onOpenGroup?: (group: GroupConversation) => void;
  onOpenCalls?: () => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [presence, setPresence] = useState<Record<string, PresenceState | null>>(
    {},
  );
  const [prefsVersion, setPrefsVersion] = useState(0);
  const [readAtMap, setReadAtMap] = useState<Record<string, number>>({});
  const [menuFor, setMenuFor] = useState<Conversation | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [view, setView] = useState<"inbox" | "archived" | "hidden" | "blocked">(
    "inbox",
  );

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribePrefs(() => setPrefsVersion((v) => v + 1));
    return () => {
      unsub();
    };
  }, []);

  const prefsOf = useCallback(
    (otherId: string): ChatPrefs => {
      void prefsVersion;
      return getPrefs(otherId);
    },
    [prefsVersion],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = items.filter((c) => {
      const p = getPrefs(c.otherId);
      if (view === "blocked") return p.blocked;
      if (p.blocked) return false;
      if (view === "hidden") return p.hidden;
      if (p.hidden) return false;
      return view === "archived" ? p.archived : !p.archived;
    });
    void prefsVersion;
    const matched = !term
      ? base
      : base.filter(
          (c) =>
            (c.group?.name || c.otherProfile.displayName)
              .toLowerCase()
              .includes(term) ||
            c.otherProfile.username.toLowerCase().includes(term) ||
            (c.group?.members || []).some((member) =>
              `${member.displayName} ${member.username}`
                .toLowerCase()
                .includes(term),
            ),
        );
    return [...matched].sort((a, b) => {
      const pa = getPrefs(a.otherId).pinned ? 1 : 0;
      const pb = getPrefs(b.otherId).pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return b.lastMessageAt - a.lastMessageAt;
    });
  }, [items, search, prefsVersion, view]);

  const counts = useMemo(() => {
    void prefsVersion;
    let archived = 0;
    let hidden = 0;
    let blocked = 0;
    for (const c of items) {
      const p = getPrefs(c.otherId);
      if (p.blocked) blocked++;
      else if (p.hidden) hidden++;
      else if (p.archived) archived++;
    }
    return { archived, hidden, blocked };
  }, [items, prefsVersion]);


  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid),
    );
    return onSnapshot(
      q,
      async (snap) => {
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: any = d.data();
            if (data.type === "group") {
              const group = groupFromData(d.id, data);
              return {
                id: d.id,
                type: "group",
                otherId: d.id,
                otherProfile: {
                  uid: d.id,
                  username: "group",
                  displayName: group.name,
                  bio: "",
                  photoURL: group.photoURL,
                  followers: [],
                  following: [],
                  createdAt: group.createdAt,
                },
                group,
                lastMessage: data.lastMessage ?? "",
                lastMessageAt: toMillis(data.lastMessageAt),
                lastSenderId: data.lastSenderId ?? "",
              } as Conversation;
            }
            const otherId = (data.participants ?? []).find(
              (p: string) => p !== user.uid,
            );
            if (!otherId) return null;
            const profile = await fetchProfile(otherId);
            if (!profile) return null;
            return {
              id: d.id,
              type: "direct",
              otherId,
              otherProfile: profile,
              lastMessage: data.lastMessage ?? "",
              lastMessageAt: toMillis(data.lastMessageAt),
              lastSenderId: data.lastSenderId ?? "",
            } as Conversation;
          }),
        );
        if (user) {
          const map: Record<string, number> = {};
          snap.docs.forEach((d) => {
            const at = readAtFromData(d.data(), user.uid);
            if (at) {
              map[d.id] = at;
              cacheReadAt(d.id, at);
            }
          });
          setReadAtMap(map);
        }
        setItems(
          rows
            .filter((r): r is Conversation => !!r)
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [user]);

  // subscribe to each conversation partner's online / last-seen status
  useEffect(() => {
    const unsubs = items
      .filter((c) => c.type !== "group")
      .map((c) =>
      subscribePresence(c.otherId, (state) =>
        setPresence((prev) =>
          prev[c.otherId] === state ? prev : { ...prev, [c.otherId]: state },
        ),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [items]);

  const openMenu = (c: Conversation) => setMenuFor(c);
  const holdStart = (c: Conversation) => {
    pressTimer.current = setTimeout(() => openMenu(c), 500);
  };
  const holdEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const menuPrefs = menuFor ? prefsOf(menuFor.otherId) : null;

  return (
    <div className="pb-20">
      <header className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-5 h-14 flex items-center z-10">
        <h1 className="text-xl font-bold text-gray-900">Messages</h1>
        {onOpenGroup && (
          <button
            onClick={() => setCreatingGroup(true)}
            aria-label="Create group"
            title="New group"
            className="ml-auto w-9 h-9 rounded-full bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600 active:scale-90 transition-transform"
          >
            <UsersRound size={18} />
          </button>
        )}
        {onOpenCalls && (
          <button
            onClick={onOpenCalls}
            aria-label="Call history"
            className={`${onOpenGroup ? "" : "ml-auto"} w-9 h-9 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 active:scale-90 transition-transform`}
          >
            <Phone size={18} />
          </button>
        )}
      </header>

      {/* inbox / archived / hidden / blocked switcher */}
      <div className="flex gap-2 overflow-x-auto px-4 pt-3">
        {(
          [
            ["inbox", "Inbox", null],
            ["archived", "Archived", counts.archived],
            ["hidden", "Hidden", counts.hidden],
            ["blocked", "Blocked", counts.blocked],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
              view === key
                ? "bg-sky-500 text-white"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {label}
            {count ? ` (${count})` : ""}
          </button>
        ))}
      </div>


      {/* search bar (Messenger style) */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 h-10 px-4 rounded-full bg-gray-100">
          <Search size={17} className="text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search conversations"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none"
          />
        </div>
      </div>

      {/* stories row (Messenger style) */}
      <StoriesBar />

      {loading ? (
        <p className="text-center text-sm text-gray-400 mt-10">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-gray-400 mt-10 px-8">
          {view === "archived"
            ? "No archived chats."
            : view === "hidden"
              ? "No hidden chats."
              : view === "blocked"
                ? "No blocked chats."
                : items.length === 0
                  ? "No conversations yet. Open a profile and tap Message to start chatting."
                  : "No conversations match your search."}
        </p>

      ) : (
        <ul>
          {filtered.map((c) => {
            const p = presence[c.otherId] ?? undefined;
            const online = isOnline(p);
            const label = presenceLabel(p);
            const pref = prefsOf(c.otherId);
            // Auto-unread: someone else sent the latest message and it
            // arrived after the last time this chat was opened. Clears as
            // soon as the user enters the conversation (markOpened).
            void prefsVersion;
            const autoUnread = isConversationUnread({
              convId: c.id,
              lastSenderId: c.lastSenderId ?? "",
              lastMessageAt: c.lastMessageAt,
              readAt: readAtMap[c.id] ?? 0,
              uid: user?.uid ?? "",
            });
            const isUnread = pref.unread || autoUnread;
            return (
              <li key={c.otherId}>
                <button
                  onClick={() => {
                    if (pref.unread) setPrefs(c.otherId, { unread: false });
                    if (user) void markConversationRead(c.id, user.uid);
                    if (c.type === "group" && c.group && onOpenGroup) {
                      onOpenGroup(c.group);
                    } else {
                      onOpenChat(c.otherProfile);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(c);
                  }}
                  onTouchStart={() => holdStart(c)}
                  onTouchEnd={holdEnd}
                  onTouchMove={holdEnd}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left active:bg-gray-50"
                >
                  <span className="relative shrink-0">
                    {c.type === "group" && !c.group?.photoURL ? (
                      <span className="relative block w-12 h-12">
                        {(c.group?.members ?? []).slice(0, 2).map((member, i) => (
                          <span
                            key={member.uid}
                            className={`absolute rounded-full overflow-hidden border-2 border-white ${
                              i === 0 ? "top-0 left-0" : "bottom-0 right-0"
                            }`}
                          >
                            <Avatar
                              src={member.photoURL}
                              alt={member.displayName}
                              size={32}
                            />
                          </span>
                        ))}
                        {(c.group?.members ?? []).length === 0 && (
                          <span className="absolute inset-0 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-base font-bold">
                            {(c.group?.name || "G").charAt(0).toUpperCase()}
                          </span>
                        )}
                      </span>
                    ) : (
                      <Avatar
                        src={c.otherProfile.photoURL}
                        alt={c.otherProfile.displayName}
                        size={48}
                      />
                    )}
                    {c.type !== "group" && online && (
                      <span
                        aria-label="Online"
                        className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-white"
                      />
                    )}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {c.group?.name || pref.nickname || c.otherProfile.displayName}
                      </p>
                      {pref.pinned && (
                        <Pin size={13} className="text-gray-400 shrink-0" />
                      )}
                      {pref.muted && (
                        <BellOff size={13} className="text-gray-400 shrink-0" />
                      )}
                      <span className="text-xs text-gray-400 ml-auto shrink-0">
                        {timeAgo(c.lastMessageAt)}
                      </span>
                      {isUnread && (
                        <span
                          aria-label="Unread messages"
                          className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0"
                        />
                      )}
                    </div>
                    <p
                      className={`text-sm truncate ${
                        isUnread
                          ? "text-gray-900 font-semibold"
                          : "text-gray-500"
                      }`}
                    >
                      {c.lastMessage ||
                        (c.type === "group"
                          ? `${c.group?.members.length || c.group?.participantIds.length || 0} members`
                          : "New conversation")}
                    </p>
                    {c.type !== "group" && label && (
                      <p
                        className={`text-xs truncate ${
                          online ? "text-green-600 font-medium" : "text-gray-400"
                        }`}
                      >
                        {label}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {menuFor && menuPrefs && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={() => setMenuFor(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-3 space-y-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-3 pb-2">
              <Avatar
                src={menuFor.group?.photoURL || menuFor.otherProfile.photoURL}
                alt={menuFor.group?.name || menuFor.otherProfile.displayName}
                size={40}
              />
              <p className="text-sm font-semibold text-gray-900 truncate">
                {menuFor.group?.name ||
                  menuPrefs.nickname ||
                  menuFor.otherProfile.displayName}
              </p>
            </div>

            <button
              onClick={() => {
                togglePref(menuFor.otherId, "pinned");
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              {menuPrefs.pinned ? (
                <PinOff size={18} className="text-gray-400" />
              ) : (
                <Pin size={18} className="text-gray-400" />
              )}
              {menuPrefs.pinned ? "Unpin" : "Pin"}
            </button>

            <button
              onClick={() => {
                togglePref(menuFor.otherId, "archived");
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              {menuPrefs.archived ? (
                <ArchiveRestore size={18} className="text-gray-400" />
              ) : (
                <Archive size={18} className="text-gray-400" />
              )}
              {menuPrefs.archived ? "Unarchive" : "Archive"}
            </button>

            <button
              onClick={() => {
                togglePref(menuFor.otherId, "muted");
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              {menuPrefs.muted ? (
                <Bell size={18} className="text-gray-400" />
              ) : (
                <BellOff size={18} className="text-gray-400" />
              )}
              {menuPrefs.muted ? "Unmute" : "Mute"}
            </button>

            <button
              onClick={() => {
                setPrefs(menuFor.otherId, { unread: !menuPrefs.unread });
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              <MailOpen size={18} className="text-gray-400" />
              {menuPrefs.unread ? "Mark as read" : "Mark as unread"}
            </button>

            <button
              onClick={() => {
                setPrefs(menuFor.otherId, { hidden: !menuPrefs.hidden });
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
            >
              {menuPrefs.hidden ? (
                <Eye size={18} className="text-gray-400" />
              ) : (
                <EyeOff size={18} className="text-gray-400" />
              )}
              {menuPrefs.hidden ? "Unhide chat" : "Hide chat"}
            </button>

            {!menuFor.group && (
              <button
                onClick={() => {
                  const next = !menuPrefs.blocked;
                  setPrefs(menuFor.otherId, { blocked: next });
                  if (user) void setBlocked(user.uid, menuFor.otherId, next);
                  setMenuFor(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-gray-700 hover:bg-gray-50"
              >
                {menuPrefs.blocked ? (
                  <ShieldOff size={18} className="text-gray-400" />
                ) : (
                  <Ban size={18} className="text-gray-400" />
                )}
                {menuPrefs.blocked ? "Unblock" : "Block"}
              </button>
            )}


            <button
              onClick={() => {
                setPrefs(menuFor.otherId, { hidden: true });
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-red-500 hover:bg-red-50"
            >
              <Trash2 size={18} />
              Delete
            </button>

            <button
              onClick={() => setMenuFor(null)}
              className="w-full px-4 py-3 rounded-2xl text-sm text-gray-500 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {creatingGroup && onOpenGroup && (
        <GroupCreateModal
          onClose={() => setCreatingGroup(false)}
          onCreated={(group) => {
            setCreatingGroup(false);
            onOpenGroup(group);
          }}
        />
      )}
    </div>
  );
}
