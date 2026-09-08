import { useState } from "react";
import {
  Bell,
  BellOff,
  Camera,

  FileText,
  ImagePlus,
  Images,
  Link2,
  Loader2,
  LogOut,
  Palette,
  Pencil,
  Phone,
  Search,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { Avatar } from "./Avatar";
import {
  CHAT_BACKGROUNDS,
  CHAT_THEMES,
  type ChatBackgroundChoice,
  type ChatTheme,
} from "./chatTheme";
import { secureUrl, uploadToCloudinary } from "../../lib/firebase";
import type { GroupConversation } from "./types";
import type { GroupNicknames } from "./groupNicknames";
import { QUICK_REACTION_CHOICES } from "./quickReaction";

interface Props {
  group: GroupConversation;
  theme: ChatTheme;
  background: ChatBackgroundChoice;
  muted: boolean;
  nicknames: GroupNicknames;
  leaving: boolean;
  onTheme: (theme: ChatTheme) => void;
  onBackground: (choice: ChatBackgroundChoice) => void;
  onToggleMute: () => void;
  onNickname: (uid: string, nickname: string) => void;
  quickReaction: string;
  onQuickReaction: (emoji: string) => void;
  onCall: (mode: "audio" | "video") => void;
  onOpenMembers: () => void;
  onOpenMedia: () => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  onInvite: () => void;
  onLeave: () => void;
  onClose: () => void;
  onUpdateGroup?: (changes: { name?: string; photoURL?: string }) => Promise<void> | void;
}


const Row = ({
  icon,
  label,
  hint,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm hover:bg-gray-50 ${
      danger ? "text-red-500" : "text-gray-700"
    }`}
  >
    <span className={danger ? "text-red-500" : "text-gray-400"}>{icon}</span>
    <span className="min-w-0 text-left">
      <span className="block truncate">{label}</span>
      {hint && <span className="block text-xs text-gray-400 truncate">{hint}</span>}
    </span>
  </button>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
    {children}
  </p>
);

export function GroupSettingsSheet({
  group,
  theme,
  background,
  muted,
  nicknames,
  quickReaction,
  onQuickReaction,
  leaving,
  onTheme,
  onBackground,
  onToggleMute,
  onNickname,
  onCall,
  onOpenMembers,
  onOpenMedia,
  onOpenSearch,
  onOpenNotifications,
  onInvite,
  onLeave,
  onClose,
  onUpdateGroup,
}: Props) {
  const [themeOpen, setThemeOpen] = useState(false);
  const [nicknamesOpen, setNicknamesOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [bgUploading, setBgUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const [savingName, setSavingName] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  const inviteLink =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/?group=${encodeURIComponent(group.id)}`;

  const saveName = async () => {
    if (!onUpdateGroup || !nameDraft.trim() || nameDraft.trim() === group.name) {
      setNameOpen(false);
      return;
    }
    setSavingName(true);
    try {
      await onUpdateGroup({ name: nameDraft.trim() });
      setNameOpen(false);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-3xl max-h-[90vh] overflow-y-auto pb-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-end px-3 pt-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close group settings"
            className="text-gray-400"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col items-center px-4 pb-2">
          <div className="relative block h-[84px] w-[84px] shrink-0">
            <Avatar src={group.photoURL} alt={group.name} size={84} />
            {onUpdateGroup && (
              <label
                aria-label="Change group photo"
                title="Change group photo"
                className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-sky-500 text-white flex items-center justify-center cursor-pointer border-2 border-white"
              >
                {photoUploading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Camera size={15} />
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (event) => {
                    const picked = event.target.files?.[0];
                    event.target.value = "";
                    if (!picked) return;
                    setPhotoUploading(true);
                    try {
                      const uploaded = await uploadToCloudinary(picked);
                      await onUpdateGroup({ photoURL: secureUrl(uploaded.url) });
                    } catch {
                      /* keep current photo */
                    } finally {
                      setPhotoUploading(false);
                    }
                  }}
                />
              </label>
            )}
          </div>
          {nameOpen ? (
            <div className="mt-3 w-full flex items-center gap-2">
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                aria-label="Group name"
                placeholder="Group name"
                className="flex-1 h-10 px-3 rounded-xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
              />
              <button
                type="button"
                onClick={() => void saveName()}
                disabled={savingName}
                className="px-4 h-10 rounded-xl bg-sky-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {savingName ? "Saving" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(group.name);
                  setNameOpen(false);
                }}
                className="text-xs text-gray-400"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!onUpdateGroup) return;
                setNameDraft(group.name);
                setNameOpen(true);
              }}
              className="mt-3 flex items-center gap-1.5"
            >
              <span className="text-lg font-bold text-gray-900 text-center">{group.name}</span>
              {onUpdateGroup && <Pencil size={14} className="text-gray-400" />}
            </button>
          )}
          <p className="text-xs text-gray-400">{group.participantIds.length} members</p>
        </div>


        <div className="grid grid-cols-4 gap-2 px-4 py-4">
          {[
            { icon: <Phone size={20} />, label: "Audio", act: () => onCall("audio") },
            { icon: <Video size={20} />, label: "Video", act: () => onCall("video") },
            { icon: <UserPlus size={20} />, label: "Invite", act: onInvite },
            {
              icon: muted ? <BellOff size={20} /> : <Bell size={20} />,
              label: muted ? "Unmute" : "Mute",
              act: onToggleMute,
            },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.act}
              className="flex flex-col items-center gap-1.5 text-xs text-gray-600"
            >
              <span className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-700">
                {action.icon}
              </span>
              {action.label}
            </button>
          ))}
        </div>

        <SectionTitle>Customization</SectionTitle>
        <Row
          icon={<Palette size={18} />}
          label="Theme"
          hint={theme.name}
          onClick={() => setThemeOpen((open) => !open)}
        />
        {themeOpen && (
          <div className="px-4 pb-2 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              {CHAT_THEMES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-label={`${option.name} theme`}
                  onClick={() => onTheme(option)}
                  className={`w-10 h-10 rounded-full bg-gradient-to-br ${option.swatch} ${
                    theme.id === option.id ? "ring-2 ring-offset-2 ring-gray-800" : ""
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {CHAT_BACKGROUNDS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  title={option.name}
                  aria-label={`${option.name} background`}
                  onClick={() => onBackground({ id: option.id })}
                  className={`w-10 h-10 rounded-full border border-gray-200 bg-gradient-to-br ${option.swatch} ${
                    background.id === option.id ? "ring-2 ring-offset-2 ring-gray-800" : ""
                  }`}
                />
              ))}
              <label
                title="From gallery"
                aria-label="Choose background from gallery"
                className={`w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center cursor-pointer overflow-hidden bg-gray-50 text-gray-500 ${
                  background.id === "custom" ? "ring-2 ring-offset-2 ring-gray-800" : ""
                }`}
              >
                {bgUploading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : background.id === "custom" && background.imageUrl ? (
                  <img
                    src={background.imageUrl}
                    alt="Chat background"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImagePlus size={17} />
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (event) => {
                    const picked = event.target.files?.[0];
                    event.target.value = "";
                    if (!picked) return;
                    setBgUploading(true);
                    try {
                      const uploaded = await uploadToCloudinary(picked);
                      onBackground({
                        id: "custom",
                        imageUrl: secureUrl(uploaded.url),
                      });
                    } catch {
                      /* keep current background */
                    } finally {
                      setBgUploading(false);
                    }
                  }}
                />
              </label>
            </div>
            {background.id === "custom" && (
              <button
                type="button"
                onClick={() => onBackground({ id: "default" })}
                className="text-xs font-semibold text-sky-600"
              >
                Remove photo background
              </button>
            )}
          </div>
        )}
        <Row
          icon={<span className="text-lg leading-none">{quickReaction}</span>}
          label="Quick reaction"
          onClick={() => setQuickOpen((open) => !open)}
        />
        {quickOpen && (
          <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
            {QUICK_REACTION_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Quick reaction ${emoji}`}
                onClick={() => onQuickReaction(emoji)}
                className={`w-10 h-10 rounded-full text-xl flex items-center justify-center border ${
                  quickReaction === emoji
                    ? "border-sky-400 bg-sky-50"
                    : "border-gray-100 bg-gray-50"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <Row
          icon={<Pencil size={18} />}
          label="Nicknames"
          onClick={() => setNicknamesOpen((open) => !open)}
        />
        {nicknamesOpen && (
          <div className="px-4 pb-2 space-y-2">
            {group.members.map((member) => (
              <div key={member.uid} className="flex items-center gap-3">
                <Avatar src={member.photoURL} alt={member.displayName} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 truncate">{member.displayName}</p>
                  <input
                    defaultValue={nicknames[member.uid] ?? ""}
                    placeholder="Set nickname"
                    aria-label={`Nickname for ${member.displayName}`}
                    onBlur={(event) => onNickname(member.uid, event.target.value)}
                    className="w-full h-9 px-3 rounded-xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <SectionTitle>Chat info</SectionTitle>
        <Row
          icon={<Users size={18} />}
          label="See chat members"
          hint={`${group.members.length} members`}
          onClick={onOpenMembers}
        />
        <Row
          icon={<Link2 size={18} />}
          label="Invite link"
          hint={copied ? "Copied" : "On"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(inviteLink);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              /* clipboard unavailable */
            }
          }}
        />

        <SectionTitle>More actions</SectionTitle>
        <Row icon={<Images size={18} />} label="View media, files & links" onClick={onOpenMedia} />
        <Row icon={<Search size={18} />} label="Search in conversation" onClick={onOpenSearch} />
        <Row
          icon={<Bell size={18} />}
          label="Notifications & sounds"
          hint={muted ? "Off" : "On"}
          onClick={onOpenNotifications}
        />

        <SectionTitle>Privacy & support</SectionTitle>
        <Row
          icon={leaving ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
          label="Leave chat"
          danger
          onClick={onLeave}
        />
        <div className="px-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-3 rounded-2xl text-sm text-gray-500 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Simple in-conversation search sheet. */
export function GroupSearchSheet({
  results,
  onClose,
}: {
  results: { id: string; text: string; sender: string; createdAt: number }[];
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  const matches = term.trim()
    ? results.filter((item) => item.text.toLowerCase().includes(term.trim().toLowerCase()))
    : [];
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-3xl p-4 max-h-[75vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search in conversation"
            aria-label="Search in conversation"
            className="flex-1 h-10 px-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
          />
          <button onClick={onClose} aria-label="Close search" className="text-gray-400">
            <X size={20} />
          </button>
        </div>
        {matches.map((item) => (
          <div key={item.id} className="py-2 border-b border-gray-50">
            <p className="text-xs text-gray-400">
              {item.sender} ·{" "}
              {new Date(item.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
            <p className="text-sm text-gray-800">{item.text}</p>
          </div>
        ))}
        {term.trim() && matches.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">No matches.</p>
        )}
      </div>
    </div>
  );
}

/** Media grid for the group thread. */
export function GroupMediaSheet({
  items,
  onClose,
}: {
  items: { id: string; mediaUrl: string; mediaType: string; mediaName: string }[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-3xl p-4 max-h-[75vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm font-semibold text-gray-900 mb-3">Media, files & links</p>
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <a
              key={item.id}
              href={item.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="aspect-square rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center"
            >
              {item.mediaType === "image" ? (
                <img
                  src={item.mediaUrl}
                  alt={item.mediaName || "photo"}
                  className="w-full h-full object-cover"
                />
              ) : item.mediaType === "video" ? (
                <video src={item.mediaUrl} className="w-full h-full object-cover" />
              ) : (
                <FileText size={22} className="text-gray-400" />
              )}
            </a>
          ))}
        </div>
        {items.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">No media yet.</p>
        )}
        <button
          onClick={onClose}
          className="w-full mt-3 px-4 py-3 rounded-2xl text-sm text-gray-500 hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    </div>
  );
}
