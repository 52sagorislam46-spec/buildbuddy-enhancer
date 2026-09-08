import { useRef, useState } from "react";
import { Bird, Eye, EyeOff, ImagePlus, Loader2 } from "lucide-react";
import { sendPasswordResetEmail } from "firebase/auth";
import type { MultiFactorResolver, RecaptchaVerifier } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useAuth } from "./AuthContext";
import {
  completeMfaSignIn,
  createRecaptcha,
  friendlyAuthError,
  resolverFromError,
  sendMfaChallenge,
} from "./mfa";

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && show ? "text" : type;
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500 mb-1 block">
        {label}
      </span>
      <div className="relative">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className={`w-full h-11 px-4 ${isPassword ? "pr-12" : ""} rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 placeholder-gray-400 outline-none focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100 transition-all`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-sky-500 transition-colors"
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500 mb-1 block">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full h-11 px-4 rounded-2xl bg-gray-50 border border-gray-100 outline-none focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100 transition-all ${
          value ? "text-gray-900" : "text-gray-400"
        }`}
      >
        <option value="">{placeholder ?? "Select option"}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AuthPage() {
  const { logIn, logInWithGoogle, signUp } = useAuth();
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaVerificationId, setMfaVerificationId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const recaptchaBoxRef = useRef<HTMLDivElement | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  /** When Firebase asks for the SMS second step, send the code and show the field. */
  const startMfaChallenge = async (err: unknown): Promise<boolean> => {
    const found = resolverFromError(err);
    if (!found) return false;
    try {
      if (!verifierRef.current && recaptchaBoxRef.current) {
        verifierRef.current = createRecaptcha(recaptchaBoxRef.current);
      }
      if (!verifierRef.current) return false;
      const id = await sendMfaChallenge(found, verifierRef.current);
      setResolver(found);
      setMfaVerificationId(id);
      setError("");
      return true;
    } catch (e) {
      setError(friendlyAuthError(e));
      return true;
    } finally {
      setBusy(false);
    }
  };
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [pronoun, setPronoun] = useState("");
  const [country, setCountry] = useState("Bangladesh");
  const [preferredLanguage, setPreferredLanguage] = useState("English");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState("");
  const [showPasswordHelp, setShowPasswordHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleForgotPassword = async () => {
    setError("");
    setResetSent("");
    if (!email.trim()) {
      setError("Enter your email first, then tap Forgot password");
      return;
    }
    try {
      const actionCodeSettings = {
        url: `${window.location.origin}/reset-password`,
        handleCodeInApp: false,
      };
      try {
        await sendPasswordResetEmail(auth, email.trim(), actionCodeSettings);
      } catch (inner) {
        if (
          inner instanceof Error &&
          inner.message.includes("unauthorized-continue-uri")
        ) {
          await sendPasswordResetEmail(auth, email.trim());
        } else {
          throw inner;
        }
      }
      setResetSent("Password reset email sent. Check your inbox.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.replace("Firebase: ", "")
          : "Something went wrong",
      );
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPhotoFile(file);
    setPreview(file ? URL.createObjectURL(file) : "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setShowPasswordHelp(false);
    setBusy(true);
    try {
      if (mode === "login") {
        await logIn(email, password);
      } else {
        if (!username.trim()) throw new Error("Username is required");

        await signUp(
          email,
          password,
          username.trim(),
          displayName.trim() || username.trim(),
          bio.trim(),
          photoFile,
          phone.trim(),
          { birthDate, gender, pronoun, country, preferredLanguage },
        );

      }
    } catch (err) {
      if (await startMfaChallenge(err)) return;
      const code = (err as { code?: string } | null)?.code ?? "";
      if (
        mode === "login" &&
        (code === "auth/invalid-credential" ||
          code === "auth/wrong-password" ||
          code === "auth/user-not-found")
      ) {
        setShowPasswordHelp(true);
      }
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };



  const handleGoogle = async () => {
    setError("");
    setResetSent("");
    setBusy(true);
    try {
      await logInWithGoogle();
    } catch (err) {
      if (await startMfaChallenge(err)) return;
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitMfaCode = async () => {
    if (!resolver) return;
    setBusy(true);
    setError("");
    try {
      await completeMfaSignIn(resolver, mfaVerificationId, mfaCode);
      setResolver(null);
      setMfaCode("");
      setMfaVerificationId("");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-white flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-sky-200 mb-3">
            <Bird size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Fly</h1>
          <p className="text-gray-500 text-sm mt-1">
            {mode === "login"
              ? "Welcome back. Spread your wings."
              : "Join the conversation."}
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl shadow-sm shadow-gray-100 border border-gray-100 p-6 space-y-4"
        >
          {mode === "signup" && (
            <>
              <div className="flex justify-center">
                <label className="relative cursor-pointer group">
                  <div className="w-20 h-20 rounded-full bg-gray-100 overflow-hidden ring-2 ring-sky-100 flex items-center justify-center">
                    {preview ? (
                      <img
                        src={preview}
                        alt="avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImagePlus size={24} className="text-gray-400" />
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFile}
                    className="hidden"
                  />
                </label>
              </div>
              <Field
                label="Username"
                value={username}
                onChange={setUsername}
                placeholder="yourname"
              />
              <Field
                label="Display name"
                value={displayName}
                onChange={setDisplayName}
                placeholder="Your Name"
              />
              <Field
                label="Mobile number"
                value={phone}
                onChange={setPhone}
                placeholder="+8801XXXXXXXXX"
                type="tel"
              />
              <Field
                label="Bio"
                value={bio}
                onChange={setBio}
                placeholder="Tell people about yourself"
              />
              <Field
                label="Birth date"
                value={birthDate}
                onChange={setBirthDate}
                type="date"
                required={false}
              />
              <SelectField
                label="Gender"
                value={gender}
                onChange={setGender}
                options={["Man", "Woman", "Other", "Prefer not to say"]}
              />
              <SelectField
                label="Pronoun"
                value={pronoun}
                onChange={setPronoun}
                options={["he/him", "she/her", "they/them"]}
              />
              <SelectField
                label="Country"
                value={country}
                onChange={setCountry}
                options={[
                  "Bangladesh",
                  "India",
                  "Pakistan",
                  "Nepal",
                  "United States",
                  "United Kingdom",
                  "Canada",
                  "Australia",
                  "Other",
                ]}
              />
              <SelectField
                label="Preferred Language"
                value={preferredLanguage}
                onChange={setPreferredLanguage}
                options={["English", "Bengali (বাংলা)", "Hindi", "Urdu"]}
              />
            </>
          )}
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            type="email"
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            type="password"
          />
          {mode === "login" && (
            <div className="text-right -mt-1">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-xs text-sky-500 font-medium hover:text-sky-600"
              >
                Forgot password?
              </button>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          {showPasswordHelp && (
            <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3 space-y-2">
              <p className="text-xs text-gray-600">
                If you created this account with Google, you can keep using
                Google — or set a password so email login works too.
              </p>
              <button
                type="button"
                onClick={() => void handleForgotPassword()}
                className="w-full h-10 rounded-2xl bg-white border border-sky-200 text-sky-600 text-sm font-semibold"
              >
                Email me a link to set a password
              </button>
            </div>
          )}
          {resetSent && (
            <p className="text-sm text-green-600 bg-green-50 rounded-xl px-3 py-2">
              {resetSent}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white font-semibold flex items-center justify-center gap-2 shadow-md shadow-sky-200 hover:shadow-lg hover:shadow-sky-300 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            {mode === "login" ? "Log in" : "Sign up"}
          </button>

          {resolver && (
            <div className="space-y-2 rounded-2xl bg-sky-50 border border-sky-100 p-3">
              <p className="text-xs text-gray-600">
                Enter the code we sent to your phone to finish logging in.
              </p>
              <input
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                inputMode="numeric"
                placeholder="6-digit code"
                className="w-full h-10 px-3 rounded-2xl bg-white border border-gray-200 text-sm outline-none focus:border-sky-300"
              />
              <button
                type="button"
                onClick={() => void submitMfaCode()}
                disabled={busy || mfaCode.trim().length < 6}
                className="w-full h-10 rounded-2xl bg-sky-500 text-white text-sm font-semibold disabled:opacity-60"
              >
                Verify code
              </button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-gray-100" />
            <span className="text-[11px] text-gray-400">or</span>
            <span className="h-px flex-1 bg-gray-100" />
          </div>
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={busy}
            className="w-full h-11 rounded-2xl bg-white border border-gray-200 text-gray-700 font-semibold flex items-center justify-center gap-2 hover:bg-gray-50 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"
              />
              <path
                fill="#FBBC05"
                d="M10.4 28.7A14.5 14.5 0 0 1 9.6 24c0-1.6.3-3.2.8-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z"
              />
            </svg>
            Continue with Google
          </button>
          <div ref={recaptchaBoxRef} />
        </form>
        <p className="text-center text-sm text-gray-500 mt-5">
          {mode === "login"
            ? "Don't have an account? "
            : "Already have an account? "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError("");
              setResetSent("");
            }}
            className="text-sky-500 font-semibold hover:text-sky-600"
          >
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
