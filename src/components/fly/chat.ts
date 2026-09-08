import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { playSendSound } from "../../lib/notify";
import { pushToUsers } from "../../lib/push";
import type { GroupConversation, GroupMember, UserProfile } from "./types";

export const conversationId = (a: string, b: string) => [a, b].sort().join("_");

export function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in (value as object)) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === "number" ? value : Date.now();
}

export async function ensureConversation(meId: string, otherId: string) {
  const id = conversationId(meId, otherId);
  const ref = doc(db, "conversations", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      participants: [meId, otherId],
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
    });
  }
  return id;
}

export async function createGroupConversation(
  name: string,
  members: GroupMember[],
  createdBy: string,
): Promise<GroupConversation> {
  const trimmedName = name.trim() || "Group chat";
  const participantIds = members.map((member) => member.uid);
  const ref = doc(collection(db, "conversations"));
  const group: GroupConversation = {
    id: ref.id,
    type: "group",
    name: trimmedName,
    photoURL: "",
    participantIds,
    members,
    createdAt: Date.now(),
  };
  await setDoc(ref, {
    type: "group",
    participants: participantIds,
    memberProfiles: members,
    groupName: trimmedName,
    groupPhotoURL: "",
    createdBy,
    admins: [createdBy],
    lastMessage: "",
    lastMessageAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  return group;
}

export function groupFromData(id: string, data: Record<string, unknown>): GroupConversation {
  const rawMembers = Array.isArray(data["memberProfiles"]) ? data["memberProfiles"] : [];
  const participantIds = Array.isArray(data["participants"])
    ? (data["participants"] as unknown[]).filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const members: GroupMember[] = rawMembers
    .filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
    .map((value) => ({
      uid: String(value["uid"] ?? ""),
      displayName: String(value["displayName"] ?? "User"),
      username: String(value["username"] ?? "user"),
      photoURL: String(value["photoURL"] ?? ""),
    }))
    .filter((member) => member.uid);
  const storedAdmins = Array.isArray(data["admins"])
    ? (data["admins"] as unknown[]).filter((value): value is string => typeof value === "string")
    : [];
  const createdBy =
    typeof data["createdBy"] === "string" && data["createdBy"]
      ? (data["createdBy"] as string)
      : (participantIds[0] ?? "");
  const adminIds =
    storedAdmins.length > 0 ? storedAdmins : createdBy ? [createdBy] : [];
  return {
    id,
    type: "group",
    adminIds,
    createdBy,

    name: String(data["groupName"] ?? data["name"] ?? "Group chat"),
    photoURL: String(data["groupPhotoURL"] ?? ""),
    participantIds,
    members,
    createdAt: toMillis(data["createdAt"]),
  };
}

export async function sendMessage(
  meId: string,
  otherId: string,
  text: string,
  media?: { url: string; type: string; name?: string },
  kind: "text" | "call" = "text",
  postId?: string,
  reply?: { id: string; text: string; senderId: string },
) {
  const id = await ensureConversation(meId, otherId);
  // Blocked conversations cannot receive new messages from either side.
  const convo = await getDoc(doc(db, "conversations", id));
  const blockedBy = (convo.data()?.["blockedBy"] as string[]) ?? [];
  if (blockedBy.includes(otherId)) {
    throw new Error("You can't message this person because they blocked you.");
  }
  if (blockedBy.includes(meId)) {
    throw new Error("Unblock this person to send a message.");
  }
  await addDoc(collection(db, "conversations", id, "messages"), {
    senderId: meId,
    text,
    kind,
    mediaUrl: media?.url ?? "",
    mediaType: media?.type ?? "",
    mediaName: media?.name ?? "",
    postId: postId ?? "",
    replyToId: reply?.id ?? "",
    replyToText: reply?.text ?? "",
    replyToSenderId: reply?.senderId ?? "",
    deliveredTo: [],
    seenBy: [],
    deletedFor: [],
    deleted: false,
    createdAt: serverTimestamp(),
  });

  const preview =
    text ||
    (media?.type === "video" ? "Video" : media?.type === "image" ? "Photo" : media ? "File" : "");
  await setDoc(
    doc(db, "conversations", id),
    {
      participants: [meId, otherId],
      lastMessage: preview,
      lastSenderId: meId,
      lastMessageAt: serverTimestamp(),
    },
    { merge: true },
  );

  // Sending feedback sound + push to the recipient's phone.
  playSendSound();
  void (async () => {
    const me = await fetchProfile(meId);
    await pushToUsers({
      uids: [otherId],
      title: me?.displayName || "New message",
      body: preview || "Sent you a message",
      icon: me?.photoURL || "",
      link: `/?chat=${encodeURIComponent(otherId)}`,
      tag: `chat_${id}`,
      convId: id,
      event: "messages",
    });
  })();
}

export async function sendGroupMessage(
  group: GroupConversation,
  senderId: string,
  text: string,
  media?: { url: string; type: string; name?: string },
  postId?: string,
  reply?: { id: string; text: string; senderId: string },
  kind: "text" | "call" = "text",
) {
  if (!group.participantIds.includes(senderId)) {
    throw new Error("You are not a member of this group.");
  }
  const preview =
    text ||
    (media?.type === "video"
      ? "Video"
      : media?.type === "image"
        ? "Photo"
        : media?.type === "audio"
          ? "Voice message"
          : media
            ? "File"
            : "");

  const conversationRef = doc(db, "conversations", group.id);
  await addDoc(collection(conversationRef, "messages"), {
    senderId,
    text,
    kind,
    mediaUrl: media?.url ?? "",
    mediaType: media?.type ?? "",
    mediaName: media?.name ?? "",
    postId: postId ?? "",
    replyToId: reply?.id ?? "",
    replyToText: reply?.text ?? "",
    replyToSenderId: reply?.senderId ?? "",
    deliveredTo: [],
    seenBy: [],
    deletedFor: [],
    deleted: false,
    createdAt: serverTimestamp(),
  });

  await setDoc(
    conversationRef,
    {
      type: "group",
      participants: group.participantIds,
      memberProfiles: group.members,
      groupName: group.name,
      groupPhotoURL: group.photoURL,
      lastMessage: preview,
      lastSenderId: senderId,
      lastMessageAt: serverTimestamp(),
    },
    { merge: true },
  );
  playSendSound();
  void (async () => {
    const sender = await fetchProfile(senderId);
    await pushToUsers({
      uids: group.participantIds.filter((uid) => uid !== senderId),
      title: `${sender?.displayName || "New message"} · ${group.name}`,
      body: preview || "Sent a message",
      icon: sender?.photoURL || "",
      link: `/?group=${encodeURIComponent(group.id)}`,
      tag: `chat_${group.id}`,
      convId: group.id,
      event: "messages",
    });
  })();
}

/** Removes the current user from a group conversation. */
export async function leaveGroupConversation(group: GroupConversation, uid: string) {
  await setDoc(
    doc(db, "conversations", group.id),
    {
      participants: group.participantIds.filter((id) => id !== uid),
      memberProfiles: group.members.filter((member) => member.uid !== uid),
    },
    { merge: true },
  );
}

/** Updates a group's name and/or photo. */
export async function updateGroupInfo(
  groupId: string,
  changes: { name?: string; photoURL?: string },
) {
  const payload: Record<string, unknown> = {};
  if (typeof changes.name === "string" && changes.name.trim()) {
    payload["groupName"] = changes.name.trim();
  }
  if (typeof changes.photoURL === "string") {
    payload["groupPhotoURL"] = changes.photoURL;
  }
  if (Object.keys(payload).length === 0) return;
  await setDoc(doc(db, "conversations", groupId), payload, { merge: true });
}

/** Adds people to a group conversation. */
export async function addGroupMembers(group: GroupConversation, newMembers: GroupMember[]) {
  const additions = newMembers.filter((member) => !group.participantIds.includes(member.uid));
  if (additions.length === 0) return;
  await setDoc(
    doc(db, "conversations", group.id),
    {
      participants: [...group.participantIds, ...additions.map((member) => member.uid)],
      memberProfiles: [...group.members, ...additions],
    },
    { merge: true },
  );
}

/** Removes one person from a group conversation. */
export async function removeGroupMember(group: GroupConversation, uid: string) {
  await setDoc(
    doc(db, "conversations", group.id),
    {
      participants: group.participantIds.filter((id) => id !== uid),
      memberProfiles: group.members.filter((member) => member.uid !== uid),
      admins: (group.adminIds ?? []).filter((id) => id !== uid),
    },
    { merge: true },
  );
}

/** Grants or removes group admin rights. */
export async function setGroupAdmin(group: GroupConversation, uid: string, makeAdmin: boolean) {
  const current = group.adminIds ?? [];
  const next = makeAdmin
    ? Array.from(new Set([...current, uid]))
    : current.filter((id) => id !== uid);
  await setDoc(doc(db, "conversations", group.id), { admins: next }, { merge: true });
}

/** Saves a call log entry into the chat thread. */
export async function saveCallLog(meId: string, otherId: string, text: string) {
  await sendMessage(meId, otherId, text, undefined, "call");
}


export async function fetchProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = snap.data();
  return {
    uid,
    username: data.username ?? "user",
    displayName: data.displayName ?? "Anonymous",
    bio: data.bio ?? "",
    photoURL: data.photoURL ?? "",
    followers: data.followers ?? [],
    following: data.following ?? [],
    createdAt: toMillis(data.createdAt),
  };
}

/* ---------------- delivery / seen receipts ---------------- */

const messagesRef = (meId: string, otherId: string) =>
  collection(db, "conversations", conversationId(meId, otherId), "messages");

const groupMessagesRef = (groupId: string) => collection(db, "conversations", groupId, "messages");

const messageRef = (meId: string, otherId: string, msgId: string) =>
  doc(db, "conversations", conversationId(meId, otherId), "messages", msgId);

/** Marks every incoming message as delivered (recipient app is online). */
export async function markDelivered(meId: string, otherId: string) {
  try {
    const snap = await getDocs(query(messagesRef(meId, otherId), where("senderId", "==", otherId)));
    await Promise.all(
      snap.docs
        .filter((d) => {
          const data = d.data() as Record<string, unknown>;
          if (data["deleted"]) return false;
          if (((data["deletedFor"] as string[]) ?? []).includes(meId)) return false;
          return !((data["deliveredTo"] as string[]) ?? []).includes(meId);
        })
        .map((d) => updateDoc(d.ref, { deliveredTo: arrayUnion(meId) })),
    );
  } catch {
    /* best effort */
  }
}

/**
 * Marks every incoming message in a conversation as delivered. Used while the
 * app is open on any screen so the sender sees "Delivered" without the
 * recipient having to open the thread.
 */
export async function markConversationDelivered(convId: string, meId: string) {
  try {
    const snap = await getDocs(
      query(collection(db, "conversations", convId, "messages"), where("senderId", "!=", meId)),
    );
    await Promise.all(
      snap.docs
        .filter((d) => {
          const data = d.data() as Record<string, unknown>;
          if (data["deleted"]) return false;
          if (((data["deletedFor"] as string[]) ?? []).includes(meId)) return false;
          return !((data["deliveredTo"] as string[]) ?? []).includes(meId);
        })
        .map((d) => updateDoc(d.ref, { deliveredTo: arrayUnion(meId) })),
    );
  } catch {
    /* best effort */
  }
}

/** Marks incoming messages as seen (chat thread is open). */
export async function markSeen(meId: string, otherId: string, msgIds: string[]) {
  await Promise.all(
    msgIds.map((id) =>
      updateDoc(messageRef(meId, otherId, id), {
        deliveredTo: arrayUnion(meId),
        seenBy: arrayUnion(meId),
      }).catch(() => {}),
    ),
  );
}

export async function markGroupSeen(groupId: string, meId: string) {
  try {
    const snap = await getDocs(groupMessagesRef(groupId));
    await Promise.all(
      snap.docs
        .filter((message) => {
          const data = message.data() as Record<string, unknown>;
          return (
            data["senderId"] !== meId &&
            !data["deleted"] &&
            !((data["seenBy"] as string[] | undefined) ?? []).includes(meId)
          );
        })
        .map((message) =>
          updateDoc(message.ref, {
            deliveredTo: arrayUnion(meId),
            seenBy: arrayUnion(meId),
          }).catch(() => {}),
        ),
    );
  } catch {
    /* best effort */
  }
}

/* ---------------- deleting ---------------- */

/** Hides the message for the current user only. */
export async function deleteForMe(meId: string, otherId: string, msgId: string) {
  const ref = messageRef(meId, otherId, msgId);
  await updateDoc(ref, { deletedFor: arrayUnion(meId) });
  // If both sides removed it, drop the document so no stale receipts linger.
  try {
    const snap = await getDoc(ref);
    const hidden = (snap.data()?.["deletedFor"] as string[]) ?? [];
    if (hidden.includes(meId) && hidden.includes(otherId)) {
      await deleteDoc(ref);
    }
  } catch {
    /* best effort */
  }
}

/** Replaces the message content for both sides, keeping receipts consistent. */
export async function deleteForEveryone(meId: string, otherId: string, msgId: string) {
  await updateDoc(messageRef(meId, otherId, msgId), {
    deleted: true,
    deletedBy: meId,
    deletedAt: serverTimestamp(),
    text: "",
    mediaUrl: "",
    mediaType: "",
    mediaName: "",
    // Receipts are frozen at delete time: no further delivered/seen updates.
    deliveredTo: [],
    seenBy: [],
  });
}

/** Permanently removes a message document (used for own call logs). */
export async function hardDeleteMessage(meId: string, otherId: string, msgId: string) {
  await deleteDoc(messageRef(meId, otherId, msgId));
}

/* ---------------- reactions ---------------- */

export const MESSAGE_REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

/**
 * Sets (or clears, when the same emoji is tapped again) the current user's
 * reaction on a message.
 */
export async function toggleMessageReaction(
  meId: string,
  otherId: string,
  msgId: string,
  emoji: string,
) {
  const ref = messageRef(meId, otherId, msgId);
  try {
    const snap = await getDoc(ref);
    const current = ((snap.data()?.["reactions"] as Record<string, string>) ?? {})[meId];
    await updateDoc(ref, {
      [`reactions.${meId}`]: current === emoji ? deleteField() : emoji,
    });
  } catch {
    /* best effort */
  }
}

/* ---------------- editing ---------------- */

/** Edits the text of a message the current user sent. */
export async function editMessage(meId: string, otherId: string, msgId: string, text: string) {
  await updateDoc(messageRef(meId, otherId, msgId), {
    text,
    editedAt: serverTimestamp(),
  });
}

/* ---------------- group message actions ---------------- */

const groupMessageRef = (groupId: string, msgId: string) =>
  doc(db, "conversations", groupId, "messages", msgId);

/** Hides a group message for the current user only. */
export async function deleteGroupMessageForMe(
  groupId: string,
  meId: string,
  msgId: string,
  participantIds: string[] = [],
) {
  const ref = groupMessageRef(groupId, msgId);
  await updateDoc(ref, { deletedFor: arrayUnion(meId) });
  // When everyone has removed it, drop the document entirely.
  try {
    const snap = await getDoc(ref);
    const hidden = (snap.data()?.["deletedFor"] as string[]) ?? [];
    if (participantIds.length && participantIds.every((uid) => hidden.includes(uid))) {
      await deleteDoc(ref);
    }
  } catch {
    /* best effort */
  }
}

/** Unsends a group message for everyone in the group. */
export async function deleteGroupMessageForEveryone(
  groupId: string,
  meId: string,
  msgId: string,
) {
  await updateDoc(groupMessageRef(groupId, msgId), {
    deleted: true,
    deletedBy: meId,
    deletedAt: serverTimestamp(),
    text: "",
    mediaUrl: "",
    mediaType: "",
    mediaName: "",
    deliveredTo: [],
    seenBy: [],
  });
}

/** Edits the text of a group message the current user sent. */
export async function editGroupMessage(groupId: string, msgId: string, text: string) {
  await updateDoc(groupMessageRef(groupId, msgId), {
    text,
    editedAt: serverTimestamp(),
  });
}

/** Sets (or clears) the current user's reaction on a group message. */
export async function toggleGroupMessageReaction(
  groupId: string,
  meId: string,
  msgId: string,
  emoji: string,
) {
  const ref = groupMessageRef(groupId, msgId);
  try {
    const snap = await getDoc(ref);
    const current = ((snap.data()?.["reactions"] as Record<string, string>) ?? {})[meId];
    await updateDoc(ref, {
      [`reactions.${meId}`]: current === emoji ? deleteField() : emoji,
    });
  } catch {
    /* best effort */
  }
}

/** Saves a group call log entry into the group thread. */
export async function saveGroupCallLog(
  group: GroupConversation,
  senderId: string,
  text: string,
) {
  await sendGroupMessage(group, senderId, text, undefined, undefined, undefined, "call");
}
