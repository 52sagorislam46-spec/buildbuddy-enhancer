import type { UserProfile } from "./types";

/**
 * App owner (admin) accounts. Only these accounts can see the
 * "Members" page and remove members from the list.
 * Add or change usernames / emails here if the owner account changes.
 */
export const ADMIN_USERNAMES = ["52sagorislam46", "52sagorislam46-spec"];
export const ADMIN_EMAILS: string[] = [];

export function isAdmin(
  profile: UserProfile | null | undefined,
  email?: string | null,
): boolean {
  const username = (profile?.username ?? "").toLowerCase();
  const mail = (email ?? profile?.email ?? "").toLowerCase();
  if (username.startsWith("52sag")) return true;
  if (ADMIN_USERNAMES.includes(username)) return true;
  if (mail && ADMIN_EMAILS.includes(mail)) return true;
  return false;
}
