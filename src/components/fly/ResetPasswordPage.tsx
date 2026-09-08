import { useEffect, useState } from "react";
import { Bird, Eye, EyeOff, Loader2 } from "lucide-react";
import { verifyPasswordResetCode, confirmPasswordReset } from "firebase/auth";
import { auth } from "../../lib/firebase";

export function ResetPasswordPage() {
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("oobCode");
    if (!code) {
      setError("Invalid or missing reset link. Please request a new one.");
      setChecking(false);
      return;
    }
    verifyPasswordResetCode(auth, code)
      .then((mail) => {
        setOobCode(code);
        setEmail(mail);
      })
      .catch(() => {
        setError(
          "This reset link is invalid or has expired. Please request a new one.",
        );
      })
      .finally(() => setChecking(false));
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset(auth, oobCode!, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.replace("Firebase: ", "")
          : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  };

  const passInput = (
    value: string,
    onChange: (v: string) => void,
    show: boolean,
    toggle: () => void,
    label: string,
  ) => (
    <label className="block">
      <span className="text-xs font-medium text-gray-500 mb-1 block">
        {label}
      </span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          required
          className="w-full h-11 px-4 pr-12 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 placeholder-gray-400 outline-none focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100 transition-all"
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-sky-500 transition-colors"
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </label>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-white flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-sky-200 mb-3">
            <Bird size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            Fly
          </h1>
          <p className="text-gray-500 text-sm mt-1">Reset your password.</p>
        </div>
        {checking ? (
          <div className="flex justify-center py-10">
            <Loader2 size={28} className="animate-spin text-sky-500" />
          </div>
        ) : done ? (
          <div className="bg-white rounded-3xl shadow-sm shadow-gray-100 border border-gray-100 p-6 text-center space-y-4">
            <p className="text-sm text-green-600 bg-green-50 rounded-xl px-3 py-2">
              Password changed successfully. You can log in now.
            </p>
            <a
              href="/"
              className="inline-block w-full h-11 leading-[2.75rem] rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white font-semibold shadow-md shadow-sky-200 hover:shadow-lg hover:shadow-sky-300 transition-all"
            >
              Go to log in
            </a>
          </div>
        ) : (
          <form
            onSubmit={handleReset}
            className="bg-white rounded-3xl shadow-sm shadow-gray-100 border border-gray-100 p-6 space-y-4"
          >
            {oobCode ? (
              <>
                <p className="text-sm text-gray-500">
                  Set a new password for{" "}
                  <span className="font-semibold text-gray-700">{email}</span>
                </p>
                {passInput(
                  password,
                  setPassword,
                  showPass,
                  () => setShowPass((s) => !s),
                  "New password",
                )}
                {passInput(
                  confirm,
                  setConfirm,
                  showConfirm,
                  () => setShowConfirm((s) => !s),
                  "Confirm new password",
                )}
              </>
            ) : null}
            {error && (
              <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">
                {error}
              </p>
            )}
            {oobCode ? (
              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white font-semibold flex items-center justify-center gap-2 shadow-md shadow-sky-200 hover:shadow-lg hover:shadow-sky-300 transition-all active:scale-[0.98] disabled:opacity-60"
              >
                {busy && <Loader2 size={18} className="animate-spin" />}
                Change password
              </button>
            ) : (
              <a
                href="/"
                className="block text-center w-full h-11 leading-[2.75rem] rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white font-semibold shadow-md shadow-sky-200 hover:shadow-lg hover:shadow-sky-300 transition-all"
              >
                Back to log in
              </a>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
