import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  sendEmailVerification,
  updateProfile,
  GoogleAuthProvider,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, uploadToCloudinary, DEFAULT_AVATAR } from "../../lib/firebase";
import { startPresence } from "./presence";
import type { UserProfile } from "./types";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    username: string,
    displayName: string,
    bio: string,
    photoFile: File | null,
    phone?: string,
    extra?: {
      birthDate?: string;
      gender?: string;
      pronoun?: string;
      country?: string;
      preferredLanguage?: string;
    },
  ) => Promise<void>;
  logIn: (email: string, password: string) => Promise<void>;
  logInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  ensureUserProfile: () => Promise<UserProfile>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const ensureProfile = async (firebaseUser: User): Promise<UserProfile> => {
    const ref = doc(db, "users", firebaseUser.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = snap.data();
      const merged: UserProfile = {
        uid: firebaseUser.uid,
        username:
          data.username ??
          firebaseUser.email?.split("@")[0]?.toLowerCase() ??
          `user-${firebaseUser.uid.slice(0, 8)}`,
        displayName: data.displayName ?? firebaseUser.displayName ?? "Anonymous",
        bio: data.bio ?? "",
        photoURL: data.photoURL ?? firebaseUser.photoURL ?? DEFAULT_AVATAR,
        phone: data.phone ?? "",
        email: data.email ?? firebaseUser.email ?? "",
        birthDate: data.birthDate ?? "",
        gender: data.gender ?? "",
        pronoun: data.pronoun ?? "",
        country: data.country ?? "",
        preferredLanguage: data.preferredLanguage ?? "",
        followers: data.followers ?? [],
        following: data.following ?? [],
        suspendedUntil: data.suspendedUntil ?? 0,
        suspendedReason: data.suspendedReason ?? "",
        createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
      };
      await setDoc(ref, merged, { merge: true });
      return merged;
    }
    const fresh: UserProfile = {
      uid: firebaseUser.uid,
      username:
        firebaseUser.email?.split("@")[0]?.toLowerCase() ??
        `user-${firebaseUser.uid.slice(0, 8)}`,
      displayName: firebaseUser.displayName ?? "Anonymous",
      bio: "",
      photoURL: firebaseUser.photoURL ?? DEFAULT_AVATAR,
      phone: "",
      email: firebaseUser.email ?? "",
      birthDate: "",
      gender: "",
      pronoun: "",
      country: "",
      preferredLanguage: "",
      followers: [],
      following: [],
      createdAt: Date.now(),
    };
    await setDoc(ref, { ...fresh, createdAt: serverTimestamp() });
    return fresh;
  };

  const ensureUserProfile = async () => {
    if (!auth.currentUser) throw new Error("You must be logged in to continue.");
    const p = await ensureProfile(auth.currentUser);
    setProfile(p);
    return p;
  };

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    const p = await ensureProfile(auth.currentUser);
    setProfile(p);
  };

  useEffect(
    () =>
      onAuthStateChanged(auth, async (firebaseUser) => {
        setUser(firebaseUser);
        if (firebaseUser) {
          const p = await ensureProfile(firebaseUser);
          setProfile(p);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }),
    [],
  );

  // Finish a Google sign-in that had to leave the page (redirect flow).
  useEffect(() => {
    void getRedirectResult(auth).catch(() => {
      /* no pending redirect sign-in */
    });
  }, []);

  // keep presence (online / last seen) updated while logged in
  useEffect(() => {
    if (!user) return;
    return startPresence(user.uid);
  }, [user]);

  // Let the push service worker act for this user while the app is closed
  // (mark the device reachable + incoming messages delivered).
  useEffect(() => {
    void (async () => {
      const { saveSwAuth, clearSwAuth } = await import("../../lib/swBridge");
      if (user?.refreshToken) await saveSwAuth(user.uid, user.refreshToken);
      else await clearSwAuth();
    })();
  }, [user]);

  const signUp: AuthContextValue["signUp"] = async (
    email,
    password,
    username,
    displayName,
    bio,
    photoFile,
    phone,
    extra,
  ) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const firebaseUser = cred.user;
    let photoURL = DEFAULT_AVATAR;
    if (photoFile) photoURL = (await uploadToCloudinary(photoFile)).url;
    await updateProfile(firebaseUser, { displayName, photoURL });
    const fresh: UserProfile = {
      uid: firebaseUser.uid,
      username: username.toLowerCase(),
      displayName,
      bio,
      photoURL,
      phone: (phone ?? "").trim(),
      email: email.trim(),
      birthDate: (extra?.birthDate ?? "").trim(),
      gender: (extra?.gender ?? "").trim(),
      pronoun: (extra?.pronoun ?? "").trim(),
      country: (extra?.country ?? "").trim(),
      preferredLanguage: (extra?.preferredLanguage ?? "").trim(),
      followers: [],
      following: [],
      createdAt: Date.now(),
    };
    await setDoc(doc(db, "users", firebaseUser.uid), {
      ...fresh,
      createdAt: serverTimestamp(),
    });
    setProfile(fresh);
    // Welcome message: e-mail (Firebase verification mail) + in-app notice.
    try {
      await sendEmailVerification(firebaseUser);
    } catch {
      /* welcome e-mail is best effort */
    }
    try {
      const { showNotification } = await import("../../lib/notify");
      showNotification(
        "Welcome to Fly",
        `Hi ${displayName}, welcome to Fly! Your account (${email.trim()}${
          (phone ?? "").trim() ? `, ${(phone ?? "").trim()}` : ""
        }) is ready.`,
        { icon: photoURL },
      );
    } catch {
      /* ignore */
    }
  };

  const logInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const inFrame = typeof window !== "undefined" && window.top !== window.self;
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "";
      if (code === "auth/popup-closed-by-user") return;
      if (code === "auth/unauthorized-domain" && inFrame) {
        // The editor preview frame runs on a different address than the real
        // site, so open the app in a normal tab where Google is allowed.
        window.open(window.location.href, "_blank", "noopener,noreferrer");
        return;
      }
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/cancelled-popup-request"
      ) {
        // Inside the small preview frame Google refuses to load, so open the
        // app in a real browser tab where sign-in works.
        if (inFrame) {
          window.open(window.location.href, "_blank", "noopener,noreferrer");
          return;
        }
        await signInWithRedirect(auth, provider);
        return;
      }
      throw error;
    }
  };


  const logIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logOut = async () => {
    await signOut(auth);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signUp,
        logIn,
        logInWithGoogle,
        logOut,
        refreshProfile,
        ensureUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
