/**
 * SMS two-step verification (Firebase multi-factor authentication) helpers.
 * Purely additive — nothing else in the auth flow changes.
 */
import {
  getMultiFactorResolver,
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type User,
} from "firebase/auth";
import { auth } from "../../lib/firebase";

/** Invisible reCAPTCHA, required by Firebase before any SMS is sent. */
export function createRecaptcha(container: HTMLElement) {
  return new RecaptchaVerifier(auth, container, { size: "invisible" });
}

/** Returns a resolver when a sign-in attempt needs a second (SMS) step. */
export function resolverFromError(error: unknown): MultiFactorResolver | null {
  const code = (error as { code?: string } | null)?.code;
  if (code !== "auth/multi-factor-auth-required") return null;
  try {
    return getMultiFactorResolver(auth, error as never);
  } catch {
    return null;
  }
}

/** Sends the login SMS code and returns the verification id. */
export async function sendMfaChallenge(
  resolver: MultiFactorResolver,
  verifier: RecaptchaVerifier,
): Promise<string> {
  const hint = resolver.hints[0];
  if (!hint) throw new Error("No verification method found on this account.");
  const provider = new PhoneAuthProvider(auth);
  return provider.verifyPhoneNumber(
    { multiFactorHint: hint, session: resolver.session },
    verifier,
  );
}

/** Finishes a login that required an SMS code. */
export async function completeMfaSignIn(
  resolver: MultiFactorResolver,
  verificationId: string,
  code: string,
) {
  const cred = PhoneAuthProvider.credential(verificationId, code.trim());
  await resolver.resolveSignIn(PhoneMultiFactorGenerator.assertion(cred));
}

/** Starts adding SMS two-step verification to the signed-in account. */
export async function startEnroll(
  user: User,
  phoneNumber: string,
  verifier: RecaptchaVerifier,
): Promise<string> {
  const session = await multiFactor(user).getSession();
  const provider = new PhoneAuthProvider(auth);
  return provider.verifyPhoneNumber({ phoneNumber, session }, verifier);
}

/** Confirms the SMS code and turns two-step verification on. */
export async function finishEnroll(
  user: User,
  verificationId: string,
  code: string,
  displayName = "Phone",
) {
  const cred = PhoneAuthProvider.credential(verificationId, code.trim());
  await multiFactor(user).enroll(
    PhoneMultiFactorGenerator.assertion(cred),
    displayName,
  );
}

export function enrolledFactors(user: User): MultiFactorInfo[] {
  try {
    return multiFactor(user).enrolledFactors;
  } catch {
    return [];
  }
}

export async function removeFactor(user: User, factorUid: string) {
  await multiFactor(user).unenroll(factorUid);
}

const AUTH_MESSAGES: Record<string, string> = {
  "auth/popup-blocked":
    "Your browser blocked the Google window. Open the app in a full browser tab and try again.",
  "auth/popup-closed-by-user": "The Google window was closed before finishing.",
  "auth/cancelled-popup-request": "Another sign-in window was already open. Please try again.",
  "auth/unauthorized-domain":
    "Google sign-in is not allowed on this web address yet. Add this site's address to Firebase Authentication → Settings → Authorized domains.",

  "auth/operation-not-supported-in-this-environment":
    "Google sign-in cannot run here. Open the app in a full browser tab and try again.",
  "auth/network-request-failed": "Network problem. Check your connection and try again.",
  "auth/invalid-credential":
    "Wrong email or password. If you created this account with Google, tap “Continue with Google”, or use “Forgot password?” to set a password.",
  "auth/wrong-password":
    "Wrong email or password. If you created this account with Google, tap “Continue with Google”, or use “Forgot password?” to set a password.",

  "auth/user-not-found": "No account found with this email.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/invalid-email": "That email address does not look right.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/invalid-verification-code": "That code is not correct. Please check and try again.",
  "auth/code-expired": "The code expired. Please request a new one.",
  "auth/requires-recent-login": "Please log in again, then retry this step.",
};

export function friendlyAuthError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code === "auth/unauthorized-domain") {
    const host =
      typeof window !== "undefined" ? window.location.hostname : "this address";
    return `Google sign-in is not allowed on ${host} yet. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains, then try again.`;
  }
  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];

  if (error instanceof Error) {
    const cleaned = error.message
      .replace("Firebase: ", "")
      .replace(/\(auth.*\)\.?/, "")
      .trim();
    if (cleaned && cleaned.toLowerCase() !== "error") return cleaned;
    if (code) return `Sign-in failed (${code.replace("auth/", "")}).`;
  }
  return "Something went wrong";
}

