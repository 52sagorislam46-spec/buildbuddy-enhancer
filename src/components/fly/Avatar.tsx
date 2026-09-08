import { useState } from "react";
import { secureUrl } from "../../lib/firebase";

export function Avatar({
  src,
  alt,
  size = 40,
  className = "",
}: {
  src?: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = secureUrl(src);
  if (!url || failed) {
    return (
      <div
        aria-label={alt}
        style={{ width: size, height: size }}
        className={`rounded-full bg-gray-200 ring-1 ring-gray-200 shrink-0 ${className}`}
      />
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={`rounded-full object-cover bg-gray-200 ring-1 ring-gray-200 shrink-0 ${className}`}
      loading="lazy"
    />
  );
}
