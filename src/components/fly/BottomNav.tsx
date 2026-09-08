import { Home, MessageCircle, Clapperboard, User, Plus } from "lucide-react";

const LEFT_TABS = [
  { id: "home", label: "Home", icon: Home },
  { id: "reels", label: "Reels", icon: Clapperboard },
] as const;

const RIGHT_TABS = [
  { id: "messages", label: "Messages", icon: MessageCircle },
  { id: "profile", label: "Profile", icon: User },
] as const;

const TABS = [...LEFT_TABS, ...RIGHT_TABS];

export type TabId = (typeof TABS)[number]["id"];

function NavButton({
  id,
  label,
  icon: Icon,
  active,
  onChange,
  badge,
}: {
  id: TabId;
  label: string;
  icon: typeof Home;
  active: TabId;
  onChange: (tab: TabId) => void;
  badge?: boolean;
}) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onChange(id)}
      className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-transform active:scale-90"
    >
      <span className="relative">
        <Icon
          size={24}
          strokeWidth={isActive ? 2.5 : 2}
          className={
            isActive
              ? "text-sky-500 transition-colors"
              : "text-gray-400 transition-colors"
          }
        />
        {badge && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
        )}
      </span>
      <span
        className={`text-[10px] font-medium transition-colors ${isActive ? "text-sky-500" : "text-gray-400"}`}
      >
        {label}
      </span>
    </button>
  );
}

export function BottomNav({
  active,
  onChange,
  onCreate,
  messagesBadge,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
  onCreate: () => void;
  messagesBadge?: boolean;
}) {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white/90 backdrop-blur-xl border-t border-gray-100 z-40">
      <div className="flex items-center justify-around h-16 px-2">
        {LEFT_TABS.map((t) => (
          <NavButton key={t.id} {...t} active={active} onChange={onChange} />
        ))}
        <button
          onClick={onCreate}
          aria-label="New post"
          className="flex-1 flex items-center justify-center h-full"
        >
          <span className="w-12 h-12 rounded-full bg-gradient-to-br from-sky-500 to-cyan-500 text-white shadow-lg shadow-sky-300 flex items-center justify-center transition-transform active:scale-90">
            <Plus size={26} />
          </span>
        </button>
        {RIGHT_TABS.map((t) => (
          <NavButton
            key={t.id}
            {...t}
            active={active}
            onChange={onChange}
            badge={t.id === "messages" && !!messagesBadge}
          />
        ))}
      </div>
    </nav>
  );
}
