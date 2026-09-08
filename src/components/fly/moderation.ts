/**
 * Admin moderation helpers: temporarily suspend a member's account for a
 * number of days and resume it again. Nothing else about the account is
 * touched – only the two `suspended*` fields on the user document.
 */
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { notifyAdminNotice } from "../../lib/appNotifications";
import type { UserProfile } from "./types";

export const SUSPEND_DAY_OPTIONS = [1, 3, 7, 10, 20, 30] as const;

export function suspendedUntil(
  profile: Pick<UserProfile, "suspendedUntil"> | null | undefined,
): number {
  const until = profile?.suspendedUntil ?? 0;
  return until > Date.now() ? until : 0;
}

export function isSuspended(
  profile: Pick<UserProfile, "suspendedUntil"> | null | undefined,
): boolean {
  return suspendedUntil(profile) > 0;
}

/** Suspend an account for `days` days and send the member a notice. */
export async function suspendMember(input: {
  uid: string;
  days: number;
  displayName?: string;
  reason?: string;
}) {
  const until = Date.now() + input.days * 24 * 60 * 60 * 1000;
  const reason =
    input.reason?.trim() ||
    `Your account has been suspended for ${input.days} day${input.days > 1 ? "s" : ""} by the Fly admin.`;
  await updateDoc(doc(db, "users", input.uid), {
    suspendedUntil: until,
    suspendedReason: reason,
  });
  await notifyAdminNotice({
    uid: input.uid,
    title: "Account suspended",
    text: `${reason} You can use Fly again after ${new Date(until).toLocaleString()}.`,
  });
  return until;
}

/** Lift a suspension immediately and let the member know. */
export async function resumeMember(uid: string) {
  await updateDoc(doc(db, "users", uid), {
    suspendedUntil: 0,
    suspendedReason: "",
  });
  await notifyAdminNotice({
    uid,
    title: "Account restored",
    text: "The Fly admin has lifted your suspension. Your account is active again.",
  });
}

/** Free-form warning notice from the admin. */
export async function warnMember(uid: string, text: string) {
  await notifyAdminNotice({ uid, title: "Admin notice", text });
}
