/**
 * SMS two-step verification settings (Firebase multi-factor authentication).
 * Additive: shown inside the Edit profile page.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import type { RecaptchaVerifier } from "firebase/auth";
import { auth } from "../../lib/firebase";
import {
  createRecaptcha,
  enrolledFactors,
  finishEnroll,
  friendlyAuthError,
  removeFactor,
  startEnroll,
} from "./mfa";

export function TwoFactorSection({ defaultPhone = "" }: { defaultPhone?: string }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [factors, setFactors] = useState(
    auth.currentUser ? enrolledFactors(auth.currentUser) : [],
  );
  const boxRef = useRef<HTMLDivElement | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(
    () => () => {
      try {
        verifierRef.current?.clear();
      } catch {
        /* noop */
      }
    },
    [],
  );

  const verifier = () => {
    if (!verifierRef.current && boxRef.current) {
      verifierRef.current = createRecaptcha(boxRef.current);
    }
    if (!verifierRef.current) throw new Error("Could not start verification.");
    return verifierRef.current;
  };

  const sendCode = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const id = await startEnroll(user, phone.trim(), verifier());
      setVerificationId(id);
      setInfo("We sent a code by SMS. Enter it below.");
    } catch (e) {
      setError(friendlyAuthError(e));
      try {
        verifierRef.current?.clear();
      } catch {
        /* noop */
      }
      verifierRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await finishEnroll(user, verificationId, code, "Phone");
      setVerificationId("");
      setCode("");
      setInfo("Two-step verification is on for this account.");
      setFactors(enrolledFactors(user));
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (uid: string) => {
    const user = auth.currentUser;
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await removeFactor(user, uid);
      setFactors(enrolledFactors(user));
      setInfo("Two-step verification is off.");
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-sky-500" />
        <p className="text-sm font-semibold text-gray-900">
          Two-step verification (SMS)
        </p>
      </div>
      <p className="text-xs text-gray-500">
        Ask for a code sent to your phone every time you log in, so nobody can
        get in with your password alone.
      </p>

      {factors.length > 0 ? (
        <div className="space-y-2">
          {factors.map((f) => (
            <div
              key={f.uid}
              className="flex items-center justify-between gap-2 text-xs text-gray-700"
            >
              <span>
                On · {f.displayName ?? "Phone"}
              </span>
              <button
                onClick={() => void turnOff(f.uid)}
                disabled={busy}
                className="px-3 h-8 rounded-xl border border-gray-200 bg-white font-medium text-rose-500 disabled:opacity-60"
              >
                Turn off
              </button>
            </div>
          ))}
        </div>
      ) : verificationId ? (
        <div className="space-y-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            placeholder="6-digit code"
            className="w-full h-10 px-3 rounded-2xl bg-white border border-gray-200 text-sm outline-none focus:border-sky-300"
          />
          <button
            onClick={() => void confirm()}
            disabled={busy || code.trim().length < 6}
            className="w-full h-10 rounded-2xl bg-sky-500 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Confirm code
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+8801XXXXXXXXX"
            inputMode="tel"
            className="w-full h-10 px-3 rounded-2xl bg-white border border-gray-200 text-sm outline-none focus:border-sky-300"
          />
          <button
            onClick={() => void sendCode()}
            disabled={busy || phone.trim().length < 8}
            className="w-full h-10 rounded-2xl bg-sky-500 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Send code
          </button>
        </div>
      )}

      {error && <p className="text-xs text-rose-500">{error}</p>}
      {info && !error && <p className="text-xs text-emerald-600">{info}</p>}
      <div ref={boxRef} />
    </div>
  );
}
