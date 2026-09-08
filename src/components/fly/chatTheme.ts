import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";

export interface ChatTheme {
  id: string;
  name: string;
  /** Tailwind classes for my own bubbles. */
  mine: string;
  /** Tailwind classes for the chat background. */
  background: string;
  /** Swatch gradient for the picker. */
  swatch: string;
  /** Matching chat background preset id, applied together with the theme. */
  bg?: string;
}

export const CHAT_THEMES: ChatTheme[] = [
  {
    id: "sky",
    name: "Sky",
    mine: "bg-gradient-to-r from-sky-500 to-cyan-500 text-white",
    background: "bg-white",
    swatch: "from-sky-500 to-cyan-500",
  },
  {
    id: "sunset",
    name: "Sunset",
    mine: "bg-gradient-to-r from-orange-500 to-rose-500 text-white",
    background: "bg-orange-50/40",
    swatch: "from-orange-500 to-rose-500",
  },
  {
    id: "violet",
    name: "Violet",
    mine: "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white",
    background: "bg-violet-50/40",
    swatch: "from-violet-500 to-fuchsia-500",
  },
  {
    id: "forest",
    name: "Forest",
    mine: "bg-gradient-to-r from-emerald-500 to-teal-500 text-white",
    background: "bg-emerald-50/40",
    swatch: "from-emerald-500 to-teal-500",
  },
  {
    id: "midnight",
    name: "Midnight",
    mine: "bg-gradient-to-r from-slate-700 to-slate-900 text-white",
    background: "bg-slate-100",
    swatch: "from-slate-700 to-slate-900",
  },
  {
    id: "love",
    name: "Love",
    mine: "bg-gradient-to-r from-rose-500 to-red-500 text-white",
    background: "bg-rose-50/50",
    swatch: "from-rose-500 to-red-500",
  },
  {
    id: "berry",
    name: "Berry",
    mine: "bg-gradient-to-r from-pink-500 to-purple-600 text-white",
    background: "bg-pink-50/50",
    swatch: "from-pink-500 to-purple-600",
  },
  {
    id: "candy",
    name: "Candy",
    mine: "bg-gradient-to-r from-fuchsia-400 to-amber-300 text-white",
    background: "bg-amber-50/50",
    swatch: "from-fuchsia-400 to-amber-300",
  },
  {
    id: "lollipop",
    name: "Lollipop",
    mine: "bg-gradient-to-r from-red-400 via-yellow-400 to-pink-400 text-white",
    background: "bg-yellow-50/50",
    swatch: "from-red-400 via-yellow-400 to-pink-400",
  },
  {
    id: "unicorn",
    name: "Unicorn",
    mine: "bg-gradient-to-r from-purple-400 via-pink-400 to-sky-400 text-white",
    background: "bg-violet-50/50",
    swatch: "from-purple-400 via-pink-400 to-sky-400",
  },
  {
    id: "tiedye",
    name: "Tie-dye",
    mine: "bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-yellow-400 text-white",
    background: "bg-cyan-50/50",
    swatch: "from-cyan-400 via-fuchsia-500 to-yellow-400",
  },
  {
    id: "astrology",
    name: "Astrology",
    mine: "bg-gradient-to-r from-indigo-600 to-purple-900 text-white",
    background: "bg-indigo-50/50",
    swatch: "from-indigo-600 to-purple-900",
  },
  {
    id: "monochrome",
    name: "Monochrome",
    mine: "bg-gradient-to-r from-gray-800 to-black text-white",
    background: "bg-gray-100",
    swatch: "from-gray-800 to-black",
  },
  {
    id: "tropical",
    name: "Tropical",
    mine: "bg-gradient-to-r from-lime-400 to-emerald-600 text-white",
    background: "bg-lime-50/50",
    swatch: "from-lime-400 to-emerald-600",
  },
  {
    id: "peach",
    name: "Peach",
    mine: "bg-gradient-to-r from-orange-300 to-pink-400 text-white",
    background: "bg-orange-50/50",
    swatch: "from-orange-300 to-pink-400",
  },
  {
    id: "ocean",
    name: "Ocean",
    mine: "bg-gradient-to-r from-blue-600 to-teal-400 text-white",
    background: "bg-sky-50/50",
    swatch: "from-blue-600 to-teal-400",
  },
  {
    id: "gold",
    name: "Gold",
    mine: "bg-gradient-to-r from-amber-500 to-yellow-600 text-white",
    background: "bg-amber-50/50",
    swatch: "from-amber-500 to-yellow-600",
  },
];

export const defaultTheme = CHAT_THEMES[0] as ChatTheme;

const key = (conversation: string) => `fly-chat-theme-${conversation}`;

export function loadTheme(conversation: string): ChatTheme {
  if (typeof localStorage === "undefined") return defaultTheme;
  try {
    const id = localStorage.getItem(key(conversation));
    return CHAT_THEMES.find((t) => t.id === id) ?? defaultTheme;
  } catch {
    return defaultTheme;
  }
}

export function saveTheme(conversation: string, id: string) {
  try {
    localStorage.setItem(key(conversation), id);
  } catch {
    /* ignore */
  }
}

/* ------------------------- chat backgrounds ------------------------- */

export interface ChatBackground {
  id: string;
  name: string;
  /** Tailwind classes applied to the message area. */
  className: string;
  /** Swatch preview for the picker. */
  swatch: string;
}

export const CHAT_BACKGROUNDS: ChatBackground[] = [
  {
    id: "default",
    name: "Default",
    className: "",
    swatch: "from-white to-gray-200",
  },
  {
    id: "plain",
    name: "Plain white",
    className: "bg-white",
    swatch: "from-white to-white",
  },
  {
    id: "cloud",
    name: "Cloud",
    className: "bg-gradient-to-b from-sky-50 to-white",
    swatch: "from-sky-100 to-white",
  },
  {
    id: "peach",
    name: "Peach",
    className: "bg-gradient-to-b from-rose-50 to-orange-50",
    swatch: "from-rose-200 to-orange-200",
  },
  {
    id: "mint",
    name: "Mint",
    className: "bg-gradient-to-b from-emerald-50 to-teal-50",
    swatch: "from-emerald-200 to-teal-200",
  },
  {
    id: "lavender",
    name: "Lavender",
    className: "bg-gradient-to-b from-violet-50 to-fuchsia-50",
    swatch: "from-violet-200 to-fuchsia-200",
  },
  {
    id: "night",
    name: "Night",
    className: "bg-gradient-to-b from-slate-800 to-slate-900",
    swatch: "from-slate-700 to-slate-900",
  },
  {
    id: "sunrise",
    name: "Sunrise",
    className: "bg-gradient-to-b from-amber-100 via-rose-100 to-white",
    swatch: "from-amber-200 to-rose-300",
  },
  {
    id: "bubblegum",
    name: "Bubblegum",
    className: "bg-gradient-to-b from-pink-100 via-fuchsia-50 to-white",
    swatch: "from-pink-300 to-fuchsia-300",
  },
  {
    id: "galaxy",
    name: "Galaxy",
    className: "bg-gradient-to-b from-indigo-900 via-purple-900 to-slate-900",
    swatch: "from-indigo-700 to-purple-900",
  },
  {
    id: "aurora",
    name: "Aurora",
    className: "bg-gradient-to-b from-teal-200 via-sky-100 to-violet-100",
    swatch: "from-teal-300 to-violet-300",
  },
  {
    id: "sand",
    name: "Sand",
    className: "bg-gradient-to-b from-amber-50 to-stone-100",
    swatch: "from-amber-200 to-stone-300",
  },
  {
    id: "forest",
    name: "Forest",
    className: "bg-gradient-to-b from-emerald-900 via-emerald-800 to-slate-900",
    swatch: "from-emerald-700 to-emerald-900",
  },
];


export const defaultBackground = CHAT_BACKGROUNDS[0] as ChatBackground;

export interface ChatBackgroundChoice {
  /** Preset id, or "custom" when a gallery photo is used. */
  id: string;
  /** Uploaded image URL when id === "custom". */
  imageUrl?: string;
}

const bgKey = (conversation: string) => `fly-chat-bg-${conversation}`;

export function loadBackground(conversation: string): ChatBackgroundChoice {
  if (typeof localStorage === "undefined") return { id: "default" };
  try {
    const raw = localStorage.getItem(bgKey(conversation));
    if (!raw) return { id: "default" };
    const parsed = JSON.parse(raw) as ChatBackgroundChoice;
    if (!parsed || typeof parsed.id !== "string") return { id: "default" };
    return parsed;
  } catch {
    return { id: "default" };
  }
}

export function saveBackground(
  conversation: string,
  choice: ChatBackgroundChoice,
) {
  try {
    localStorage.setItem(bgKey(conversation), JSON.stringify(choice));
  } catch {
    /* ignore */
  }
}

export function backgroundClass(choice: ChatBackgroundChoice): string {
  if (choice.id === "custom") return "";
  return (
    CHAT_BACKGROUNDS.find((b) => b.id === choice.id)?.className ??
    defaultBackground.className
  );
}

/* --------------- shared (both sides) theme + background --------------- */
/**
 * Theme and background are mirrored on the conversation document so a change
 * made by either participant shows up for both. Local storage stays as the
 * offline fallback and is kept in sync.
 */

export interface ChatAppearance {
  theme: ChatTheme;
  background: ChatBackgroundChoice;
}

function appearanceRef(conversation: string) {
  return doc(db, "conversations", conversation);
}

export async function saveSharedTheme(conversation: string, id: string) {
  saveTheme(conversation, id);
  try {
    await setDoc(appearanceRef(conversation), { themeId: id }, { merge: true });
  } catch {
    /* offline or rules: local value still applies */
  }
}

export async function saveSharedBackground(
  conversation: string,
  choice: ChatBackgroundChoice,
) {
  saveBackground(conversation, choice);
  try {
    await setDoc(
      appearanceRef(conversation),
      {
        backgroundId: choice.id,
        backgroundImageUrl: choice.imageUrl ?? "",
      },
      { merge: true },
    );
  } catch {
    /* offline or rules: local value still applies */
  }
}

export function subscribeAppearance(
  conversation: string,
  onChange: (appearance: Partial<ChatAppearance>) => void,
) {
  return onSnapshot(
    appearanceRef(conversation),
    (snap) => {
      const data = snap.data() as Record<string, unknown> | undefined;
      if (!data) return;
      const next: Partial<ChatAppearance> = {};
      const themeId = data["themeId"];
      if (typeof themeId === "string") {
        const found = CHAT_THEMES.find((t) => t.id === themeId);
        if (found) {
          next.theme = found;
          saveTheme(conversation, found.id);
        }
      }
      const backgroundId = data["backgroundId"];
      if (typeof backgroundId === "string") {
        const imageUrl = data["backgroundImageUrl"];
        const choice: ChatBackgroundChoice = {
          id: backgroundId,
          ...(typeof imageUrl === "string" && imageUrl ? { imageUrl } : {}),
        };
        next.background = choice;
        saveBackground(conversation, choice);
      }
      if (next.theme || next.background) onChange(next);
    },
    () => {
      /* keep local values on error */
    },
  );
}

/* --------- theme -> matching background (Messenger-like pairing) --------- */

const THEME_BACKGROUND: Record<string, string> = {
  sky: "cloud",
  sunset: "sunrise",
  violet: "lavender",
  forest: "mint",
  midnight: "night",
  love: "bubblegum",
  berry: "bubblegum",
  candy: "sunrise",
  lollipop: "sunrise",
  unicorn: "aurora",
  tiedye: "aurora",
  astrology: "galaxy",
  monochrome: "plain",
  tropical: "mint",
  peach: "peach",
  ocean: "cloud",
  gold: "sand",
};

/** Background that should be applied when a theme is picked. */
export function backgroundForTheme(theme: ChatTheme): ChatBackgroundChoice {
  const id = theme.bg ?? THEME_BACKGROUND[theme.id] ?? "default";
  return { id };
}
