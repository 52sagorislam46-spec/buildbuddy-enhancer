export interface PostBackground {
  id: string;
  label: string;
  /** CSS background value for the post canvas */
  background: string;
  textColor: string;
  /** Swatch color shown in the picker */
  swatch: string;
}

export const POST_BACKGROUNDS: PostBackground[] = [
  {
    id: "plain",
    label: "None",
    background: "#ffffff",
    textColor: "#1f2937",
    swatch: "#ffffff",
  },
  {
    id: "sunset",
    label: "Sunset",
    background: "linear-gradient(135deg, #f97316, #ec4899)",
    textColor: "#ffffff",
    swatch: "linear-gradient(135deg, #f97316, #ec4899)",
  },
  {
    id: "ocean",
    label: "Ocean",
    background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
    textColor: "#ffffff",
    swatch: "linear-gradient(135deg, #0ea5e9, #6366f1)",
  },
  {
    id: "grape",
    label: "Grape",
    background: "linear-gradient(135deg, #a855f7, #ec4899)",
    textColor: "#ffffff",
    swatch: "linear-gradient(135deg, #a855f7, #ec4899)",
  },
  {
    id: "forest",
    label: "Forest",
    background: "linear-gradient(135deg, #059669, #84cc16)",
    textColor: "#ffffff",
    swatch: "linear-gradient(135deg, #059669, #84cc16)",
  },
  {
    id: "midnight",
    label: "Midnight",
    background: "linear-gradient(135deg, #111827, #4b5563)",
    textColor: "#ffffff",
    swatch: "linear-gradient(135deg, #111827, #4b5563)",
  },
  {
    id: "candy",
    label: "Candy",
    background: "linear-gradient(135deg, #f43f5e, #fbbf24)",
    textColor: "#ffffff",
    swatch: "linear-gradient(135deg, #f43f5e, #fbbf24)",
  },
  {
    id: "sky",
    label: "Sky",
    background: "linear-gradient(135deg, #38bdf8, #a5f3fc)",
    textColor: "#0c4a6e",
    swatch: "linear-gradient(135deg, #38bdf8, #a5f3fc)",
  },
];

export function getPostBackground(id?: string | null): PostBackground {
  return POST_BACKGROUNDS.find((b) => b.id === id) ?? POST_BACKGROUNDS[0]!;
}
