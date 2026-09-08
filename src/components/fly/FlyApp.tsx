import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Bell, Bird, Loader2, Pause, Search } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { NotificationsPage } from "./NotificationsPage";
import { useAppNotifications } from "../../lib/appNotifications";
import { AuthProvider, useAuth } from "./AuthContext";
import { CallProvider } from "./CallProvider";
import { GroupCallProvider } from "./GroupCallProvider";
import { AuthPage } from "./AuthPage";
import { suspendedUntil } from "./moderation";
import { BottomNav, type TabId } from "./BottomNav";
import { CreatePostModal } from "./CreatePostModal";
import { ChatView } from "./ChatView";
import { GroupChatView } from "./GroupChatView";
import { MessagesPage } from "./MessagesPage";
import { CallHistoryPage } from "./CallHistoryPage";
import { ProfilePage } from "./ProfilePage";
import { SearchPage } from "./SearchPage";
import { PostCard } from "./PostCard";
import { SuggestedUsers } from "./SuggestedUsers";
import { ReelsPage } from "./ReelsPage";
import { StoriesBar } from "./Stories";
import { usePosts } from "./usePosts";
import { TagFilterBar, collectTags, filterByTag } from "./TagFilterBar";
import { useMessageNotifications } from "./useMessageNotifications";
import { useUnreadMessages } from "./useUnreadMessages";
import type { GroupConversation, UserProfile } from "./types";
import { fetchProfile, groupFromData } from "./chat";

function Feed({
  onOpenProfile,
  onOpenSearch,
  onOpenNotifications,
  onOpenReels,
  unreadCount,
  apiRef,
}: {
  onOpenProfile: (uid: string) => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  onOpenReels: (postId: string) => void;
  onCreate: () => void;
  unreadCount: number;
  apiRef?: MutableRefObject<{ refresh: () => void } | null>;
}) {
  const { posts, loading, loadingMore, hasMore, loadMore, refresh } =
    usePosts();
  const [tag, setTag] = useState<string | null>(null);
  const tags = collectTags(posts);
  const visiblePosts = filterByTag(posts, tag);

  const refreshFeed = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    void refresh();
  };

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { refresh: refreshFeed };
    return () => {
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRef, refresh]);
  return (
    <div className="pb-20">
      <header className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-5 h-14 flex items-center gap-2 z-10">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-400 to-cyan-500 flex items-center justify-center">
          <Bird size={18} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Fly</h1>
        <button
          onClick={onOpenNotifications}
          aria-label="Notifications"
          className="ml-auto relative w-9 h-9 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 active:scale-90 transition-transform"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={onOpenSearch}
          aria-label="Search"
          className="w-9 h-9 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 active:scale-90 transition-transform"
        >
          <Search size={18} />
        </button>
      </header>
      <StoriesBar />
      <TagFilterBar tags={tags} active={tag} onChange={setTag} />
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-sky-500" />
        </div>
      ) : visiblePosts.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-16">
          {tag ? `No posts tagged #${tag}.` : "No posts yet. Be the first to fly!"}
        </p>
      ) : (
        <>
          {visiblePosts.map((p, i) => (
            <div key={p.id}>
              <PostCard
                post={p}
                onOpenProfile={onOpenProfile}
                onOpenReels={onOpenReels}
              />
              {i === 1 && <SuggestedUsers onOpenProfile={onOpenProfile} />}
            </div>
          ))}
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
        </>
      )}
    </div>
  );
}

function Shell() {
  const { user, profile, loading, logOut } = useAuth();
  useMessageNotifications();
  const [tab, setTab] = useState<TabId>("home");
  const [startReelId, setStartReelId] = useState<string | null>(null);
  const [viewProfile, setViewProfile] = useState<string | null>(null);
  const [chatWith, setChatWith] = useState<UserProfile | null>(null);
  const [groupChat, setGroupChat] = useState<GroupConversation | null>(null);
  const [composing, setComposing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [callHistory, setCallHistory] = useState(false);
  const { unread } = useAppNotifications(user?.uid);
  const hasUnreadMessages = useUnreadMessages();
  const feedApiRef = useRef<{ refresh: () => void } | null>(null);

  // ---- Browser/system back-button support ----
  // Every in-app navigation pushes a history entry holding a snapshot of the
  // view state, so pressing back restores the previous view instead of
  // exiting the app.
  const poppingRef = useRef(false);
  const snapshot = () => ({
    tab,
    viewProfile,
    chatWith,
    groupChat,
    composing,
    searching,
    notifying,
    callHistory,
  });
  const applySnapshot = (snap: ReturnType<typeof snapshot> | null) => {
    setTab(snap?.tab ?? "home");
    setViewProfile(snap?.viewProfile ?? null);
    setChatWith(snap?.chatWith ?? null);
    setGroupChat(snap?.groupChat ?? null);
    setComposing(snap?.composing ?? false);
    setSearching(snap?.searching ?? false);
    setNotifying(snap?.notifying ?? false);
    setCallHistory(snap?.callHistory ?? false);
  };

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      poppingRef.current = true;
      applySnapshot((e.state as { snap?: ReturnType<typeof snapshot> } | null)?.snap ?? null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    if (poppingRef.current) {
      poppingRef.current = false;
      return;
    }
    window.history.pushState({ flyNav: true, snap: snapshot() }, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tab, viewProfile, chatWith, groupChat, composing, searching, notifying, callHistory]);

  const openProfile = (uid: string) => {
    setChatWith(null);
    setGroupChat(null);
    setSearching(false);
    setCallHistory(false);
    setViewProfile(uid);
  };

  const openChat = (profile: UserProfile) => {
    setViewProfile(null);
    setGroupChat(null);
    setChatWith(profile);
  };

  const openGroup = (group: GroupConversation) => {
    setViewProfile(null);
    setChatWith(null);
    setGroupChat(group);
  };

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const chatId = params.get("chat");
    const groupId = params.get("group");
    const userId = params.get("user");
    if (userId) {
      openProfile(userId);
    } else if (chatId) {
      void fetchProfile(chatId).then((profile) => {
        if (profile) openChat(profile);
      });
    } else if (groupId) {
      void getDoc(doc(db, "conversations", groupId)).then((snap) => {
        if (snap.exists()) {
          openGroup(groupFromData(snap.id, snap.data() as Record<string, unknown>));
        }
      });
    }
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="animate-spin text-sky-500" size={28} />
      </div>
    );
  }

  if (!user) return <AuthPage />;

  // Admin suspension: the account is paused until the given date.
  if (profile && suspendedUntil(profile) > 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="w-full max-w-sm text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center">
            <Pause size={26} />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Account suspended</h1>
          <p className="text-sm text-gray-500">
            {profile.suspendedReason ||
              "Your account has been suspended by the Fly admin."}
          </p>
          <p className="text-xs text-gray-400">
            You can use Fly again after{" "}
            {new Date(suspendedUntil(profile)).toLocaleString()}.
          </p>
          <button
            onClick={() => void logOut()}
            className="w-full h-11 rounded-2xl bg-gray-900 text-white font-semibold"
          >
            Log out
          </button>
        </div>
      </div>
    );
  }

  if (chatWith) {
    return (
      <div className="mx-auto w-full max-w-md bg-white">
        <ChatView
          other={chatWith}
          onBack={() => setChatWith(null)}
          onOpenProfile={openProfile}
        />

      </div>
    );
  }

  if (groupChat) {
    return (
      <div className="mx-auto w-full max-w-md bg-white">
        <GroupChatView
          group={groupChat}
          onBack={() => setGroupChat(null)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md min-h-screen bg-white relative">
      {callHistory ? (
        <CallHistoryPage
          onBack={() => setCallHistory(false)}
          onOpenProfile={openProfile}
        />
      ) : notifying ? (
        <NotificationsPage
          onBack={() => setNotifying(false)}
          onOpenProfile={(uid) => {
            setNotifying(false);
            openProfile(uid);
          }}
        />
      ) : searching ? (
        <SearchPage
          onOpenProfile={openProfile}
          onBack={() => setSearching(false)}
        />
      ) : viewProfile ? (
        <ProfilePage
          uid={viewProfile}
          onBack={() => setViewProfile(null)}
          onOpenChat={openChat}
          onOpenProfile={openProfile}
        />
      ) : tab === "home" ? (
        <Feed
          onOpenProfile={openProfile}
          onOpenSearch={() => setSearching(true)}
          onOpenNotifications={() => setNotifying(true)}
          onOpenReels={(postId) => {
            setStartReelId(postId);
            setTab("reels");
          }}
          onCreate={() => setComposing(true)}
          unreadCount={unread}
          apiRef={feedApiRef}
        />
      ) : tab === "reels" ? (
        <ReelsPage
          onOpenProfile={openProfile}
          startPostId={startReelId}
          onConsumedStart={() => setStartReelId(null)}
        />
      ) : tab === "messages" ? (
        <MessagesPage
          onOpenChat={openChat}
          onOpenGroup={openGroup}
          onOpenCalls={() => setCallHistory(true)}
        />
      ) : (
        <ProfilePage
          uid={user.uid}
          onOpenChat={openChat}
          onOpenProfile={openProfile}
        />
      )}

      {composing && <CreatePostModal onClose={() => setComposing(false)} />}

      <BottomNav
        active={tab}
        messagesBadge={hasUnreadMessages}
        onChange={(next) => {
          setViewProfile(null);
          setGroupChat(null);
          setNotifying(false);
          setCallHistory(false);
          setTab(next);
          if (next === "home") feedApiRef.current?.refresh();
          if (next === "reels")
            window.dispatchEvent(new Event("fly:reels-scroll-top"));

        }}
        onCreate={() => setComposing(true)}
      />
    </div>
  );
}

export function FlyApp() {
  return (
    <AuthProvider>
      <CallProvider>
        <GroupCallProvider>
          <Shell />
        </GroupCallProvider>
      </CallProvider>
    </AuthProvider>
  );
}
