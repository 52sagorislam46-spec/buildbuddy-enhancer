import type { Post } from "./types";

export function collectTags(posts: Post[]): string[] {
  const counts = new Map<string, number>();
  posts.forEach((p) =>
    (p.tags ?? []).forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)),
  );
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

export function filterByTag(posts: Post[], tag: string | null): Post[] {
  if (!tag) return posts;
  return posts.filter((p) => (p.tags ?? []).includes(tag));
}

export function TagFilterBar({
  tags,
  active,
  onChange,
  dark = false,
}: {
  tags: string[];
  active: string | null;
  onChange: (tag: string | null) => void;
  dark?: boolean;
}) {
  if (tags.length === 0) return null;
  const base =
    "shrink-0 h-8 px-3 rounded-full text-xs font-semibold transition-colors";
  const idle = dark
    ? "bg-white/15 text-white/80 border border-white/20"
    : "bg-gray-50 text-gray-600 border border-gray-100";
  const on = dark ? "bg-white text-black" : "bg-sky-500 text-white";

  return (
    <div
      className={`flex gap-2 overflow-x-auto px-4 py-2 ${
        dark ? "" : "border-b border-gray-100"
      }`}
    >
      <button
        onClick={() => onChange(null)}
        className={`${base} ${active === null ? on : idle}`}
      >
        All
      </button>
      {tags.map((t) => (
        <button
          key={t}
          onClick={() => onChange(active === t ? null : t)}
          className={`${base} ${active === t ? on : idle}`}
        >
          #{t}
        </button>
      ))}
    </div>
  );
}
