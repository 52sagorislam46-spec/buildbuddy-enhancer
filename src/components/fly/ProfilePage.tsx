import { useEffect, useState } from "react";
import { ArrowLeft, Bell, Check, Eye, Globe, LayoutGrid, LogOut, Menu, MessageCircle, Moon, Play, Rows3, Settings, Share2, SquarePlay, Users, UserSquare, X } from "lucide-react";
import { arrayRemove, arrayUnion, doc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { PostCard } from "./PostCard";
import { useAuth } from "./AuthContext";
import { fetchProfile } from "./chat";
import { usePosts } from "./usePosts";
import { formatViews } from "./views";
import { NotificationSettingsModal } from "./NotificationSettingsModal";
import { EditProfileModal } from "./EditProfileModal";
import { EditProfilePage } from "./EditProfilePage";
import { MembersPage } from "./MembersPage";
import { useDarkMode } from "./theme";
import { isAdmin } from "./admins";
import type { UserProfile } from "./types";

export function ProfilePage({
  uid,
  onBack,
  onOpenChat,
  onOpenProfile,
}: {
  uid: string;
  onBack?: () => void;
  onOpenChat: (profile: UserProfile) => void;
  onOpenProfile: (uid: string) => void;
}) {
  const { user, profile: myProfile, logOut, refreshProfile } = useAuth();
  const { posts, loadingMore, hasMore, loadMore } = usePosts();
  const [target, setTarget] = useState<UserProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNotifySettings, setShowNotifySettings] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showEditPage, setShowEditPage] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const { dark, toggle: toggleDark } = useDarkMode();
  const [showLanguage, setShowLanguage] = useState(false);
  const [language, setLanguage] = useState<string>(() => {
    try {
      return localStorage.getItem("app_language") || "en";
    } catch {
      return "en";
    }
  });
  const [tab, setTab] = useState<"grid" | "reels" | "tagged" | "list">("grid");
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [people, setPeople] = useState<{ title: string; uids: string[] } | null>(
    null,
  );
  const [peopleList, setPeopleList] = useState<UserProfile[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const shareProfile = async () => {
    if (!target) return;
    const url =
      typeof window === "undefined"
        ? ""
        : `${window.location.origin}/?user=${target.uid}`;
    const data = {
      title: target.displayName,
      text: `@${target.username} on Fly`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard?.writeText(url);
    } catch {
      /* ignore */
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1800);
  };

  useEffect(() => {
    if (!people) {
      setPeopleList([]);
      return;
    }
    let alive = true;
    setPeopleLoading(true);
    Promise.all(people.uids.map((id) => fetchProfile(id).catch(() => null)))
      .then((list) => {
        if (!alive) return;
        setPeopleList(list.filter(Boolean) as UserProfile[]);
      })
      .finally(() => {
        if (alive) setPeopleLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [people]);


  const isMe = user?.uid === uid;

  useEffect(() => {
    let alive = true;
    if (isMe && myProfile) {
      setTarget(myProfile);
      return;
    }
    fetchProfile(uid).then((p) => {
      if (alive) setTarget(p);
    });
    return () => {
      alive = false;
    };
  }, [uid, isMe, myProfile]);

  const following = !!user && !!target && target.followers.includes(user.uid);

  // Mutual friends: people I follow who also follow this profile.
  const myFollowing = myProfile?.following ?? [];
  const mutualIds =
    !isMe && target
      ? target.followers.filter(
          (id) => id !== user?.uid && myFollowing.includes(id),
        )
      : [];
  const [mutualProfiles, setMutualProfiles] = useState<UserProfile[]>([]);
  useEffect(() => {
    let alive = true;
    if (mutualIds.length === 0) {
      setMutualProfiles([]);
      return;
    }
    Promise.all(
      mutualIds.slice(0, 3).map((id) => fetchProfile(id).catch(() => null)),
    ).then((list) => {
      if (alive)
        setMutualProfiles(list.filter(Boolean) as UserProfile[]);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, mutualIds.join(",")]);

  const toggleFollow = async () => {
    if (!user || !target || isMe) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "users", target.uid), {
        followers: following ? arrayRemove(user.uid) : arrayUnion(user.uid),
      });
      await updateDoc(doc(db, "users", user.uid), {
        following: following ? arrayRemove(target.uid) : arrayUnion(target.uid),
      });
      const fresh = await fetchProfile(target.uid);
      setTarget(fresh);
      await refreshProfile();
    } finally {
      setBusy(false);
    }
  };

  if (!target) {
    return <p className="text-center text-sm text-gray-400 mt-16">Loading...</p>;
  }

  const userPosts = posts.filter((p) => p.authorId === target.uid);
  const isVideo = (mediaType: string, mediaUrl: string) =>
    !!mediaUrl && (mediaType === "video" || mediaType.startsWith("video"));
  const reelPosts = userPosts.filter((p) => isVideo(p.mediaType, p.mediaUrl));
  const taggedPosts = posts.filter(
    (p) =>
      p.authorId !== target.uid &&
      p.text.toLowerCase().includes(`@${target.username.toLowerCase()}`),
  );
  const gridPosts =
    tab === "reels" ? reelPosts : tab === "tagged" ? taggedPosts : userPosts;

  if (showMembers) {
    if (!isAdmin(myProfile, user?.email)) {
      setShowMembers(false);
      return null;
    }
    return <MembersPage onBack={() => setShowMembers(false)} />;
  }

  return (
    <div className="pb-20">
      <header className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-4 h-14 flex items-center gap-3 z-10">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="text-gray-500">
            <ArrowLeft size={22} />
          </button>
        )}
        <h1 className="text-lg font-bold text-gray-900 truncate">
          {target.displayName}
        </h1>
        {isMe && (
          <button
            onClick={() => setShowMenu(true)}
            className="text-gray-500 hover:text-sky-500"
            aria-label="Menu"
          >
            <Menu size={22} />
          </button>
        )}
      </header>

      {isMe && showMenu && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowMenu(false)}
          />
          <div className="relative w-72 max-w-[85%] h-full bg-white shadow-xl flex flex-col">
            <div className="h-14 px-4 flex items-center justify-between border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Menu</h2>
              <button
                onClick={() => setShowMenu(false)}
                aria-label="Close menu"
                className="text-gray-400"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-3 space-y-1 overflow-y-auto">
              <button
                onClick={() => {
                  setShowMenu(false);
                  setShowEditPage(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-gray-800 hover:bg-gray-50"
              >
                <Settings size={20} className="text-gray-500" />
                <span className="text-sm font-medium">Edit profile</span>
              </button>
              <button
                onClick={() => {
                  setShowMenu(false);
                  setShowNotifySettings(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-gray-800 hover:bg-gray-50"
              >
                <Bell size={20} className="text-gray-500" />
                <span className="text-sm font-medium">Notification settings</span>
              </button>
              <button
                onClick={() => setShowLanguage((v) => !v)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-gray-800 hover:bg-gray-50"
              >
                <Globe size={20} className="text-gray-500" />
                <span className="text-sm font-medium flex-1">Language</span>
                <span className="text-xs text-gray-400">
                  {language === "bn" ? "বাংলা" : "English"}
                </span>
              </button>
              {showLanguage && (
                <div className="mx-3 mb-1 rounded-xl border border-gray-100 overflow-hidden">
                  {[
                    { code: "en", label: "English" },
                    { code: "bn", label: "বাংলা" },
                  ].map((l) => (
                    <button
                      key={l.code}
                      onClick={() => {
                        setLanguage(l.code);
                        try {
                          localStorage.setItem("app_language", l.code);
                        } catch {
                          /* ignore */
                        }
                        setShowLanguage(false);
                      }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50 ${
                        language === l.code
                          ? "text-sky-600 font-semibold"
                          : "text-gray-700"
                      }`}
                    >
                      <span>{l.label}</span>
                      {language === l.code && <Check size={16} />}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={toggleDark}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-gray-800 hover:bg-gray-50"
              >
                <Moon size={20} className="text-gray-500" />
                <span className="text-sm font-medium flex-1">Dark theme</span>
                <span
                  className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${
                    dark ? "bg-sky-500" : "bg-gray-200"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      dark ? "translate-x-4" : ""
                    }`}
                  />
                </span>
              </button>
              {isAdmin(myProfile, user?.email) && (
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowMembers(true);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-gray-800 hover:bg-gray-50"
                >
                  <Users size={20} className="text-gray-500" />
                  <span className="text-sm font-medium">Members</span>
                </button>
              )}
              <button
                onClick={() => {
                  setShowMenu(false);
                  logOut();
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-rose-600 hover:bg-rose-50"
              >
                <LogOut size={20} />
                <span className="text-sm font-medium">Log out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="px-5 pt-6 pb-5 bg-gradient-to-b from-sky-50 to-white">
        <div className="flex items-center gap-4">
          <Avatar
            src={target.photoURL}
            alt={target.displayName}
            size={76}
            className="ring-4 ring-white"
          />
          <div className="flex-1 flex items-center justify-around text-center">
            <button
              type="button"
              onClick={() => {
                setTab("grid");
                document
                  .getElementById("profile-posts")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="px-2 py-1 rounded-xl active:bg-gray-100 transition-colors"
            >
              <p className="text-lg font-bold text-gray-900">{userPosts.length}</p>
              <p className="text-xs text-gray-400">Posts</p>
            </button>
            <button
              type="button"
              onClick={() => setPeople({ title: "Followers", uids: target.followers })}
              className="px-2 py-1 rounded-xl active:bg-gray-100 transition-colors"
            >
              <p className="text-lg font-bold text-gray-900">
                {target.followers.length}
              </p>
              <p className="text-xs text-gray-400">Followers</p>
            </button>
            <button
              type="button"
              onClick={() => setPeople({ title: "Following", uids: target.following })}
              className="px-2 py-1 rounded-xl active:bg-gray-100 transition-colors"
            >
              <p className="text-lg font-bold text-gray-900">
                {target.following.length}
              </p>
              <p className="text-xs text-gray-400">Following</p>
            </button>
          </div>

        </div>
        <h2 className="mt-4 text-base font-bold text-gray-900">
          {target.displayName}
        </h2>
        <p className="text-sm text-gray-400">@{target.username}</p>
        {target.bio && (
          <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">
            {target.bio}
          </p>
        )}

        {!isMe && mutualIds.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setPeople({ title: "Mutual friends", uids: mutualIds })
            }
            className="mt-3 w-full flex items-center gap-2.5 rounded-2xl bg-white border border-gray-100 px-3 py-2.5 text-left active:bg-gray-50 transition-colors"
          >
            <span className="flex -space-x-2.5 shrink-0">
              {mutualProfiles.slice(0, 3).map((m) => (
                <Avatar
                  key={m.uid}
                  src={m.photoURL}
                  alt={m.displayName}
                  size={26}
                  className="ring-2 ring-white"
                />
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">
                {mutualIds.length} mutual friend{mutualIds.length > 1 ? "s" : ""}
              </span>
              {mutualProfiles.length > 0 && (
                <span className="block text-xs text-gray-400 truncate">
                  {mutualProfiles.map((m) => m.displayName).join(", ")}
                  {mutualIds.length > mutualProfiles.length ? "…" : ""}
                </span>
              )}
            </span>
          </button>
        )}


        {isMe && (
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => setShowEditProfile(true)}
              className="flex-1 h-11 rounded-2xl font-semibold text-sm bg-white border border-sky-200 text-sky-600 active:scale-[0.98] transition-all"
            >
              Edit profile
            </button>
            <button
              onClick={() => void shareProfile()}
              className="flex-1 h-11 rounded-2xl font-semibold text-sm bg-white border border-sky-200 text-sky-600 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              {shareCopied ? <Check size={17} /> : <Share2 size={17} />}
              {shareCopied ? "Link copied" : "Share profile"}
            </button>
          </div>
        )}

        {!isMe && (
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={toggleFollow}
              disabled={busy}
              className={`flex-1 h-11 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-60 ${
                following
                  ? "bg-gray-100 text-gray-700"
                  : "bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-md shadow-sky-200"
              }`}
            >
              {following ? "Following" : "Follow"}
            </button>
            <button
              onClick={() => onOpenChat(target)}
              className="flex-1 h-11 rounded-2xl font-semibold text-sm bg-white border border-sky-200 text-sky-600 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              <MessageCircle size={17} />
              Message
            </button>
          </div>
        )}
      </section>

      <div id="profile-posts" className="border-t border-gray-100 flex">
        {([
          { key: "grid", label: "Grid view", Icon: LayoutGrid },
          { key: "reels", label: "Reels", Icon: SquarePlay },
          { key: "tagged", label: "Tagged", Icon: UserSquare },
          { key: "list", label: "List view", Icon: Rows3 },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-label={label}
            className={`flex-1 h-11 flex items-center justify-center border-b-2 transition-colors ${
              tab === key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-400"
            }`}
          >
            <Icon size={20} />
          </button>
        ))}
      </div>

      <div>
        {tab === "list" ? (
          userPosts.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">No posts yet.</p>
          ) : (
            userPosts.map((p) => (
              <PostCard key={p.id} post={p} onOpenProfile={onOpenProfile} />
            ))
          )
        ) : gridPosts.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            {tab === "reels"
              ? "No reels yet."
              : tab === "tagged"
                ? "No tagged posts yet."
                : "No posts yet."}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-[2px]">
            {gridPosts.map((p) => (
              <button
                key={p.id}
                onClick={() => setOpenPostId(p.id)}
                className="relative aspect-square bg-gray-100 overflow-hidden"
              >
                {isVideo(p.mediaType, p.mediaUrl) ? (
                  <>
                    <video
                      src={p.mediaUrl}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <Play
                      size={18}
                      className="absolute top-1.5 right-1.5 text-white drop-shadow"
                      fill="currentColor"
                    />
                    <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[11px] font-semibold text-white drop-shadow">
                      <Eye size={13} />
                      {formatViews(p.views ?? 0)}
                    </span>
                  </>
                ) : p.mediaUrl ? (
                  <img
                    src={p.mediaUrl}
                    alt={p.text || "Post"}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="absolute inset-0 p-2 text-[11px] text-gray-600 text-left overflow-hidden">
                    {p.text}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {hasMore && (
        <div className="flex justify-center px-4 py-5">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-full bg-gray-50 px-4 py-2 text-xs font-semibold text-sky-600 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load older posts"}
          </button>
        </div>
      )}

      {openPostId && (
        <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto">
          <div className="mx-auto w-full max-w-md min-h-full bg-white">
            <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 h-14 px-4 flex items-center gap-3">
              <button
                onClick={() => setOpenPostId(null)}
                aria-label="Close post"
                className="text-gray-500"
              >
                <ArrowLeft size={22} />
              </button>
              <h2 className="text-base font-bold text-gray-900">Post</h2>
            </div>
            {posts
              .filter((p) => p.id === openPostId)
              .map((p) => (
                <PostCard key={p.id} post={p} onOpenProfile={onOpenProfile} />
              ))}
          </div>
        </div>
      )}


      {people && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center"
          onClick={() => setPeople(null)}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">
                {people.title}
              </h3>
              <button
                onClick={() => setPeople(null)}
                className="text-sm text-sky-600 font-semibold"
              >
                Close
              </button>
            </div>
            {peopleLoading ? (
              <p className="text-center text-sm text-gray-400 py-10">Loading…</p>
            ) : peopleList.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-10">
                No {people.title.toLowerCase()} yet.
              </p>
            ) : (
              <ul className="p-2">
                {peopleList.map((p) => (
                  <li key={p.uid}>
                    <button
                      onClick={() => {
                        setPeople(null);
                        onOpenProfile(p.uid);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left active:bg-gray-100"
                    >
                      <Avatar src={p.photoURL} alt={p.displayName} size={44} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-900">
                          {p.displayName}
                        </span>
                        <span className="block truncate text-xs text-gray-400">
                          @{p.username}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showNotifySettings && (

        <NotificationSettingsModal
          onClose={() => setShowNotifySettings(false)}
        />
      )}
      {showEditProfile && (
        <EditProfileModal onClose={() => setShowEditProfile(false)} />
      )}
      {showEditPage && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
          <div className="mx-auto w-full max-w-md">
            <EditProfilePage onBack={() => setShowEditPage(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
