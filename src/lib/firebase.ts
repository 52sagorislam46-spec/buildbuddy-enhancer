import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDfzHhkNtrs3A_soHAWE51le-zrlbeXulc",
  authDomain: "fly-c7445.firebaseapp.com",
  projectId: "fly-c7445",
  storageBucket: "fly-c7445.firebasestorage.app",
  messagingSenderId: "48342961325",
  appId: "1:48342961325:web:2a185f173692aec3a28a24",
  measurementId: "G-QGE3YJ5H21",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const CLOUD_NAME = "xl2cfqi1";
const UPLOAD_PRESET = "social_upload";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;

export function secureUrl(url: unknown): string {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  return trimmed ? trimmed.replace(/^http:\/\//i, "https://") : "";
}

export async function uploadToCloudinary(
  file: File,
): Promise<{ url: string; resourceType: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", UPLOAD_PRESET);
  const res = await fetch(`${CLOUDINARY_URL}/auto/upload`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  const url = secureUrl(data.secure_url);
  if (!res.ok || !url || !/^https:\/\//.test(url)) {
    throw new Error(
      data?.error?.message ?? "Cloudinary upload failed. Check the upload preset.",
    );
  }
  const resourceType =
    data.resource_type ?? (file.type.startsWith("video/") ? "video" : "image");
  return { url, resourceType };
}

export const isVideoFile = (file: File) => file.type.startsWith("video/");

export const DEFAULT_AVATAR =
  "https://api.dicebear.com/7.x/avataaars/svg?seed=FlyUser";
