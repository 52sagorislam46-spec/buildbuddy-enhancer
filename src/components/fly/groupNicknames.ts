/**
 * Per-group member nicknames, stored locally on the device so no existing
 * Firestore data or rules change.
 */

const key = (groupId: string) => `fly-group-nicknames-${groupId}`;

export type GroupNicknames = Record<string, string>;

export function loadGroupNicknames(groupId: string): GroupNicknames {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(key(groupId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as GroupNicknames;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveGroupNickname(groupId: string, uid: string, nickname: string): GroupNicknames {
  const next = { ...loadGroupNicknames(groupId) };
  if (nickname.trim()) next[uid] = nickname.trim();
  else delete next[uid];
  try {
    localStorage.setItem(key(groupId), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
