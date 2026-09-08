import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

// Registry so only one timeline video plays with sound at a time.
const active = new Set<HTMLVideoElement>();

// App-wide sound preference: once the user unmutes any video, later videos
// autoplay with sound too (no need to unmute every single one).
let soundEnabled = false;

function applySoundPreference(video: HTMLVideoElement) {
  video.muted = !soundEnabled;
  if (soundEnabled) {
    // Only this video should have sound; mute the rest.
    active.forEach((v) => {
      if (v !== video) v.muted = true;
    });
  }
}

export function AutoPlayVideo({
  src,
  onFirstPlay,
  onVideoClick,
  className,
}: {
  src: string;
  onFirstPlay?: () => void;
  onVideoClick?: (() => void) | undefined;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const counted = useRef(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          applySoundPreference(video);
          setMuted(video.muted);
          video
            .play()
            .then(() => {
              if (!counted.current) {
                counted.current = true;
                onFirstPlay?.();
              }
            })
            .catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: [0, 0.6, 1] }
    );
    observer.observe(video);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const toggleMute = () => {
    const video = ref.current;
    if (!video) return;
    const next = !muted;
    setMuted(next);
    video.muted = next;
    soundEnabled = !next;
    if (!next) {
      // Unmuting this one: mute every other playing timeline video.
      active.forEach((v) => {
        if (v !== video) v.muted = true;
      });
      video.play().catch(() => {});
    }
  };

  return (
    <div className="relative">
      <video
        ref={(v) => {
          ref.current = v;
          if (v) active.add(v);
        }}
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        onPlay={() => {
          if (!counted.current) {
            counted.current = true;
            onFirstPlay?.();
          }
        }}
        onClick={onVideoClick ?? toggleMute}
        className={className}
      />
      <button
        onClick={toggleMute}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute bottom-3 right-3 h-9 w-9 rounded-full bg-black/50 text-white flex items-center justify-center active:scale-90 transition-transform"
      >
        {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </button>
    </div>
  );
}
