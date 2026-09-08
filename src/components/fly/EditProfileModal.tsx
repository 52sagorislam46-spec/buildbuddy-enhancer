import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { auth, db, uploadToCloudinary } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { useAuth } from "./AuthContext";

export function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!profile) return null;

  const pickPhoto = (file: File | null) => {
    if (!file) return;
    setPhotoFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const save = async () => {
    if (!displayName.trim() || !username.trim()) {
      setError("Name and username are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let photoURL = profile.photoURL;
      if (photoFile) photoURL = (await uploadToCloudinary(photoFile)).url;
      const cleanUsername = username.trim().toLowerCase().replace(/\s+/g, "");
      await updateDoc(doc(db, "users", profile.uid), {
        displayName: displayName.trim(),
        username: cleanUsername,
        bio: bio.trim(),
        photoURL,
      });
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, {
          displayName: displayName.trim(),
          photoURL,
        }).catch(() => {});
      }
      await refreshProfile();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        className="flex-1 bg-black/40"
        aria-label="Close edit profile"
        onClick={onClose}
      />
      <div className="bg-white rounded-t-3xl max-h-[85%] overflow-y-auto mx-auto w-full max-w-md">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-base font-bold text-gray-900">Edit profile</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex justify-center">
            <button
              onClick={() => fileRef.current?.click()}
              className="relative"
              aria-label="Change photo"
            >
              <Avatar
                src={preview ?? profile.photoURL}
                alt={profile.displayName}
                size={84}
              />
              <span className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-sky-500 text-white flex items-center justify-center ring-2 ring-white">
                <Camera size={14} />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
            />
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full h-11 px-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full h-11 px-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Bio</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="mt-1 w-full px-3 py-2 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300 resize-none"
            />
          </label>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <button
            onClick={save}
            disabled={busy}
            className="w-full h-11 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-all"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
