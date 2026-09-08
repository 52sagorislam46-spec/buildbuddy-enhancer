import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { Play } from "lucide-react";
import { db } from "../../lib/firebase";

/**
 * Detects a shared Fly post link (…?post=ID) inside a message and renders a
 * video/photo preview card above the link text — like image 2 in the request.
 */

const POST_LINK_RE = /[?&]post=([A-Za-z0-9]+)/;

function findPostId(text: string): string | null {
  const match = text.match(POST_LINK_RE);
  return match?.[1] ?? null;
}

interface PreviewPost {
  mediaUrl: string;
  mediaType: string;
  text: string;
  authorName: string;
}

export function PostLinkPreview({ text }: { text: string }) {
  const postId = findPostId(text);
  const [post, setPost] = useState<PreviewPost | null>(null);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    getDoc(doc(db, "posts", postId))
      .then((snap) => {
        if (!cancelled && snap.exists()) {
          const d = snap.data() as Record<string, unknown>;
          setPost({
            mediaUrl: (d['mediaUrl'] as string) ?? "",
            mediaType: (d['mediaType'] as string) ?? "",
            text: (d['text'] as string) ?? "",
            authorName: (d['authorName'] as string) ?? "",
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (!postId || !post || !post.mediaUrl) return null;

  const href = `${window.location.origin}/?post=${postId}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="block mx-1 mt-1 rounded-xl overflow-hidden bg-black/10"
    >
      {post.mediaType === "video" ? (
        <span className="relative block">
          <video
            src={post.mediaUrl}
            playsInline
            muted
            preload="metadata"
            className="w-full max-h-72 object-cover pointer-events-none"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-12 h-12 rounded-full bg-black/45 flex items-center justify-center text-white">
              <Play size={22} className="fill-white" />
            </span>
          </span>
        </span>
      ) : (
        <img
          src={post.mediaUrl}
          alt={post.text || "Shared post"}
          className="w-full max-h-72 object-cover"
        />
      )}
    </a>
  );
}
