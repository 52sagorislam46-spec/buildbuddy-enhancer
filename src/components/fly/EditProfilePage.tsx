import { useRef, useState } from "react";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { auth, db, uploadToCloudinary } from "../../lib/firebase";
import { Avatar } from "./Avatar";
import { useAuth } from "./AuthContext";
import { TwoFactorSection } from "./TwoFactorSection";

export function EditProfilePage({ onBack }: { onBack: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
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
      setSaved(true);
      setTimeout(() => onBack(), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-20 min-h-screen bg-white">
      <header className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-4 h-14 flex items-center gap-3 z-10">
        <button onClick={onBack} aria-label="Back" className="text-gray-500">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold text-gray-900">Edit profile</h1>
      </header>

      <div className="px-5 py-6 space-y-4">
        <div className="flex justify-center">
          <button
            onClick={() => fileRef.current?.click()}
            className="relative"
            aria-label="Change photo"
          >
            <Avatar
              src={preview ?? profile.photoURL}
              alt={profile.displayName}
              size={96}
            />
            <span className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-sky-500 text-white flex items-center justify-center ring-2 ring-white">
              <Camera size={15} />
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
        <p className="text-center text-xs text-gray-400">
          Tap the photo to change your profile picture
        </p>

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
            rows={4}
            className="mt-1 w-full px-3 py-2 rounded-2xl bg-gray-50 border border-gray-100 text-sm outline-none focus:border-sky-300 resize-none"
          />
        </label>

        <TwoFactorSection defaultPhone={profile.phone ?? ""} />

        {error && <p className="text-xs text-rose-500">{error}</p>}
        {saved && !error && (
          <p className="text-xs text-emerald-500">Profile updated!</p>
        )}

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
  );
}
